import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, appendFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readTurn } from '../src/sources/codex.js';
import { resolveStatus } from '../src/status.js';
import { withRoles } from '../src/session-roles.js';
import { countStatuses } from '../src/projects.js';

const session = (id, status, extra = {}) => ({ id, status, title: id, lastActivity: 1000, subagents: [], ...extra });
const event = type => JSON.stringify({ type: 'event_msg', payload: { type } }) + '\n';

test('Codex sigue trabajando aunque el inicio quede detrás de herramientas y capturas grandes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dashboard-status-'));
  const path = join(dir, 'rollout.jsonl');
  try {
    writeFileSync(path, event('task_started') + JSON.stringify({ type: 'response_item', payload: { type: 'function_call_output', output: 'x'.repeat(1024 * 1024) } }) + '\n');
    assert.equal(readTurn(path).open, true);
    appendFileSync(path, '{"type":"event_msg","payload":');
    assert.equal(readTurn(path).open, true, 'una línea a medio escribir no cierra el turno');
    appendFileSync(path, '{"type":"task_complete"}}\n');
    assert.equal(readTurn(path).open, false);
    appendFileSync(path, event('task_started'));
    assert.equal(readTurn(path).open, true);
    appendFileSync(path, event('turn_aborted'));
    assert.equal(readTurn(path).open, false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('un registro sin señales de turno no se presenta como terminado', () => {
  assert.equal(resolveStatus({ turnOpen: null, lastActivity: 1000, now: 1001 }), 'idle');
  assert.equal(resolveStatus({ turnOpen: true, lastActivity: 1000, now: 1001 }), 'working');
  assert.equal(resolveStatus({ turnOpen: false, lastActivity: 1000, now: 1001 }), 'yours');
});

test('una sesión sola conserva su estado y compartir proyecto no implica coordinación', () => {
  const result = withRoles([session('a', 'working', { cwd: '/project' }), session('b', 'yours', { cwd: '/project' })]);
  assert.equal(result[0].status, 'working');
  assert.equal(result[1].status, 'yours');
  assert.equal(result[0].role, null);
  assert.equal(result[1].role, null);
});

test('una coordinadora permanece ocupada mientras trabaja una sesión hija', () => {
  const result = withRoles([session('parent', 'yours'), session('child', 'working', { parentId: 'parent', lastActivity: 2000 })]);
  assert.equal(result[0].status, 'working');
  assert.equal(result[0].role, 'coordinator');
  assert.equal(result[0].waitingForTeam, true);
  assert.equal(result[0].lastActivity, 2000);
  assert.equal(result[1].status, 'working');
});

test('las hijas terminadas devuelven el control a su coordinadora sin sumar avisos al usuario', () => {
  const result = withRoles([session('parent', 'yours'), session('child', 'yours', { parentId: 'parent' })]);
  assert.equal(result[0].status, 'yours');
  assert.equal(result[1].status, 'idle');
  assert.equal(result[1].completedForParent, true);
  assert.deepEqual(countStatuses(result), { working: 0, yours: 1, done: 0, idle: 1 });
});

test('se considera el trabajo de subagentes y coordinadoras anidadas', () => {
  const result = withRoles([
    session('root', 'yours'), session('middle', 'yours', { parentId: 'root' }),
    session('leaf', 'yours', { parentId: 'middle', subagents: [{ running: true, lastActivity: 3000 }] }),
  ]);
  assert.ok(result.every(s => s.status === 'working'));
  assert.ok(result.every(s => s.waitingForTeam));
  assert.equal(result[0].lastActivity, 3000);
});

test('una sesión con coordinadora ausente sigue pudiendo reclamar atención', () => {
  const result = withRoles([session('orphan', 'yours', { parentId: 'missing' })]);
  assert.equal(result[0].status, 'yours');
  assert.equal(result[0].completedForParent, false);
});
