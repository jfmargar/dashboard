import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { zoneForPath } from './config.js';

// Carpetas temporales que Codex y Claude crean para conversaciones sin repositorio.
const SCRATCH_PATTERNS = [/\/Documents\/Codex\//, /\/scratch-workspaces\//, /^\/private\/tmp\//, /^\/tmp\//];
const SCRATCH_ROOT = 'scratch';

const repoRootCache = new Map();

// Agrupa las sesiones de ambos agentes por repositorio y, cuando existe, por proyecto de Codex.
export function buildProjects({ codexProjects, sessions, home }) {
  const projectsById = new Map();

  for (const session of sessions) {
    const repoRoot = resolveRepoRoot(session.cwd);
    const codexProject = repoRoot === SCRATCH_ROOT ? null : matchCodexProject(repoRoot, codexProjects);
    const id = codexProject ? `codex:${codexProject.id}` : `path:${repoRoot}`;

    let project = projectsById.get(id);
    if (!project) {
      project = createProject({ id, repoRoot, codexProject, home });
      projectsById.set(id, project);
    }
    project.sessions.push({
      ...session,
      worktree: repoRoot !== SCRATCH_ROOT && session.cwd !== repoRoot && !session.cwd?.startsWith(`${repoRoot}/`),
    });
  }

  const projects = [...projectsById.values()];
  for (const project of projects) {
    project.sessions.sort((a, b) => b.lastActivity - a.lastActivity);
    project.lastActivity = project.sessions[0].lastActivity;
    project.counts = countStatuses(project.sessions);
  }
  return projects.sort((a, b) => b.lastActivity - a.lastActivity);
}

function createProject({ id, repoRoot, codexProject, home }) {
  if (repoRoot === SCRATCH_ROOT) {
    return { id, name: 'Chats sueltos', color: null, zone: 'otros', roots: [], sessions: [] };
  }
  const roots = codexProject ? codexProject.roots : [repoRoot];
  return {
    id,
    name: codexProject ? codexProject.name : basename(repoRoot),
    color: codexProject?.color ?? null,
    zone: zoneForPath(roots[0] ?? repoRoot, home),
    // Carpetas en las que se puede abrir una sesión nueva desde el panel.
    roots: roots.filter((root) => root.startsWith('/') && existsSync(root)),
    sessions: [],
  };
}

export function countStatuses(sessions) {
  const counts = { working: 0, yours: 0, done: 0, idle: 0 };
  for (const session of sessions) counts[session.status] += 1;
  return counts;
}

// Repositorio principal de una carpeta, también cuando la sesión corre en un worktree.
// Se resuelve leyendo `.git` a mano: lanzar `git` por cada carpeta tarda segundos.
export function resolveRepoRoot(cwd) {
  if (!cwd) return SCRATCH_ROOT;
  if (repoRootCache.has(cwd)) return repoRootCache.get(cwd);

  const root = SCRATCH_PATTERNS.some((pattern) => pattern.test(cwd))
    ? SCRATCH_ROOT
    : findGitRoot(cwd) ?? stripWorktreeSuffix(cwd);
  repoRootCache.set(cwd, root);
  return root;
}

function findGitRoot(cwd) {
  let dir = cwd;
  while (dir !== dirname(dir)) {
    const gitPath = join(dir, '.git');
    let stat;
    try {
      stat = statSync(gitPath);
    } catch {
      dir = dirname(dir);
      continue;
    }
    if (stat.isDirectory()) return dir;
    // En un worktree `.git` es un fichero: "gitdir: /repo/.git/worktrees/<nombre>".
    try {
      const gitdir = /gitdir:\s*(.+)/.exec(readFileSync(gitPath, 'utf8'))?.[1]?.trim();
      const match = gitdir && /^(.*)\/\.git\/worktrees\/[^/]+$/.exec(resolve(dir, gitdir));
      return match ? match[1] : dir;
    } catch {
      return dir;
    }
  }
  return null;
}

// Para worktrees que ya no existen en disco.
function stripWorktreeSuffix(cwd) {
  // Codex: ~/.codex/worktrees/<id>/<repo>. Solo queda el nombre del repositorio.
  const codex = /\/\.codex\/worktrees\/[^/]+\/([^/]+)/.exec(cwd);
  if (codex) return codex[1];
  const claude = /^(.*?)\/(?:\.claude\/worktrees|worktrees)\/[^/]+/.exec(cwd);
  return claude ? claude[1] : cwd;
}

function matchCodexProject(repoRoot, codexProjects) {
  const exact = codexProjects.filter((p) => p.roots.includes(repoRoot));
  if (exact.length) {
    // Si el repositorio está en varios proyectos, gana el que agrupa más carpetas (p. ej. Android + iOS).
    return exact.sort((a, b) => b.roots.length - a.roots.length)[0];
  }
  // Proyectos de Codex que apuntan a una subcarpeta del repositorio.
  const nested = codexProjects.find((p) => p.roots.some((root) => root.startsWith(`${repoRoot}/`)));
  if (nested) return nested;
  // Worktree de Codex ya borrado: solo se conoce el nombre de la carpeta.
  if (!repoRoot.includes('/')) {
    return codexProjects.find((p) => p.roots.some((root) => basename(root) === repoRoot)) ?? null;
  }
  return null;
}

