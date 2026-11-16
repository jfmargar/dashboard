#!/usr/bin/env node
// App-server simulado. Solo escribe en la carpeta de pruebas indicada explícitamente.
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const root = process.env.DASHBOARD_CODEX_TEST_DIR;
if (!root) process.exit(2);
let thread;
let mode;
const send = value => process.stdout.write(JSON.stringify(value) + '\n');
const note = (method, params) => send({ method, params: { threadId: thread, ...params } });
const lock = () => path.join(root, thread + '.lock');
process.on('SIGTERM', () => {
  if (thread && fs.existsSync(lock()) && fs.readFileSync(lock(), 'utf8') === String(process.pid)) fs.unlinkSync(lock());
  process.exit(0);
});
readline.createInterface({ input: process.stdin }).on('line', line => {
  const message = JSON.parse(line);
  const { id, method, params } = message;
  if (id === undefined) return;
  fs.appendFileSync(path.join(root, 'rpc.jsonl'), JSON.stringify({ method, params }) + '\n');
  if (method === 'thread/resume') {
    thread = params.threadId;
    if (fs.existsSync(lock())) return send({ id, error: { message: 'thread already has an active writer' } });
    fs.writeFileSync(lock(), String(process.pid));
  }
  if (method === 'turn/start') {
    mode = params.input[0].text;
    send({ id, result: { turn: { id: 'turn-one' } } });
    note('turn/started', { turn: { id: 'turn-one' } });
    const question = mode === 'question';
    if (question || mode === 'approval') send({ id: 'interactive', method: question ? 'item/tool/requestUserInput' : 'item/commandExecution/requestApproval', params: { threadId: thread, turnId: 'turn-one', questions: [] } });
    if (mode === 'done' || mode === 'failed') note('turn/completed', { turn: { status: mode === 'done' ? 'completed' : 'failed', error: { message: 'Fallo simulado' } } });
    return;
  }
  send({ id, result: {} });
  if (method === 'turn/interrupt' && mode !== 'unresponsive') note('turn/completed', { turn: { status: 'interrupted' } });
});
