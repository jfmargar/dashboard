import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerTranscript, readTranscript } from '../src/transcripts.js';

test('recupera la conversación anterior a una captura que supera la ventana inicial', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dashboard-transcript-'));
  try {
    const path = join(dir, 'session.jsonl');
    const message = (role, text) => ({ type: 'response_item', payload: { type: 'message', id: role + '-id', role, content: [{ text }] } });
    writeFileSync(path, [
      message('user', 'Necesito leer esta conversación'),
      message('assistant', 'Respuesta larga '.repeat(200)),
      { type: 'response_item', payload: { type: 'function_call_output', output: 'x'.repeat(900000) } },
      { type: 'response_item', payload: { type: 'function_call', name: 'captura' } }
    ].map(row => JSON.stringify(row)).join('\n') + '\n');
    registerTranscript('test-large-image', 'codex', path);
    const messages = readTranscript('test-large-image');
    assert.equal(messages[0].text, 'Necesito leer esta conversación');
    assert.equal(messages[1].text, 'Respuesta larga '.repeat(200).trim());
    assert.equal(messages[1].id, 'assistant-id');
    assert.equal(messages[2].role, 'tool');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
