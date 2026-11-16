import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// La app de escritorio de Claude guarda aparte sus propias fichas de sesión: título y, en las
// sesiones que abrió otra, `spawnedFrom` con la sesión de origen (la coordinadora).
const fileCache = new Map();

export function readClaudeDesktop({ home }) {
  const root = join(home, 'Library', 'Application Support', 'Claude', 'claude-code-sessions');
  const byCliId = new Map();
  if (!existsSync(root)) return byCliId;

  const localToCli = new Map();
  const entries = [];
  for (const path of sessionFiles(root)) {
    const entry = readEntry(path);
    if (!entry?.cliSessionId) continue;
    localToCli.set(entry.localId, entry.cliSessionId);
    entries.push(entry);
  }
  for (const entry of entries) {
    const parentCli = entry.spawnedFrom ? localToCli.get(entry.spawnedFrom) : null;
    byCliId.set(entry.cliSessionId, {
      title: entry.title,
      parentId: parentCli ? `claude:${parentCli}` : null,
      remoteUrl: entry.remoteUrl,
    });
  }
  return byCliId;
}

function sessionFiles(root) {
  const files = [];
  for (const account of safeList(root)) {
    for (const org of safeList(join(root, account))) {
      for (const name of safeList(join(root, account, org))) {
        if (name.startsWith('local_') && name.endsWith('.json')) files.push(join(root, account, org, name));
      }
    }
  }
  return files;
}

function safeList(dir) {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function readEntry(path) {
  let stat;
  try {
    stat = statSync(path);
  } catch {
    return null;
  }
  const cached = fileCache.get(path);
  if (cached && cached.mtimeMs === stat.mtimeMs) return cached.entry;
  let entry = null;
  try {
    const data = JSON.parse(readFileSync(path, 'utf8'));
    entry = {
      localId: data.sessionId,
      cliSessionId: data.cliSessionId,
      title: typeof data.title === 'string' ? data.title : null,
      spawnedFrom: data.spawnedFrom?.sessionId ?? null,
      remoteUrl: remoteUrl(data.bridgeSessionIds),
    };
  } catch {
    // Ficha a medio escribir: se vuelve a leer en el siguiente refresco.
  }
  fileCache.set(path, { mtimeMs: stat.mtimeMs, entry });
  return entry;
}

// Remote Control: la app enlaza cada sesión con una de claude.ai/code (`bridgeSessionIds`, la última es
// la vigente). Abrirla en el navegador o en la app del iPhone sigue la misma conversación que en el Mac.
function remoteUrl(ids) {
  const id = Array.isArray(ids) ? ids.filter((value) => /^session_[A-Za-z0-9]+$/.test(String(value))).pop() : null;
  return id ? `https://claude.ai/code/${id}` : null;
}
