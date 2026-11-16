import { readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Versión del panel (package.json) y rama y commit de la carpeta que se está sirviendo.
// El servicio sirve la copia de trabajo tal cual, así que esto dice qué estás viendo exactamente.
const REPO = fileURLToPath(new URL('..', import.meta.url));

export function readVersion() {
  return { version: packageVersion(), ...gitInfo() };
}

function packageVersion() {
  try {
    return JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')).version ?? null;
  } catch {
    return null;
  }
}

// Se lee `.git` a mano, sin lanzar `git`, igual que al agrupar proyectos.
function gitInfo() {
  try {
    const gitDir = resolveGitDir(join(REPO, '.git'));
    const head = readFileSync(join(gitDir, 'HEAD'), 'utf8').trim();
    const ref = /^ref: (.+)$/.exec(head)?.[1];
    if (!ref) return { branch: null, commit: head.slice(0, 7) };
    const commonDir = resolveCommonDir(gitDir);
    const sha = readRef(gitDir, ref) ?? readRef(commonDir, ref);
    return { branch: ref.replace(/^refs\/heads\//, ''), commit: sha ? sha.slice(0, 7) : null };
  } catch {
    return { branch: null, commit: null };
  }
}

// En un worktree `.git` es un fichero que apunta a la carpeta real.
function resolveGitDir(path) {
  if (statSync(path).isDirectory()) return path;
  const target = /gitdir:\s*(.+)/.exec(readFileSync(path, 'utf8'))?.[1]?.trim();
  return resolve(REPO, target);
}

function resolveCommonDir(gitDir) {
  try {
    return resolve(gitDir, readFileSync(join(gitDir, 'commondir'), 'utf8').trim());
  } catch {
    return gitDir;
  }
}

function readRef(dir, ref) {
  try {
    return readFileSync(join(dir, ref), 'utf8').trim();
  } catch {
    try {
      const packed = readFileSync(join(dir, 'packed-refs'), 'utf8');
      const line = packed.split('\n').find((l) => l.endsWith(` ${ref}`));
      return line ? line.split(' ')[0] : null;
    } catch {
      return null;
    }
  }
}
