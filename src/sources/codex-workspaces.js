import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';

// Carpetas que la app de escritorio de Codex tiene guardadas como proyectos (`.codex-global-state.json`),
// con la etiqueta que les diste en la app si la tienen.
let cache = { mtimeMs: 0, roots: [] };

export function readCodexWorkspaces({ home }) {
  const path = join(home, '.codex', '.codex-global-state.json');
  let stat;
  try {
    stat = statSync(path);
  } catch {
    return [];
  }
  if (stat.mtimeMs === cache.mtimeMs) return cache.roots;
  let roots = [];
  try {
    const state = JSON.parse(readFileSync(path, 'utf8'));
    const labels = state['electron-workspace-root-labels'] ?? {};
    const saved = [...new Set(state['electron-saved-workspace-roots'] ?? [])];
    roots = saved
      .filter((root) => typeof root === 'string' && root.startsWith('/') && existsSync(root))
      .map((root) => ({ cwd: root, label: String(labels[root] ?? '').trim() || basename(root) }));
  } catch {
    // Fichero a medio escribir: se usa la última lectura buena.
    return cache.roots;
  }
  cache = { mtimeMs: stat.mtimeMs, roots };
  return roots;
}
