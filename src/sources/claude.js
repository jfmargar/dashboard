import { existsSync, readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { readJsonlHead, readJsonlTail, scanJsonlBackward } from '../files.js';
import { readClaudeDesktop } from './claude-desktop.js';
import { readClaudeSubagents } from './subagents.js';
import { registerTranscript } from '../transcripts.js';
import { resolveStatus } from '../status.js';
import { cleanTitle } from '../text.js';

const HEAD_BYTES = 64 * 1024;
const TAIL_BYTES = 512 * 1024;
// Si la cola es una sola línea enorme (una captura), se busca más atrás hasta aquí, saltándola.
const DEEP_BYTES = 8 * 1024 * 1024;

const sessionCache = new Map();

export function readClaude({ home, sinceMs, now = Date.now() }) {
  const projectsDir = join(home, '.claude', 'projects');
  if (!existsSync(projectsDir)) return { sessions: [] };

  const desktop = readClaudeDesktop({ home });
  const sessions = [];
  for (const dir of readdirSync(projectsDir)) {
    const dirPath = join(projectsDir, dir);
    let entries;
    try {
      entries = readdirSync(dirPath);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (!name.endsWith('.jsonl')) continue;
      const path = join(dirPath, name);
      let stat;
      try {
        stat = statSync(path);
      } catch {
        continue;
      }
      if (stat.mtimeMs < sinceMs) continue;
      const info = readSession(path, stat);
      if (!info) continue;
      const cliId = basename(name, '.jsonl');
      registerTranscript(`claude:${cliId}`, 'claude', path);
      // El título que ves en la app de escritorio manda sobre el que se deduce del registro.
      const meta = desktop.get(cliId);
      sessions.push({
        id: `claude:${cliId}`,
        agent: 'claude',
        title: meta?.title || info.title || 'Sin título',
        parentId: meta?.parentId ?? null,
        // Sesión de la app de escritorio: lo que se le manda desde el panel no aparece en la app.
        desktopApp: Boolean(meta),
        remoteUrl: meta?.remoteUrl ?? null,
        cwd: info.cwd,
        branch: info.branch,
        model: info.model,
        tokens: 0,
        lastActivity: info.lastActivity,
        status: resolveStatus({ turnOpen: info.turnOpen, lastActivity: info.lastActivity, now }),
        subagents: readClaudeSubagents(join(dirPath, cliId), now),
      });
    }
  }
  return { sessions };
}

function readSession(path, stat) {
  const cached = sessionCache.get(path);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.info;

  const isMessage = (row) => (row.type === 'user' || row.type === 'assistant') && !row.isSidechain;
  let tail = readJsonlTail(path, TAIL_BYTES);
  let messages = tail.filter(isMessage);
  // Una captura de más de 512 KB al final no deja ninguna línea completa en la cola: sin esto la sesión
  // desaparecía del panel mientras la escribía (y su coordinadora parecía terminada).
  if (messages.length === 0) {
    const rows = [];
    scanJsonlBackward(path, (row) => {
      rows.unshift(row);
      return isMessage(row);
    }, DEEP_BYTES);
    tail = rows;
    messages = rows.filter(isMessage);
  }
  if (messages.length === 0) {
    sessionCache.set(path, { mtimeMs: stat.mtimeMs, size: stat.size, info: null });
    return null;
  }

  const last = messages[messages.length - 1];
  const customTitle = findLast(tail, (row) => row.type === 'custom-title')?.customTitle;
  const summary = findLast(tail, (row) => row.type === 'summary')?.summary;
  const model = findLast(messages, (row) => row.type === 'assistant' && row.message?.model)?.message.model;

  const head = readJsonlHead(path, HEAD_BYTES);
  // La carpeta de arranque define el proyecto aunque luego el agente haga `cd` a una subcarpeta.
  const firstCwd = head.find((row) => row.cwd)?.cwd;

  const info = {
    title: cleanTitle(customTitle) || cleanTitle(summary) || firstPrompt(head, messages),
    cwd: firstCwd ?? last.cwd,
    branch: last.gitBranch && last.gitBranch !== 'HEAD' ? last.gitBranch : null,
    model: model ?? null,
    turnOpen: isTurnOpen(last),
    lastActivity: Date.parse(last.timestamp) || stat.mtimeMs,
  };
  sessionCache.set(path, { mtimeMs: stat.mtimeMs, size: stat.size, info });
  return info;
}

// El turno sigue abierto tras un mensaje del usuario, una llamada a herramienta o un mensaje a medio escribir.
// Errores de la API (`isApiErrorMessage`) y `end_turn`, `stop_sequence`, `max_tokens`… lo cierran.
const OPEN_STOP_REASONS = new Set([null, undefined, 'tool_use', 'pause_turn']);

function isTurnOpen(last) {
  // Parar (en la app, la terminal o el panel) deja un mensaje «tuyo» que en realidad cierra el turno.
  if (last.type === 'user' && isInterruption(last)) return false;
  if (last.type !== 'assistant') return true;
  if (last.isApiErrorMessage) return false;
  return OPEN_STOP_REASONS.has(last.message?.stop_reason);
}

function isInterruption(row) {
  const content = row.message?.content;
  const text = typeof content === 'string' ? content : Array.isArray(content) && content.length === 1 ? content[0]?.text : null;
  return typeof text === 'string' && text.startsWith('[Request interrupted by user');
}

function firstPrompt(head, tailMessages) {
  const rows = [...head, ...tailMessages];
  for (const row of rows) {
    if (row.type !== 'user' || row.isSidechain || row.isMeta) continue;
    const content = row.message?.content;
    const text = typeof content === 'string'
      ? content
      : Array.isArray(content)
        ? content.find((part) => part.type === 'text')?.text
        : null;
    const title = cleanTitle(text);
    if (title) return title;
  }
  return '';
}

function findLast(rows, predicate) {
  for (let i = rows.length - 1; i >= 0; i--) {
    if (predicate(rows[i])) return rows[i];
  }
  return undefined;
}
