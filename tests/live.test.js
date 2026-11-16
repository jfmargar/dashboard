import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { streamSession } from '../src/live.js';

// Prueba el canal HTTP real: cambios, silencio sin cambios, reconexión y cierre.
test('SSE envía fragmentos nuevos y deja de observar al desconectar', async () => {
  let reply = 'Hola';
  let reads = 0;
  let connections = 0;
  const server = createServer((req, res) => {
    connections++;
    streamSession(res, () => { reads++; return { messages: [], order: { status: 'running', reply } }; }, { intervalMs: 10 });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const controller = new AbortController();
  const url = `http://127.0.0.1:${server.address().port}/live`;
  try {
    const response = await fetch(url, { signal: controller.signal });
    assert.match(response.headers.get('content-type'), /text\/event-stream/);
    const reader = response.body.getReader();
    let text = '';
    while (!text.includes('data: ')) text += new TextDecoder().decode((await reader.read()).value);
    assert.match(text, /"reply":"Hola"/);
    reply = 'Hola, sesión en vivo';
    const next = new TextDecoder().decode((await reader.read()).value);
    assert.match(next, /Hola, sesión en vivo/);
    assert.equal(connections, 1);
    controller.abort();
    await delay(30);
    const stopped = reads;
    await delay(30);
    assert.equal(reads, stopped);
    const reconnect = new AbortController();
    const response2 = await fetch(url, { signal: reconnect.signal });
    const reader2 = response2.body.getReader();
    const initial = new TextDecoder().decode((await reader2.read()).value);
    assert.match(initial, /Hola, sesión en vivo/);
    reconnect.abort();
  } finally {
    controller.abort();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
