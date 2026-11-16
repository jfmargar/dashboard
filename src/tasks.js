import { statSync } from 'node:fs';
import { basename } from 'node:path';
import { readJsonlFrom, scanJsonlBackward } from './files.js';
import { transcriptFile } from './transcripts.js';

// En qué tarea va cada sesión (vista Misiones): el plan que el propio agente se marca, el paso en
// curso y lo último que ha hecho. Se guarda por registro y solo se lee lo que se ha añadido desde la
// vez anterior, así el refresco de cada 5 s no relee nada sin cambios.
const INITIAL_BYTES = 8 * 1024 * 1024;
const MAX_ACTION = 60;
const MAX_GOAL = 140;
const cache = new Map();

export function readTask(sessionId) {
  const entry = transcriptFile(sessionId);
  if (!entry) return null;
  let stat;
  try { stat = statSync(entry.path); } catch { return null; }
  let state = cache.get(entry.path);
  if (!state || state.ino !== stat.ino || stat.size < state.end) {
    state = initialState(entry, stat.ino);
  } else if (stat.size > state.end) {
    const { rows, end } = readJsonlFrom(entry.path, state.end);
    for (const row of rows) applyRow(state, row);
    state.end = end;
  }
  cache.set(entry.path, state);
  return summarize(state);
}

function emptyState(agent, ino) {
  // `ask`: si el turno en curso te pregunta algo (null mientras no se sepa); `text`: su último mensaje.
  return { agent, ino, end: 0, plan: null, action: null, goal: null, ask: null, text: null };
}

// Primera lectura: desde el final hasta el último plan completo (o hasta 8 MB), quedándose solo con
// las líneas que importan, y se aplican en orden como si se hubieran leído según llegaban.
function initialState(entry, ino) {
  const state = emptyState(entry.agent, ino);
  const rows = [];
  let hasAction = false;
  let hasPlan = false;
  let hasGoal = entry.agent !== 'codex';
  let hasTurn = false;
  const { end } = scanJsonlBackward(entry.path, (row) => {
    const kinds = rowKinds(entry.agent, row);
    if (!kinds.length) return false;
    rows.push(row);
    if (kinds.includes('action')) hasAction = true;
    if (kinds.includes('plan')) hasPlan = true;
    if (kinds.includes('goal')) hasGoal = true;
    if (kinds.includes('turn')) hasTurn = true;
    return hasAction && hasPlan && hasGoal && hasTurn;
  }, INITIAL_BYTES);
  for (let i = rows.length - 1; i >= 0; i--) applyRow(state, rows[i]);
  state.end = end;
  return state;
}

// Qué aporta una línea: un plan completo, un avance del plan, una acción o el objetivo del hilo.
function rowKinds(agent, row) {
  const kinds = [];
  if (agent === 'claude') {
    if (claudeUserText(row)) kinds.push('turn');
    for (const part of claudeParts(row)) {
      if (part.type === 'tool_use' && isPlanTool(part.name)) kinds.push(isFullPlan(part) ? 'plan' : 'step');
      else if (part.type === 'tool_use' && !isSilentTool(part.name)) kinds.push('action');
      else if (part.type === 'text' && part.text?.trim()) kinds.push('action');
    }
    return kinds;
  }
  const p = row.payload ?? {};
  if (row.type === 'response_item' && p.type === 'function_call' && p.name === 'update_plan') kinds.push('plan');
  if (row.type === 'event_msg' && p.type === 'thread_goal_updated') kinds.push('goal');
  if (row.type === 'event_msg' && p.type === 'item_completed' && codexAction(p.item)) kinds.push('action');
  if (row.type === 'event_msg' && p.type === 'item_completed' && p.item?.type === 'UserMessage') kinds.push('turn');
  if (row.type === 'response_item' && p.type === 'function_call' && ASK_TOOLS.has(p.name)) kinds.push('action');
  return kinds;
}

export function applyRow(state, row) {
  if (state.agent === 'claude') {
    if (claudeUserText(row)) newTurn(state);
    for (const part of claudeParts(row)) {
      if (part.type === 'tool_use' && part.name === 'mcp__ccd_turn__wrap_up') {
        // La app cierra el turno con un cuadro: si lleva pregunta o queda bloqueado, te espera.
        const input = part.input ?? {};
        state.ask = Boolean(input.ask || input.blocked);
      } else if (part.type === 'tool_use' && ASK_TOOLS.has(part.name)) {
        state.ask = true;
      }
      if (part.type === 'tool_use' && isPlanTool(part.name)) state.plan = applyPlanCall(state.plan, part.name, part.input ?? {});
      else if (part.type === 'tool_use' && !isSilentTool(part.name)) state.action = actionLabel(part.name, part.input ?? {});
      else if (part.type === 'text' && part.text?.trim()) {
        state.action = textLabel(part.text);
        state.text = part.text;
      }
    }
    return;
  }
  const p = row.payload ?? {};
  if (row.type === 'response_item' && p.type === 'function_call' && p.name === 'update_plan') {
    const args = parseArgs(p.arguments);
    if (Array.isArray(args.plan)) state.plan = args.plan.map((s) => ({ text: String(s.step ?? ''), status: planStatus(s.status) }));
  } else if (row.type === 'event_msg' && p.type === 'thread_goal_updated') {
    const objective = p.goal?.objective;
    if (objective) state.goal = clip(objective, MAX_GOAL);
  } else if (row.type === 'event_msg' && p.type === 'item_completed') {
    if (p.item?.type === 'UserMessage') newTurn(state);
    const action = codexAction(p.item);
    if (action) state.action = action;
    if (p.item?.type === 'AgentMessage') state.text = p.item.text ?? (p.item.content ?? []).map((c) => c.text ?? '').join(' ');
  } else if (row.type === 'response_item' && p.type === 'function_call' && ASK_TOOLS.has(p.name)) {
    state.ask = true;
  }
}

// Herramientas con las que el agente te pide algo: una pregunta, una aprobación del plan.
const ASK_TOOLS = new Set(['AskUserQuestion', 'ExitPlanMode', 'request_user_input', 'request_user_input_async']);

function newTurn(state) {
  state.ask = null;
  state.text = null;
}

// Mensaje tuyo (o de la app en tu nombre) que abre un turno; los resultados de herramientas no cuentan.
function claudeUserText(row) {
  if (row.type !== 'user' || row.isSidechain || row.isMeta) return false;
  const content = row.message?.content;
  if (typeof content === 'string') return Boolean(content.trim());
  return Array.isArray(content) && content.some((part) => part.type === 'text' && part.text?.trim());
}

// ¿El turno terminado te pide algo? Lo que dijo la app al cerrarlo o una herramienta de pregunta
// manda; si no hay señal, se mira si el final del último mensaje es una pregunta.
export function needsYou(state) {
  if (state.ask !== null && state.ask !== undefined) return state.ask;
  const text = String(state.text ?? '').trim();
  if (!text) return true;
  const tail = text.split('\n').map((line) => line.trim()).filter(Boolean).slice(-3).join(' ');
  return /\?/.test(tail);
}

function claudeParts(row) {
  if (row.type !== 'assistant' || row.isSidechain) return [];
  const content = row.message?.content;
  return Array.isArray(content) ? content : [];
}

// `wrap_up` cierra el turno en la app de Claude y da por hechos todos los pasos.
const PLAN_TOOLS = new Set(['mcp__ccd_turn__update_plan', 'mcp__ccd_turn__wrap_up', 'TodoWrite']);
function isPlanTool(name) {
  return PLAN_TOOLS.has(name);
}

function isFullPlan(part) {
  const input = part.input ?? {};
  return Array.isArray(input.items) || Array.isArray(input.todos);
}

// Herramientas de la propia app que no son trabajo: el cierre del turno, cargar herramientas…
function isSilentTool(name) {
  return name === 'ToolSearch' || /^mcp__ccd_(turn|view|sidebar|window|settings)__/.test(name);
}

function planStatus(value) {
  return value === 'completed' || value === 'in_progress' ? value : 'pending';
}

// La app de Claude manda la lista entera (`items`) o solo avances: `advance` cierra el paso en curso
// y abre el siguiente; `done` (posiciones desde 1) cierra pasos y `start` abre uno.
export function applyPlanCall(plan, name, input) {
  if (name === 'mcp__ccd_turn__wrap_up') {
    return plan ? plan.map((step) => ({ ...step, status: 'completed' })) : plan;
  }
  if (name === 'TodoWrite') {
    return Array.isArray(input.todos) ? input.todos.map((t) => ({ text: String(t.content ?? ''), status: planStatus(t.status) })) : plan;
  }
  if (Array.isArray(input.items)) {
    return input.items.map((item) => ({ text: String(item.content ?? ''), status: planStatus(item.status) }));
  }
  if (!plan) return plan;
  const next = plan.map((step) => ({ ...step }));
  if (input.advance) {
    const current = next.findIndex((step) => step.status === 'in_progress');
    if (current >= 0) next[current].status = 'completed';
    const pending = next.findIndex((step, i) => i > current && step.status === 'pending');
    if (pending >= 0) next[pending].status = 'in_progress';
  }
  for (const position of Array.isArray(input.done) ? input.done : []) {
    if (next[position - 1]) next[position - 1].status = 'completed';
  }
  if (Number.isInteger(input.start) && next[input.start - 1]) {
    next.forEach((step) => { if (step.status === 'in_progress') step.status = 'completed'; });
    next[input.start - 1].status = 'in_progress';
  }
  return next;
}

// Lo último que ha hecho, en palabras: «Ejecutando npm test», «Editando office.js»…
export function actionLabel(name, input) {
  if (name === 'Bash') return clip(`Ejecutando ${shortCommand(input.command)}`, MAX_ACTION);
  if (name === 'Edit' || name === 'Write' || name === 'MultiEdit' || name === 'NotebookEdit') return clip(`Editando ${fileName(input.file_path ?? input.notebook_path)}`, MAX_ACTION);
  if (name === 'Read') return clip(`Leyendo ${fileName(input.file_path)}`, MAX_ACTION);
  if (name === 'Grep' || name === 'Glob') return clip(`Buscando ${input.pattern ?? ''}`.trim(), MAX_ACTION);
  if (name === 'WebSearch' || name === 'WebFetch') return 'Buscando en la web';
  if (name === 'Agent' || name === 'Task') return 'Con un subagente';
  if (name === 'Skill') return clip(`Usando la skill ${input.skill ?? ''}`.trim(), MAX_ACTION);
  if (name === 'Artifact') return 'Publicando una página';
  if (/^mcp__(Claude_Browser|claude-in-chrome)__/.test(name)) return 'Probando en el navegador';
  if (/^mcp__Claude_Code_iOS_Simulator__/.test(name)) return 'Probando en el simulador';
  if (/^mcp__ccd_session__/.test(name)) return 'Abriendo una sesión';
  return clip(`Usando ${name.replace(/^mcp__[^_]+(?:_[^_]+)*?__/, '')}`, MAX_ACTION);
}

function codexAction(item) {
  if (!item) return null;
  if (item.type === 'CommandExecution') {
    const command = Array.isArray(item.command) ? item.command[item.command.length - 1] : item.command;
    return command ? clip(`Ejecutando ${shortCommand(command)}`, MAX_ACTION) : null;
  }
  if (item.type === 'FileChange') {
    const paths = Object.keys(item.changes ?? {});
    if (!paths.length) return null;
    const more = paths.length > 1 ? ` y ${paths.length - 1} más` : '';
    return clip(`Editando ${fileName(paths[0])}${more}`, MAX_ACTION);
  }
  if (item.type === 'McpToolCall') return clip(`Usando ${item.tool ?? item.server ?? 'una herramienta'}`, MAX_ACTION);
  if (item.type === 'AgentMessage') {
    const text = item.text ?? (item.content ?? []).map((c) => c.text ?? '').join(' ');
    return text?.trim() ? textLabel(text) : null;
  }
  return null;
}

function textLabel(text) {
  return clip(String(text).replace(/[#*`_>]/g, '').replace(/\s+/g, ' ').trim(), MAX_ACTION);
}

// El comando que importa: sin `cd …&&` delante y con sus dos primeras palabras.
export function shortCommand(command) {
  const text = String(command ?? '').replace(/\s+/g, ' ').trim();
  const parts = text.split(/\s*(?:&&|;|\|\|?)\s*/).filter(Boolean);
  const main = parts.find((part) => !/^(cd|export|set|source)\b/.test(part)) ?? parts[0] ?? '';
  const words = main.split(' ').filter((word) => !/^[A-Z_]+=/.test(word) && !/[<>]/.test(word));
  while (/^(time|sudo|env|nohup|exec)$/.test(words[0] ?? '')) words.shift();
  const take = /^(npm|npx|pnpm|yarn|git|gh|glab|node|python3?|xcrun|swift|gradle|\.\/gradlew)$/.test(words[0] ?? '') ? 3 : 2;
  return words.slice(0, take).join(' ');
}

function fileName(path) {
  return path ? basename(String(path)) : 'un archivo';
}

function parseArgs(value) {
  if (value && typeof value === 'object') return value;
  try { return JSON.parse(value ?? '{}'); } catch { return {}; }
}

function clip(text, max) {
  const t = String(text).replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

// Lo que se manda al panel: el plan, el paso en curso (o el primero pendiente) y la última acción.
export function summarize(state) {
  const plan = state.plan ?? [];
  const done = plan.filter((step) => step.status === 'completed').length;
  let index = plan.findIndex((step) => step.status === 'in_progress');
  if (index < 0) index = plan.findIndex((step) => step.status === 'pending');
  return {
    plan,
    current: plan.length ? { text: index >= 0 ? plan[index].text : null, index: index >= 0 ? index : null, done, total: plan.length } : null,
    lastAction: state.action,
    goal: state.goal,
    needsYou: needsYou(state),
  };
}

// Solo se lee la tarea de lo que se mueve: trabajando, esperándote o acabado en las últimas 24 h.
export function wantsTask(session, now) {
  return session.status === 'working' || session.status === 'yours' || now - session.lastActivity < 24 * 60 * 60 * 1000;
}
