import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerTranscript } from '../src/transcripts.js';
import { readTask, applyPlanCall, actionLabel, shortCommand, wantsTask } from '../src/tasks.js';
import { teamStatus } from '../src/session-roles.js';

const lines = (rows) => rows.map((row) => JSON.stringify(row)).join('\n') + '\n';
const claudeTool = (name, input) => ({ type: 'assistant', message: { content: [{ type: 'tool_use', name, input }] } });
const claudeText = (text) => ({ type: 'assistant', message: { content: [{ type: 'text', text }] } });

function withLog(rows, agent, run) {
  const dir = mkdtempSync(join(tmpdir(), 'dashboard-task-'));
  try {
    const path = join(dir, 'session.jsonl');
    writeFileSync(path, lines(rows));
    const id = `${agent}:${dir}`;
    registerTranscript(id, agent, path);
    run(id, path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('la app de Claude: lista entera y luego avances, cierres y comienzos', () => {
  withLog([
    claudeTool('mcp__ccd_turn__update_plan', { items: [
      { content: 'Leer', status: 'in_progress' }, { content: 'Cambiar', status: 'pending' },
      { content: 'Probar', status: 'pending' }, { content: 'Commit', status: 'pending' }] }),
    claudeTool('Read', { file_path: '/repo/src/state.js' }),
    claudeTool('mcp__ccd_turn__update_plan', { advance: true }),
    claudeTool('Edit', { file_path: '/repo/public/office.js' }),
    claudeTool('mcp__ccd_turn__update_plan', { done: [2, 3], start: 4 }),
    claudeTool('Bash', { command: 'cd /repo && npm test 2>&1 | tail -3' })
  ], 'claude', (id) => {
    const task = readTask(id);
    assert.deepEqual(task.plan.map((s) => s.status), ['completed', 'completed', 'completed', 'in_progress']);
    assert.deepEqual(task.current, { text: 'Commit', index: 3, done: 3, total: 4 });
    assert.equal(task.lastAction, 'Ejecutando npm test');
  });
});

test('al cerrar el turno en la app de Claude todos los pasos quedan hechos', () => {
  const plan = applyPlanCall([{ text: 'A', status: 'completed' }, { text: 'B', status: 'in_progress' }], 'mcp__ccd_turn__wrap_up', {});
  assert.deepEqual(plan.map((s) => s.status), ['completed', 'completed']);
});

test('Claude en la terminal: el último TodoWrite manda y el texto final es la última acción', () => {
  withLog([
    claudeTool('TodoWrite', { todos: [{ content: 'Viejo', status: 'pending' }] }),
    claudeTool('TodoWrite', { todos: [
      { content: 'Diseñar', status: 'completed', activeForm: 'Diseñando' }, { content: 'Programar', status: 'pending', activeForm: 'Programando' }] }),
    claudeText('He terminado el **diseño**; sigo con el código.')
  ], 'claude', (id) => {
    const task = readTask(id);
    assert.deepEqual(task.plan.map((s) => s.text), ['Diseñar', 'Programar']);
    assert.deepEqual(task.current, { text: 'Programar', index: 1, done: 1, total: 2 });
    assert.equal(task.lastAction, 'He terminado el diseño; sigo con el código.');
  });
});

test('Codex: update_plan, objetivo del hilo y acciones de sus items', () => {
  const item = (value) => ({ type: 'event_msg', payload: { type: 'item_completed', item: value } });
  withLog([
    { type: 'event_msg', payload: { type: 'thread_goal_updated', goal: { objective: 'Terminar la milestone de octubre' } } },
    { type: 'response_item', payload: { type: 'function_call', name: 'update_plan', arguments: JSON.stringify({ plan: [
      { step: 'Reproducir', status: 'completed' }, { step: 'Corregir', status: 'in_progress' }, { step: 'Tests', status: 'pending' }] }) } },
    item({ type: 'CommandExecution', command: ['/bin/zsh', '-lc', 'cd /repo && git status --short'] }),
    item({ type: 'Reasoning' }),
    item({ type: 'FileChange', changes: { '/repo/src/a.ts': {}, '/repo/src/b.ts': {} } })
  ], 'codex', (id) => {
    const task = readTask(id);
    assert.equal(task.goal, 'Terminar la milestone de octubre');
    assert.deepEqual(task.current, { text: 'Corregir', index: 1, done: 1, total: 3 });
    assert.equal(task.lastAction, 'Editando a.ts y 1 más');
  });
});

test('sin plan: plan vacío, sin paso en curso y con la última acción', () => {
  withLog([claudeTool('Grep', { pattern: 'readTask' })], 'claude', (id) => {
    const task = readTask(id);
    assert.deepEqual(task.plan, []);
    assert.equal(task.current, null);
    assert.equal(task.lastAction, 'Buscando readTask');
  });
});

test('la caché solo lee lo añadido y no pierde una línea a medio escribir', () => {
  withLog([
    claudeTool('mcp__ccd_turn__update_plan', { items: [{ content: 'Uno', status: 'in_progress' }, { content: 'Dos', status: 'pending' }] })
  ], 'claude', (id, path) => {
    assert.equal(readTask(id).current.text, 'Uno');
    const next = JSON.stringify(claudeTool('mcp__ccd_turn__update_plan', { advance: true }));
    appendFileSync(path, next.slice(0, 20));
    assert.equal(readTask(id).current.text, 'Uno', 'la línea a medias no cuenta');
    appendFileSync(path, next.slice(20) + '\n' + JSON.stringify(claudeTool('Write', { file_path: '/repo/README.md' })) + '\n');
    const task = readTask(id);
    assert.equal(task.current.text, 'Dos');
    assert.equal(task.lastAction, 'Editando README.md');
  });
});

test('la última acción se cuenta en palabras', () => {
  assert.equal(shortCommand('cd /repo && FOO=1 time npm run build -- --watch'), 'npm run build');
  assert.equal(shortCommand('git -C /repo log --oneline -3'), 'git -C /repo');
  assert.equal(actionLabel('mcp__Claude_Browser__computer', {}), 'Probando en el navegador');
  assert.equal(actionLabel('mcp__Claude_Code_iOS_Simulator__control', {}), 'Probando en el simulador');
  assert.equal(actionLabel('mcp__postman__runCollection', {}), 'Usando runCollection');
  assert.ok(actionLabel('Bash', { command: 'x'.repeat(200) }).length <= 60);
});

test('solo se lee la tarea de lo que trabaja, espera o acabó en las últimas 24 h', () => {
  const now = Date.now();
  assert.ok(wantsTask({ status: 'working', lastActivity: 0 }, now));
  assert.ok(wantsTask({ status: 'idle', lastActivity: now - 60 * 60 * 1000 }, now));
  assert.ok(!wantsTask({ status: 'idle', lastActivity: now - 2 * 24 * 60 * 60 * 1000 }, now));
});

test('el equipo toma el estado del miembro que más urge', () => {
  assert.equal(teamStatus([{ status: 'idle' }, { status: 'working' }]), 'working');
  assert.equal(teamStatus([{ status: 'working', ownStatus: 'yours', waitingForTeam: true }, { status: 'working' }]), 'working',
    'una coordinadora que espera a sus delegadas trabaja, no te espera');
  assert.equal(teamStatus([{ status: 'yours' }, { status: 'working', order: { approvals: [{}] } }]), 'approval');
  assert.equal(teamStatus([{ status: 'idle' }, { status: 'idle', ownStatus: 'yours', completedForParent: true }]), 'idle');
});

test('un turno terminado te toca solo si te pregunta algo', () => {
  // La app de Claude: manda el cuadro de cierre.
  withLog([
    { type: 'user', message: { content: 'Arregla el bucle' } },
    claudeText('Arreglado en el commit abc.'),
    claudeTool('mcp__ccd_turn__wrap_up', { recap: 'Arreglado', ask: '¿Hago commit en release?' })
  ], 'claude', (id) => assert.equal(readTask(id).needsYou, true));
  withLog([
    { type: 'user', message: { content: 'Arregla el bucle' } },
    claudeText('¿Lo quieres en otra rama? Da igual, lo he dejado en develop.'),
    claudeTool('mcp__ccd_turn__wrap_up', { recap: 'Hecho en develop' })
  ], 'claude', (id) => assert.equal(readTask(id).needsYou, false, 'sin pregunta en el cierre, ha terminado'));
  // Sin cierre de la app: el final del último mensaje.
  withLog([
    { type: 'user', message: { content: 'Revisa el login' } },
    claudeText('Revisado. No he encontrado nada raro.')
  ], 'claude', (id) => assert.equal(readTask(id).needsYou, false));
  withLog([
    { type: 'user', message: { content: 'Revisa el login' } },
    claudeText('He visto dos opciones.\n\n¿Cuál prefieres?')
  ], 'claude', (id) => assert.equal(readTask(id).needsYou, true));
  // Codex: su herramienta para preguntarte manda; un turno nuevo empieza de cero.
  const item = (value) => ({ type: 'event_msg', payload: { type: 'item_completed', item: value } });
  withLog([
    item({ type: 'UserMessage' }),
    { type: 'response_item', payload: { type: 'function_call', name: 'request_user_input', arguments: '{}' } },
    item({ type: 'AgentMessage', text: 'Necesito que elijas.' })
  ], 'codex', (id) => assert.equal(readTask(id).needsYou, true));
  withLog([
    item({ type: 'UserMessage' }),
    { type: 'response_item', payload: { type: 'function_call', name: 'request_user_input', arguments: '{}' } },
    item({ type: 'UserMessage' }),
    item({ type: 'AgentMessage', text: 'Listo, integrado en develop.' })
  ], 'codex', (id) => assert.equal(readTask(id).needsYou, false));
});
