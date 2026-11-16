import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { readJsonlTail } from '../files.js';

// Subagentes de Claude Code: `<sesión>/subagents/agent-<id>.jsonl` con su ficha `agent-<id>.meta.json`
// (tipo, encargo, modelo y `finished`). Solo interesan los recientes.
export const SUBAGENT_RECENT_MS = 6 * 60 * 60 * 1000;
// Un subagente sin terminar que lleva este tiempo sin escribir se da por abandonado.
const STALE_MS = 10 * 60 * 1000;
const TAIL_BYTES = 64 * 1024;

const cache = new Map();

export function readClaudeSubagents(sessionDir, now = Date.now()) {
  const dir = join(sessionDir, 'subagents');
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const result = [];
  for (const name of names) {
    const match = /^agent-(.+)\.jsonl$/.exec(name);
    if (!match) continue;
    const path = join(dir, name);
    let stat;
    try {
      stat = statSync(path);
    } catch {
      continue;
    }
    if (now - stat.mtimeMs > SUBAGENT_RECENT_MS) continue;
    const info = readOne(path, join(dir, `agent-${match[1]}.meta.json`), stat);
    if (now - info.lastActivity > SUBAGENT_RECENT_MS) continue;
    const running = !info.finished && !info.turnClosed && now - info.lastActivity < STALE_MS;
    result.push({
      id: `claude-sub:${match[1]}`,
      agent: 'claude',
      kind: info.type,
      description: info.description,
      model: info.model,
      lastActivity: info.lastActivity,
      running,
    });
  }
  return result.sort((a, b) => b.lastActivity - a.lastActivity);
}

function readOne(path, metaPath, stat) {
  const cached = cache.get(path);
  if (cached && cached.mtimeMs === stat.mtimeMs) {
    // La ficha puede marcarse como terminada después del último mensaje.
    cached.info.finished = readMeta(metaPath).finished;
    return cached.info;
  }
  const meta = readMeta(metaPath);
  const messages = readJsonlTail(path, TAIL_BYTES).filter((row) => row.type === 'user' || row.type === 'assistant');
  const last = messages[messages.length - 1];
  const info = {
    type: meta.agentType ?? 'Subagente',
    description: meta.description ?? '',
    model: meta.model ?? null,
    finished: meta.finished,
    // La app puede reescribir registros antiguos: mtime no implica actividad del agente.
    lastActivity: Date.parse(last?.timestamp) || 0,
    turnClosed: last?.type === 'assistant' && last.message?.stop_reason === 'end_turn',
  };
  cache.set(path, { mtimeMs: stat.mtimeMs, info });
  return info;
}

function readMeta(path) {
  try {
    const meta = JSON.parse(readFileSync(path, 'utf8'));
    return { ...meta, finished: meta.finished === true };
  } catch {
    return { finished: false };
  }
}
