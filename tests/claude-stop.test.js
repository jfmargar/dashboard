import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { readClaude } from '../src/sources/claude.js';

test('una sesión de Claude parada no sigue «trabajando»', () => {
  const home = mkdtempSync(join(tmpdir(), 'dashboard-stop-'));
  try {
    const dir = join(home, '.claude/projects/-repo');
    mkdirSync(dir, { recursive: true });
    const at = new Date().toISOString();
    const rows = [
      { type: 'user', cwd: '/repo', timestamp: at, message: { role: 'user', content: 'Cuenta hasta 300' } },
      { type: 'assistant', cwd: '/repo', timestamp: at, message: { role: 'assistant', stop_reason: null, content: [{ type: 'text', text: '1' }] } },
      { type: 'user', cwd: '/repo', timestamp: at, message: { role: 'user', content: [{ type: 'text', text: '[Request interrupted by user]' }] } },
    ];
    writeFileSync(join(dir, 'parada.jsonl'), rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
    const [session] = readClaude({ home, sinceMs: 0 }).sessions;
    assert.equal(session.status, 'yours');
    assert.equal(session.title, 'Cuenta hasta 300');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('parar una orden de Claude no la marca como fallida', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dashboard-stop-order-'));
  const bin = join(dir, 'claude');
  // Como el CLI de verdad: al pararlo (SIGINT, o SIGTERM si tarda) emite un resultado con is_error y sale con código 1.
  writeFileSync(bin, `#!/usr/bin/env node
process.stdin.resume();
process.stdout.write(JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: '1' } } }) + '\\n');
const interrupted = () => {
  process.stdout.write(JSON.stringify({ type: 'result', is_error: true, result: 'Request interrupted' }) + '\\n');
  process.exit(1);
};
process.on('SIGINT', interrupted);
process.on('SIGTERM', interrupted);
setInterval(() => {}, 1000);
`, { mode: 0o755 });
  const oldBin = process.env.CLAUDE_BIN;
  process.env.CLAUDE_BIN = bin;
  const { startOrder, jobFor, stopJob } = await import('../src/orders.js');
  const id = 'claude:test-stop';
  try {
    startOrder({ id, cwd: dir, agent: 'claude', status: 'yours' }, 'Cuenta hasta 300');
    for (let i = 0; i < 200 && jobFor(id).reply !== '1'; i++) await delay(10);
    stopJob(id);
    for (let i = 0; i < 200 && jobFor(id).status === 'running'; i++) await delay(10);
    assert.equal(jobFor(id).status, 'stopped');
    assert.equal(jobFor(id).error, null);
  } finally {
    if (oldBin === undefined) delete process.env.CLAUDE_BIN;
    else process.env.CLAUDE_BIN = oldBin;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('una sesión de Claude que acaba en una captura enorme sigue en el panel', () => {
  const home = mkdtempSync(join(tmpdir(), 'dashboard-big-'));
  try {
    const dir = join(home, '.claude/projects/-repo');
    mkdirSync(dir, { recursive: true });
    const at = new Date().toISOString();
    const rows = [
      { type: 'user', cwd: '/repo', timestamp: at, message: { role: 'user', content: 'Haz una captura' } },
      { type: 'assistant', cwd: '/repo', timestamp: at, message: { role: 'assistant', stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'screenshot', input: {} }] } },
      // Resultado de la herramienta con una imagen de 700 KB: más que la cola que se lee.
      { type: 'user', cwd: '/repo', timestamp: at, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'x'.repeat(700 * 1024) }] } },
    ];
    writeFileSync(join(dir, 'captura.jsonl'), rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
    const [session] = readClaude({ home, sinceMs: 0 }).sessions;
    assert.ok(session, 'la sesión no desaparece');
    assert.equal(session.status, 'working');
    assert.equal(session.title, 'Haz una captura');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
