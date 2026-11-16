import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from './data-dir.js';
import { OrderError } from './orders.js';

// Sesiones archivadas en el panel: dejan de salir en la oficina, Misiones y el panel hasta que
// vuelven a tener actividad. Es solo del panel: no toca las apps de Claude ni de Codex.
// Vive en `data/archived.json` (ignorado por git), como `{ id: momento en que se archivó }`.
const FILE = join(DATA_DIR, 'archived.json');
let archived = null;

function load() {
  if (archived) return archived;
  try {
    archived = JSON.parse(readFileSync(FILE, 'utf8'));
  } catch {
    archived = {};
  }
  return archived;
}

function save() {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(FILE, JSON.stringify(archived, null, 2));
}

export function archiveSessions(ids, now = Date.now()) {
  if (!Array.isArray(ids) || !ids.length || ids.some((id) => typeof id !== 'string' || !id)) {
    throw new OrderError(400, 'Indica qué sesiones archivar.');
  }
  load();
  for (const id of ids) archived[id] = now;
  save();
  return { archived: ids.length };
}

// Fuera lo archivado, salvo lo que ha tenido actividad después de archivarlo.
export function withoutArchived(sessions, list = load()) {
  return sessions.filter((session) => {
    const at = list[session.id];
    return !at || session.lastActivity > at;
  });
}
