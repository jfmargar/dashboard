import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

test('panel libera, pausa y retoma el mismo hilo sin ocupar el de otro cliente', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dashboard-codex-handoff-'));
  process.env.CODEX_BIN = fileURLToPath(new URL('./fixtures/codex-handoff.cjs', import.meta.url));
  process.env.DASHBOARD_CODEX_TEST_DIR = dir;
  const { startOrder, jobFor, stopJob } = await import('../src/orders.js');
  const session = { id: 'codex:handoff', cwd: dir, agent: 'codex', status: 'yours' };
  const lock = join(dir, 'handoff.lock');
  async function until(check) {
    for (let i = 0; i < 600; i++) {
      if (check()) return;
      await delay(10);
    }
    assert.fail('La orden no alcanzó el estado esperado');
  }
  try {
    for (const [text, status] of [['done', 'done'], ['question', 'stopped'], ['approval', 'stopped'], ['failed', 'failed'], ['done', 'done']]) {
      startOrder(session, text);
      await until(() => jobFor(session.id).status === status);
      assert.equal(existsSync(lock), false, 'Solo anuncia la parada tras liberar el proceso');
      if (text === 'question' || text === 'approval') assert.ok(jobFor(session.id).pauseReason);
    }
    for (const text of ['working', 'unresponsive']) {
      startOrder(session, text);
      await until(() => jobFor(session.id).canSteer);
      stopJob(session.id);
      await until(() => jobFor(session.id).status === 'stopped');
      assert.equal(existsSync(lock), false);
    }
    const other = { ...session, id: 'codex:other' };
    startOrder(session, 'working');
    startOrder(other, 'working');
    await until(() => jobFor(session.id).canSteer && jobFor(other.id).canSteer);
    stopJob(session.id);
    await until(() => jobFor(session.id).status === 'stopped');
    assert.equal(jobFor(other.id).status, 'running');
    assert.equal(existsSync(join(dir, 'other.lock')), true);
    stopJob(other.id);
    await until(() => jobFor(other.id).status === 'stopped');
    writeFileSync(lock, 'app');
    startOrder(session, 'done');
    await until(() => jobFor(session.id).status === 'failed');
    assert.match(jobFor(session.id).error, /abierta en Codex/);
    assert.equal(readFileSync(lock, 'utf8'), 'app');
    const calls = readFileSync(join(dir, 'rpc.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(calls.some(c => c.method === 'thread/start'), false);
    assert.equal(calls.filter(c => c.method === 'thread/resume' && c.params.threadId === 'handoff').length, 9);
    assert.equal(calls.filter(c => c.method === 'turn/start').length, 9);
  } finally {
    if (jobFor(session.id)?.status === 'running') {
      stopJob(session.id);
      await until(() => jobFor(session.id).status !== 'running');
    }
    rmSync(dir, { recursive: true, force: true });
  }
});
