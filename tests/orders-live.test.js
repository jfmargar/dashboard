import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

async function until(check) {
  for (let i = 0; i < 200; i++) {
    if (check()) return;
    await delay(10);
  }
  assert.fail('El agente simulado no emitió el estado esperado');
}

test('Claude entrega texto parcial antes de terminar y conserva UTF-8 fragmentado', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dashboard-live-agent-'));
  const bin = join(dir, 'claude');
  writeFileSync(bin, `#!/usr/bin/env node
if (!process.argv.includes('--include-partial-messages')) process.exit(2);
const send = event => process.stdout.write(JSON.stringify(event) + '\\n');
process.stdin.resume();
process.stdin.on('end', () => {
  send({type:'stream_event',event:{type:'message_start'}});
  const bytes = Buffer.from(JSON.stringify({type:'stream_event',event:{type:'content_block_delta',delta:{type:'text_delta',text:'Sesión'}}}) + '\\n');
  const split = bytes.indexOf(Buffer.from('ó')) + 1;
  process.stdout.write(bytes.subarray(0,split));
  setTimeout(() => process.stdout.write(bytes.subarray(split)), 20);
  setTimeout(() => send({type:'stream_event',event:{type:'content_block_delta',delta:{type:'text_delta',text:' en vivo'}}}), 200);
  setTimeout(() => { send({type:'result',result:'Sesión en vivo'}); }, 400);
});
`, { mode: 0o755 });
  const oldBin = process.env.CLAUDE_BIN;
  process.env.CLAUDE_BIN = bin;
  const { startOrder, jobFor, hasRunningJob, stopJob } = await import('../src/orders.js');
  const id = 'claude:test-live';
  try {
    startOrder({ id, cwd: dir, agent: 'claude', status: 'yours' }, 'Prueba simulada');
    await until(() => jobFor(id).reply === 'Sesión');
    assert.equal(jobFor(id).status, 'running');
    assert.equal(jobFor(id).activity.kind, 'writing');
    await until(() => jobFor(id).reply === 'Sesión en vivo');
    await until(() => jobFor(id).status === 'done');
    assert.equal(jobFor(id).error, null);
  } finally {
    if (hasRunningJob(id)) stopJob(id);
    if (oldBin === undefined) delete process.env.CLAUDE_BIN;
    else process.env.CLAUDE_BIN = oldBin;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Codex empieza cada mensaje sin arrastrar la respuesta anterior', async () => {
  const { readFileSync } = await import('node:fs');
  const vm = await import('node:vm');
  const source = readFileSync(new URL('../src/orders.js', import.meta.url), 'utf8');
  const context = { MAX_REPLY: 16000, setActivity() {} };
  vm.runInNewContext(source.slice(source.indexOf('function handleCodexNotification('), source.indexOf('function queueApproval(')), context);
  const job = { deltas: {} };
  const emit = (method, params) => context.handleCodexNotification(job, { method, params });
  emit('item/agentMessage/delta', { itemId: 'one', delta: 'Primer mensaje' });
  assert.equal(job.replyId, 'one');
  emit('item/started', { item: { type: 'agentMessage', id: 'two' } });
  assert.equal(job.reply, null);
  assert.equal(job.replyId, 'two');
  emit('item/agentMessage/delta', { itemId: 'two', delta: 'Segundo' });
  assert.equal(job.reply, 'Segundo');
  emit('item/completed', { item: { type: 'agentMessage', id: 'two', text: 'Segundo mensaje' } });
  assert.equal(job.reply, 'Segundo mensaje');
});
