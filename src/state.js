import { homedir } from 'node:os';
import { withRoles } from './session-roles.js';
import { jobFor, managedEntry, orderModes, pendingManagedSessions } from './orders.js';
import { buildProjects, countStatuses } from './projects.js';
import { readClaude } from './sources/claude.js';
import { readCodex } from './sources/codex.js';
import { readCodexWorkspaces } from './sources/codex-workspaces.js';
import { readVersion } from './version.js';
import { getClaudeUsage } from './claude-usage.js';
import { readTask, wantsTask } from './tasks.js';
import { withoutArchived } from './archive.js';
import { projectHints } from './catalog.js';
import { publicConfig } from './config.js';

export const WINDOW_DAYS = 7;

export function collectState({ home = homedir(), now = Date.now() } = {}) {
  const sinceMs = now - WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const errors = [];

  const codex = safely('codex', () => readCodex({ home, sinceMs, now }), { projects: [], sessions: [], usage: null }, errors);
  const claude = safely('claude', () => readClaude({ home, sinceMs, now }), { sessions: [] }, errors);

  const found = [...codex.sessions, ...claude.sessions];
  const knownIds = new Set(found.map((s) => s.id));
  // Lo archivado en el panel no sale, salvo que haya vuelto a moverse.
  const raw = withoutArchived([...found, ...pendingManagedSessions(knownIds)]).map(withOrder);
  // Plan, paso en curso y última acción de lo que se mueve (vista Misiones).
  const tasks = new Map();
  for (const session of raw) {
    if (wantsTask(session, now)) tasks.set(session.id, safely('task', () => readTask(session.id), null, errors));
  }
  // Un turno cerrado que no te pregunta nada no te toca: la sesión ha terminado.
  const sessions = withRoles(raw.map((session) =>
    session.status === 'yours' && tasks.get(session.id)?.needsYou === false ? { ...session, status: 'done' } : session));
  for (const session of sessions) {
    if (tasks.has(session.id)) session.task = tasks.get(session.id);
  }
  const projects = withLabels(buildProjects({ codexProjects: codex.projects, sessions, home }));

  return {
    generatedAt: now,
    windowDays: WINDOW_DAYS,
    counts: { ...countStatuses(sessions), projects: projects.length },
    projects,
    // Zonas de la oficina y logotipo, de data/config.json (src/config.js).
    ...publicConfig(),
    // Claude no guarda sus límites en local: se recogen de sus respuestas (src/claude-usage.js).
    usage: { codex: codex.usage, claude: getClaudeUsage() },
    orderModes,
    build: readVersion(),
    launchRoots: launchRoots(projects, home),
    errors,
  };
}

// Nombre para los letreros de la oficina (`label`): el de la app en el móvil, si lo tiene, es distinto
// del de la carpeta y no lo comparte con otro proyecto (dos repos de la misma app siguen con su carpeta).
export function withLabels(projects, hints = projectHints) {
  const names = projects.map((project) => (project.roots[0] ? hints(project.roots[0]).appNames[0] : null) ?? null);
  const key = (value) => value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const used = new Map();
  for (const name of names) if (name) used.set(key(name), (used.get(key(name)) ?? 0) + 1);
  projects.forEach((project, index) => {
    const name = names[index];
    if (name && used.get(key(name)) === 1 && key(name) !== key(project.name)) project.label = name;
  });
  return projects;
}

// Una orden en marcha cuenta como trabajo aunque el agente aún no haya escrito nada en su registro.
function withOrder(session) {
  const entry = managedEntry(session.id);
  const order = jobFor(session.id);
  const result = entry ? { ...session, managed: true, mode: entry.mode } : session;
  if (!order) return result;
  return { ...result, order, status: order.status === 'running' ? 'working' : session.status };
}

export function findSession(sessionId) {
  const state = collectState();
  for (const project of state.projects) {
    const session = project.sessions.find((s) => s.id === sessionId);
    if (session) return session;
  }
  return null;
}

// Carpetas donde se puede abrir una sesión nueva: las de los proyectos con actividad y las que tiene
// guardadas la app de Codex.
function launchRoots(projects, home) {
  const roots = [];
  const seen = new Set();
  for (const project of projects) {
    for (const root of project.roots) {
      if (seen.has(root)) continue;
      seen.add(root);
      const folder = root.split('/').pop();
      roots.push({ cwd: root, label: project.roots.length > 1 || folder !== project.name ? `${project.name} · ${folder}` : project.name, recent: true });
    }
  }
  for (const workspace of readCodexWorkspaces({ home })) {
    if (seen.has(workspace.cwd)) continue;
    seen.add(workspace.cwd);
    roots.push({ cwd: workspace.cwd, label: workspace.label, recent: false });
  }
  return roots;
}

function safely(source, read, fallback, errors) {
  try {
    return read();
  } catch (error) {
    errors.push({ source, message: error.message });
    return fallback;
  }
}
