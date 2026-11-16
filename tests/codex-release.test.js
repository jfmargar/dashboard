import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

test('Codex libera su proceso al acabar, fallar o parar sin cerrar otras órdenes', async () => {
  const source = readFileSync(new URL('../src/orders.js', import.meta.url), 'utf8');
  const context = { clearTimeout, Date };
  vm.runInNewContext(source.slice(source.indexOf('async function finishCodex('), source.indexOf('// Codex a veces')), context);
  for (const [stopRequested, error, expected] of [[false, null, 'done'], [false, 'Error simulado', 'failed'], [true, null, 'stopped']]) {
    const calls = [];
    const job = {
      status: 'running', stopRequested, threadId: 'one', approvals: [{}],
      server: {
        unwatch: id => calls.push(['unwatch', id]),
        close: () => { calls.push(['close']); context.finishCodex(job, 'Salida del proceso'); },
      },
    };
    await context.finishCodex(job, error);
    assert.equal(job.status, expected);
    assert.equal(job.error, error || undefined);
    assert.equal(job.activity, null);
    assert.equal(job.approvals.length, 0);
    assert.deepEqual(calls, [['unwatch', 'one'], ['close']]);
    await context.finishCodex(job, null);
    assert.equal(calls.length, 2);
  }
});
