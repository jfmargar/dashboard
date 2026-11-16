import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DATA_DIR } from './data-dir.js';
import { StringDecoder } from 'node:string_decoder';
import { recordRateLimitEvent } from './claude-usage.js';
import { cancelResult, createCodexAppServer } from './codex-app-server.js';
import { binCandidates } from './bins.js';

// Ejecuta los agentes en segundo plano:
// - Opción A: continuar una sesión existente (`startOrder`).
// - Opción B: abrir una sesión nueva desde el panel (`startSession`), que queda registrada como propia.
// Claude va por su CLI (`claude -p`). Codex va por su app-server: así se pueden aprobar sus peticiones,
// pararlo limpio, corregirlo sobre la marcha y sus sesiones salen en la app de escritorio.
const MAX_RUNTIME_MS = 30 * 60 * 1000;
const KEEP_FINISHED_MS = 60 * 60 * 1000;
const MAX_TEXT = 4000;
const MAX_REPLY = 16000;
const STOP_GRACE_MS = 3000;

// Nivel de permisos de cada ejecución. El panel es un extra de las apps: por defecto trabaja como
// ellas (Auto). Claude nunca usa `bypassPermissions`: en Auto decide su clasificador (`auto`).
// En Editar, Codex pide aprobación (`on-request`) para lo que se salga de su sandbox y llega al panel.
export const DEFAULT_MODE = 'auto';
const MODES = {
  auto: {
    claude: 'auto',
    // Como la app de Codex de este Mac: sin sandbox y sin preguntar.
    codex: { type: 'dangerFullAccess' },
    codexApproval: 'never',
    label: 'Auto: trabaja sin pedirte permisos. Claude decide con su modo auto qué es seguro; Codex va sin sandbox, como en su app.',
  },
  plan: {
    claude: 'plan',
    codex: { type: 'readOnly' },
    label: 'Solo mirar: puede leer y proponer, no cambia nada.',
  },
  edit: {
    claude: process.env.CLAUDE_PERMISSION_MODE ?? 'acceptEdits',
    codex: { type: 'workspaceWrite' },
    label: 'Editar: puede cambiar ficheros del proyecto. Claude rechaza lo que necesite más permisos; Codex te pide aprobación.',
  },
};
const APPROVAL_DECISIONS = new Set(['accept', 'acceptForSession', 'decline', 'cancel']);

// El CLI que trae la app de Codex va por delante del de Homebrew y entiende los modelos nuevos.
const BIN_CANDIDATES = {
  claude: binCandidates('CLAUDE_BIN', [join(homedir(), '.local/bin/claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude']),
  codex: binCandidates('CODEX_BIN', ['/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex', '/opt/homebrew/bin/codex', '/usr/local/bin/codex']),
};

const CHILD_PATH = [join(homedir(), '.local/bin'), '/opt/homebrew/bin', '/usr/local/bin', process.env.PATH].join(':');

const MANAGED_FILE = join(DATA_DIR, 'managed.json');

const jobs = new Map();

function codexServer() {
  const bin = BIN_CANDIDATES.codex.find((path) => path && existsSync(path));
  if (!bin) throw new OrderError(500, 'No encuentro el CLI de codex.');
  return createCodexAppServer({ bin, env: { ...process.env, PATH: CHILD_PATH } });
}
const managed = loadManaged();

export const orderModes = Object.fromEntries(Object.entries(MODES).map(([key, mode]) => [key, mode.label]));

// Trabajos

export function jobFor(sessionId) {
  const job = jobs.get(sessionId);
  if (!job) return null;
  if (job.finishedAt && Date.now() - job.finishedAt > KEEP_FINISHED_MS) {
    jobs.delete(sessionId);
    return null;
  }
  return publicJob(job);
}

export function hasRunningJob(sessionId) {
  return jobs.get(sessionId)?.status === 'running';
}

export function stopJob(sessionId) {
  const job = jobs.get(sessionId);
  if (!job || job.status !== 'running') throw new OrderError(409, 'No hay nada en marcha que parar.');
  job.stopRequested = true;
  if (job.agent === 'codex') {
    interruptCodex(job);
    return publicJob(job);
  }
  job.child.kill('SIGINT');
  setTimeout(() => {
    if (job.status === 'running') job.child.kill('SIGTERM');
  }, STOP_GRACE_MS);
  return publicJob(job);
}

// Opción A: continuar una sesión que ya existe.
export function startOrder(session, rawText) {
  const text = validateText(rawText);
  // Cuenta su propio turno: una coordinadora que espera a sus delegadas sí puede recibir un mensaje.
  if ((session.ownStatus ?? session.status) === 'working' || hasRunningJob(session.id)) {
    throw new OrderError(409, 'La sesión está trabajando; espera a que termine.');
  }
  // El CLI escribiría en su registro sin que la app lo vea y sin sus herramientas (issue #3).
  if (session.desktopApp) {
    throw new OrderError(409, 'Es una sesión de la app de Claude: háblale desde la app o con Remote Control.');
  }
  if (!session.cwd || !existsSync(session.cwd)) {
    throw new OrderError(409, 'La carpeta de la sesión ya no existe.');
  }
  // Al continuar se respeta «Solo mirar»; lo demás sigue en Auto, para no ir pidiendo permisos.
  const mode = managed.get(session.id)?.mode === 'plan' ? 'plan' : DEFAULT_MODE;
  const resumeId = session.id.slice(session.id.indexOf(':') + 1);
  if (session.agent === 'codex') {
    return publicJob(runCodex({ key: session.id, cwd: session.cwd, text, mode, threadId: resumeId }));
  }
  const modeArgs = MODES[mode];
  // La orden va por stdin para que nunca se interprete como una opción del CLI.
  const args = ['-p', '--resume', resumeId, '--permission-mode', modeArgs.claude, '--output-format', 'stream-json', '--verbose', '--include-partial-messages'];

  return publicJob(run({ key: session.id, agent: session.agent, cwd: session.cwd, args, text }));
}

// Opción B: abrir una sesión nueva en la carpeta de un proyecto.
export function startSession({ agent, cwd, mode = DEFAULT_MODE, text: rawText }) {
  const text = validateText(rawText);
  if (agent !== 'claude' && agent !== 'codex') throw new OrderError(400, 'Agente desconocido.');
  if (!MODES[mode]) throw new OrderError(400, 'Nivel de permisos desconocido.');
  if (!cwd || !existsSync(cwd)) throw new OrderError(400, 'La carpeta del proyecto no existe.');

  const title = text.split('\n')[0].slice(0, 90);
  if (agent === 'codex') {
    // Codex decide el id del hilo; hasta que lo anuncia se usa uno provisional.
    const key = `pending:${randomUUID()}`;
    const entry = { id: key, agent, cwd, mode, title, createdAt: Date.now() };
    const job = runCodex({ key, cwd, text, mode, threadId: null, onThreadId: (threadId) => {
      const id = `codex:${threadId}`;
      rekeyJob(key, id);
      registerManaged({ ...entry, id });
    } });
    return { sessionId: job.key, order: publicJob(job) };
  }

  // Con el id decidido de antemano la sesión se puede seguir desde el primer segundo.
  const uuid = randomUUID();
  const key = `claude:${uuid}`;
  const args = ['-p', '--session-id', uuid, '--permission-mode', MODES[mode].claude, '--output-format', 'stream-json', '--verbose', '--include-partial-messages'];
  registerManaged({ id: key, agent, cwd, mode, title, createdAt: Date.now() });
  const job = run({ key, agent, cwd, args, text });
  return { sessionId: job.key, order: publicJob(job) };
}

function validateText(rawText) {
  const text = String(rawText ?? '').trim();
  if (!text) throw new OrderError(400, 'La orden está vacía.');
  if (text.length > MAX_TEXT) throw new OrderError(400, `La orden supera los ${MAX_TEXT} caracteres.`);
  return text;
}

function run({ key, agent, cwd, args, text, onThreadId = null }) {
  const bin = BIN_CANDIDATES[agent].find((path) => path && existsSync(path));
  if (!bin) throw new OrderError(500, `No encuentro el CLI de ${agent}.`);

  const child = spawn(bin, args, {
    cwd,
    env: { ...process.env, PATH: CHILD_PATH },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const job = {
    key,
    agent,
    cwd,
    text,
    child,
    status: 'running',
    startedAt: Date.now(),
    finishedAt: null,
    reply: null,
    error: null,
    activity: { kind: 'thinking', detail: null, at: Date.now() },
    stderr: '',
    stopRequested: false,
    onThreadId,
  };
  jobs.set(key, job);

  const parse = parseClaudeEvent;
  const decoder = new StringDecoder('utf8');
  let buffer = '';
  child.stdout.on('data', (chunk) => {
    buffer += decoder.write(chunk);
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      if (!line.trim().startsWith('{')) continue;
      try {
        parse(JSON.parse(line), job);
      } catch {
        // Línea que no es un evento JSON: se ignora.
      }
    }
  });
  child.stderr.on('data', (chunk) => {
    job.stderr = (job.stderr + chunk.toString('utf8')).slice(-2000);
  });

  const timeout = setTimeout(() => {
    job.error = 'Se ha cancelado tras 30 minutos sin terminar.';
    child.kill('SIGTERM');
  }, MAX_RUNTIME_MS);

  child.on('error', (error) => {
    job.error = `No se pudo lanzar el agente: ${error.message}`;
  });
  child.on('close', (code) => {
    clearTimeout(timeout);
    job.finishedAt = Date.now();
    job.activity = null;
    if (job.stopRequested) {
      // Al pararlo, el CLI cierra con un resultado de error: lo has parado tú, no ha fallado.
      job.status = 'stopped';
      job.error = null;
      return;
    }
    if (code !== 0 && !job.error) job.error = lastLine(job.stderr) || `El agente terminó con código ${code}.`;
    job.status = job.error ? 'failed' : 'done';
  });

  child.stdin.end(text);
  return job;
}

function rekeyJob(oldKey, newKey) {
  const job = jobs.get(oldKey);
  if (!job) return;
  jobs.delete(oldKey);
  job.key = newKey;
  jobs.set(newKey, job);
}

// Eventos de los CLI → respuesta, errores y qué está haciendo el agente.

const CLAUDE_TOOL_KINDS = {
  Read: 'reading', Grep: 'reading', Glob: 'reading', LS: 'reading', WebFetch: 'reading', WebSearch: 'reading',
  Edit: 'editing', Write: 'editing', MultiEdit: 'editing', NotebookEdit: 'editing',
  Bash: 'running', Task: 'delegating', Agent: 'delegating',
};

function setActivity(job, kind, detail = null) {
  job.activity = { kind, detail: detail ? String(detail).slice(0, 80) : null, at: Date.now() };
}

function parseClaudeEvent(event, job) {
  if (event.type === 'rate_limit_event') recordRateLimitEvent(event);
  if (event.type === 'stream_event') {
    const chunk = event.event ?? {};
    if (chunk.type === 'message_start') job.reply = null;
    if (chunk.type === 'content_block_delta' && chunk.delta?.type === 'text_delta') {
      job.reply = ((job.reply ?? '') + (chunk.delta.text ?? '')).slice(0, MAX_REPLY);
      setActivity(job, 'writing');
    } else if (chunk.type === 'content_block_start' && chunk.content_block?.type === 'tool_use') {
      const tool = chunk.content_block;
      setActivity(job, CLAUDE_TOOL_KINDS[tool.name] ?? 'running', tool.name);
    }
  }
  if (event.type === 'assistant') {
    const parts = event.message?.content ?? [];
    for (const part of parts) {
      if (part.type === 'tool_use') {
        const input = part.input ?? {};
        setActivity(job, CLAUDE_TOOL_KINDS[part.name] ?? 'running', input.file_path ?? input.pattern ?? input.command ?? input.description ?? part.name);
      } else if (part.type === 'thinking') {
        setActivity(job, 'thinking');
      }
    }
    const text = parts.filter((part) => part.type === 'text').map((part) => part.text).join('\n');
    if (text) {
      job.reply = text.slice(0, MAX_REPLY);
      setActivity(job, 'writing');
    }
  } else if (event.type === 'result') {
    if (event.is_error) job.error = String(event.result ?? 'Claude devolvió un error.').slice(0, MAX_REPLY);
    else if (event.result) job.reply = String(event.result).slice(0, MAX_REPLY);
  }
}

// ---- Codex por el app-server

function runCodex({ key, cwd, text, mode, threadId, onThreadId = null }) {
  const server = codexServer();
  const job = {
    server,
    key,
    agent: 'codex',
    cwd,
    text,
    status: 'running',
    startedAt: Date.now(),
    finishedAt: null,
    reply: null,
    error: null,
    activity: { kind: 'thinking', detail: null, at: Date.now() },
    stopRequested: false,
    threadId,
    turnId: null,
    approvals: [],
    deltas: {},
  };
  jobs.set(key, job);

  const timeout = setTimeout(() => {
    job.error = 'Se ha cancelado tras 30 minutos sin terminar.';
    interruptCodex(job);
  }, MAX_RUNTIME_MS);
  job.timeout = timeout;

  (async () => {
    try {
      let tid = threadId;
      if (tid) {
        await server.request('thread/resume', { threadId: tid, cwd });
      } else {
        const started = await server.request('thread/start', { cwd });
        tid = started.thread?.id ?? started.threadId;
        if (!tid) throw new Error('Codex no devolvió el id del hilo.');
        if (onThreadId) onThreadId(tid);
      }
      job.threadId = tid;
      server.watch(tid, {
        onNotification: (message) => handleCodexNotification(job, message),
        onServerRequest: (message) => queueApproval(job, message),
        onExit: (reason) => finishCodex(job, reason),
      });
      if (job.stopRequested) {
        finishCodex(job, null);
        return;
      }
      const result = await server.request('turn/start', {
        threadId: tid,
        cwd,
        input: [{ type: 'text', text }],
        approvalPolicy: MODES[mode].codexApproval ?? 'on-request',
        sandboxPolicy: MODES[mode].codex,
      });
      job.turnId = result.turn?.id ?? job.turnId;
      if (job.stopRequested) interruptCodex(job);
    } catch (error) {
      finishCodex(job, codexErrorMessage(error.message));
    }
  })();
  return job;
}

function handleCodexNotification(job, message) {
  const params = message.params ?? {};
  switch (message.method) {
    case 'turn/started':
      job.turnId = params.turn?.id ?? job.turnId;
      break;
    case 'item/started':
    case 'item/completed': {
      const item = params.item ?? {};
      if (item.type === 'agentMessage') {
        job.replyId = item.id;
        if (message.method === 'item/started') job.reply = null;
        if (message.method === 'item/completed' && item.text) job.reply = String(item.text).slice(0, MAX_REPLY);
        setActivity(job, 'writing');
      } else if (item.type === 'commandExecution') {
        setActivity(job, 'running', Array.isArray(item.command) ? item.command.join(' ') : item.command);
      } else if (item.type === 'fileChange') {
        setActivity(job, 'editing', item.changes?.[0]?.path);
      } else if (item.type === 'webSearch') {
        setActivity(job, 'reading', item.query);
      } else if (item.type === 'reasoning') {
        setActivity(job, 'thinking');
      } else if (item.type === 'mcpToolCall') {
        setActivity(job, 'running', item.tool);
      }
      break;
    }
    case 'item/agentMessage/delta': {
      // La respuesta se va viendo mientras se escribe
      const id = params.itemId ?? 'mensaje';
      job.replyId = params.itemId;
      job.deltas[id] = ((job.deltas[id] ?? '') + (params.delta ?? '')).slice(0, MAX_REPLY);
      job.reply = job.deltas[id];
      setActivity(job, 'writing');
      break;
    }
    case 'error':
      if (!params.willRetry) job.error = codexErrorMessage(params.error?.message ?? params.message);
      break;
    case 'turn/completed': {
      const turn = params.turn ?? {};
      if (turn.status === 'failed' && !job.error) job.error = codexErrorMessage(turn.error?.message);
      finishCodex(job, null);
      break;
    }
    default:
      break;
  }
}

// Las esperas interactivas interrumpen el turno para liberar el hilo para la app.
function queueApproval(job, message) {
  const params = message.params ?? {};
  if (['item/commandExecution/requestApproval', 'item/fileChange/requestApproval',
    'item/permissions/requestApproval', 'item/tool/requestUserInput',
    'mcpServer/elicitation/request'].includes(message.method)) {
    job.turnId = params.turnId ?? job.turnId;
    job.pauseReason = message.method === 'item/tool/requestUserInput'
      ? 'Codex necesita tu respuesta.' : 'Codex necesita tu aprobación.';
    job.stopRequested = true;
    interruptCodex(job);
    return;
  }
  job.server.respond(message.id, cancelResult(message));
}

export function answerApproval(sessionId, requestId, decision) {
  const job = jobs.get(sessionId);
  if (!job || job.agent !== 'codex') throw new OrderError(404, 'Esa sesión no tiene peticiones de aprobación.');
  if (!APPROVAL_DECISIONS.has(decision)) throw new OrderError(400, 'Respuesta de aprobación desconocida.');
  const index = job.approvals.findIndex((a) => a.id === String(requestId));
  if (index === -1) throw new OrderError(404, 'Esa petición ya no está pendiente.');
  const [approval] = job.approvals.splice(index, 1);
  const result = approval.method === 'item/permissions/requestApproval'
    ? decision === 'accept' || decision === 'acceptForSession'
      ? { permissions: approval.params.permissions ?? {}, scope: decision === 'acceptForSession' ? 'session' : 'turn' }
      : { permissions: {}, scope: 'turn' }
    : { decision };
  job.server.respond(approval.rpcId, result);
  setActivity(job, 'thinking');
  return publicJob(job);
}

// Indicación sobre la marcha: se añade al turno en curso sin esperar a que termine.
export async function steerJob(sessionId, rawText) {
  const text = validateText(rawText);
  const job = jobs.get(sessionId);
  if (!job || job.agent !== 'codex' || job.status !== 'running' || !job.turnId) {
    throw new OrderError(409, 'Solo se puede corregir sobre la marcha una sesión de Codex que esté trabajando.');
  }
  await job.server.request('turn/steer', { threadId: job.threadId, expectedTurnId: job.turnId, input: [{ type: 'text', text }] });
  return publicJob(job);
}

function interruptCodex(job) {
  if (job.finishing || job.status !== 'running') return;
  if (!job.stopTimeout) {
    job.stopTimeout = setTimeout(() => finishCodex(job, null), STOP_GRACE_MS);
  }
  // Las aprobaciones pendientes se cancelan para que el turno pueda terminar
  for (const approval of job.approvals.splice(0)) {
    job.server.respond(approval.rpcId, approval.method === 'item/permissions/requestApproval' ? { permissions: {}, scope: 'turn' } : { decision: 'cancel' });
  }
  if (job.threadId && job.turnId) {
    job.server.request('turn/interrupt', { threadId: job.threadId, turnId: job.turnId }).catch(() => {});
  }
}

async function finishCodex(job, error) {
  if (job.status !== 'running' || job.finishing) return;
  job.finishing = true;
  clearTimeout(job.timeout);
  clearTimeout(job.stopTimeout);
  if (error && !job.error) job.error = error;
  job.activity = null;
  job.approvals = [];
  if (job.threadId) job.server.unwatch(job.threadId);
  await job.server.close();
  job.finishedAt = Date.now();
  job.status = job.stopRequested && !job.error ? 'stopped' : job.error ? 'failed' : 'done';
}

// Codex a veces mete el error de la API como JSON dentro del mensaje.
function codexErrorMessage(message) {
  if (/already has (?:an active|a live local) writer/i.test(String(message))) {
    return 'La sesión está abierta en Codex u otro cliente. Continúa allí o cierra esa sesión antes de retomarla desde el panel.';
  }
  try {
    return JSON.parse(message).error.message;
  } catch {
    return String(message ?? 'Codex devolvió un error.').slice(0, MAX_REPLY);
  }
}

function lastLine(text) {
  return text.trim().split('\n').pop()?.slice(0, 300) ?? '';
}

function publicJob(job) {
  return {
    status: job.status,
    text: job.text,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    reply: job.reply,
    replyId: job.replyId,
    error: job.error,
    pauseReason: job.pauseReason ?? null,
    activity: job.activity,
    // Peticiones de aprobación de Codex pendientes y si admite indicaciones sobre la marcha
    approvals: (job.approvals ?? []).map((a) => ({ id: a.id, kind: a.kind, summary: a.summary, reason: a.reason })),
    canSteer: job.agent === 'codex' && job.status === 'running' && !job.stopRequested && !job.finishing && Boolean(job.turnId),
  };
}

// Registro de sesiones abiertas desde el panel. Se guarda en `data/` para sobrevivir a reinicios.

function loadManaged() {
  try {
    const list = JSON.parse(readFileSync(MANAGED_FILE, 'utf8'));
    return new Map(list.map((entry) => [entry.id, entry]));
  } catch {
    return new Map();
  }
}

function registerManaged(entry) {
  managed.set(entry.id, entry);
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(MANAGED_FILE, JSON.stringify([...managed.values()], null, 2));
}

export function managedEntry(sessionId) {
  return managed.get(sessionId) ?? null;
}

// Sesiones del panel que el agente aún no ha volcado a su registro (los primeros segundos).
export function pendingManagedSessions(knownIds) {
  const result = [];
  for (const job of jobs.values()) {
    if (knownIds.has(job.key) || job.status !== 'running') continue;
    const entry = managed.get(job.key);
    result.push({
      id: job.key,
      agent: job.agent,
      title: entry?.title ?? job.text.split('\n')[0].slice(0, 90),
      cwd: job.cwd,
      branch: null,
      model: null,
      tokens: 0,
      lastActivity: job.startedAt,
      status: 'working',
    });
  }
  return result;
}

export class OrderError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
