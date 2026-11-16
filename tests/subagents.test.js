import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readClaudeSubagents } from '../src/sources/subagents.js';
import { withRoles } from '../src/session-roles.js';

test('reescribir un registro antiguo no reactiva al subagente ni a su sesión', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dashboard-subagents-'));
  const now = Date.now();
  try {
    mkdirSync(join(dir, 'subagents'));
    const path = join(dir, 'subagents', 'agent-old.jsonl');
    const writeMessage = timestamp => writeFileSync(path, JSON.stringify({
      type: 'assistant', timestamp: new Date(timestamp).toISOString(),
      message: { stop_reason: 'tool_use', content: [] },
    }) + '\n');
    writeMessage(now - 24 * 60 * 60 * 1000);
    assert.deepEqual(readClaudeSubagents(dir, now), []);
    writeMessage(now - 11 * 60 * 1000);
    const stale = readClaudeSubagents(dir, now);
    assert.equal(stale[0].running, false);
    assert.equal(stale[0].lastActivity, now - 11 * 60 * 1000);
    assert.equal(withRoles([{ id: 'parent', title: 'Parent', status: 'idle', lastActivity: 1, subagents: stale }])[0].status, 'idle');
    writeMessage(now - 1000);
    assert.equal(readClaudeSubagents(dir, now)[0].running, true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
