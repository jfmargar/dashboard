import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { findLastJsonl, readJsonlTail, readTextHead } from '../files.js';
import { resolveStatus, WORKING_WINDOW_MS } from '../status.js';
import { SUBAGENT_RECENT_MS } from './subagents.js';
import { registerTranscript } from '../transcripts.js';
import { cleanTitle } from '../text.js';

const TAIL_BYTES = 128 * 1024;
// Hilos que no abre el usuario: tareas programadas y subagentes.
const HIDDEN_SOURCES = ['automation', 'subagent'];
// Rollouts más recientes en los que buscar los límites de uso.
const USAGE_ROLLOUTS = 8;

const turnCache = new Map();

// Base de datos de estado de Codex. El sufijo numérico cambia con las migraciones.
function findStateDb(codexHome) {
  if (!existsSync(codexHome)) return null;
  const candidates = readdirSync(codexHome)
    .map((name) => /^state_(\d+)\.sqlite$/.exec(name))
    .filter(Boolean)
    .sort((a, b) => Number(b[1]) - Number(a[1]));
  return candidates.length ? join(codexHome, candidates[0][0]) : null;
}

export function readCodex({ home, sinceMs, now = Date.now() }) {
  const dbPath = findStateDb(join(home, '.codex'));
  if (!dbPath) return { projects: [], sessions: [], usage: null };

  const db = new DatabaseSync(dbPath, { readOnly: true });
  let projectRows;
  let rootRows;
  let threadRows;
  let subagentRows;
  try {
    projectRows = db.prepare('SELECT id, name, metadata FROM projects').all();
    rootRows = db.prepare('SELECT project_id, path FROM project_roots ORDER BY project_id, position').all();
    const placeholders = HIDDEN_SOURCES.map(() => '?').join(', ');
    // Los subagentes no son sesiones propias: se cuelgan de la sesión que los lanzó.
    subagentRows = db
      .prepare(
        `SELECT id, source, agent_nickname, agent_role, rollout_path, updated_at_ms, model
         FROM threads WHERE thread_source = 'subagent' AND updated_at_ms >= ?`,
      )
      .all(now - SUBAGENT_RECENT_MS);
    threadRows = db
      .prepare(
        `SELECT id, name, title, first_user_message, cwd, git_branch, rollout_path, tokens_used, model, updated_at_ms, thread_source
         FROM threads
         WHERE archived = 0 AND updated_at_ms >= ? AND COALESCE(thread_source, '') NOT IN (${placeholders})
         ORDER BY updated_at_ms DESC`,
      )
      .all(sinceMs, ...HIDDEN_SOURCES);
  } finally {
    db.close();
  }

  const projects = projectRows.map((row) => {
    let metadata = {};
    try {
      metadata = JSON.parse(row.metadata);
    } catch {
      // Metadatos vacíos o corruptos: el proyecto se muestra sin color.
    }
    return {
      id: row.id,
      name: row.name,
      color: metadata['appearance.color'] ?? null,
      roots: rootRows.filter((r) => r.project_id === row.id).map((r) => r.path),
    };
  });

  const sessions = threadRows.map((row) => {
    registerTranscript(`codex:${row.id}`, 'codex', row.rollout_path);
    const turn = readTurn(row.rollout_path);
    const lastActivity = Math.max(row.updated_at_ms, turn.lastActivity ?? 0);
    return {
      id: `codex:${row.id}`,
      agent: 'codex',
      title: cleanTitle(row.name) || cleanTitle(row.title) || cleanTitle(row.first_user_message) || 'Sin título',
      cwd: row.cwd,
      branch: row.git_branch || null,
      model: row.model || null,
      tokens: row.tokens_used || 0,
      lastActivity,
      status: resolveStatus({ turnOpen: turn.open, lastActivity, now }),
      parentId: row.thread_source === 'agent_created_thread' ? readParent(row.rollout_path) : null,
      subagents: [],
    };
  });

  attachSubagents(sessions, subagentRows, now);
  return { projects, sessions, usage: readUsage(threadRows) };
}

function attachSubagents(sessions, rows, now) {
  const byId = new Map(sessions.map((s) => [s.id, s]));
  for (const row of rows) {
    let spawn = null;
    try {
      spawn = JSON.parse(row.source).subagent?.thread_spawn ?? null;
    } catch {
      // Origen sin el formato esperado: no se sabe de quién es.
    }
    const parent = spawn && byId.get(`codex:${spawn.parent_thread_id}`);
    if (!parent) continue;
    const turn = readTurn(row.rollout_path);
    const lastActivity = Math.max(row.updated_at_ms, turn.lastActivity ?? 0);
    parent.subagents.push({
      id: `codex-sub:${row.id}`,
      agent: 'codex',
      kind: row.agent_nickname || spawn.agent_nickname || 'Subagente',
      description: spawn.agent_path ? spawn.agent_path.split('/').pop().replace(/_/g, ' ') : '',
      model: row.model || null,
      lastActivity,
      running: turn.open && now - lastActivity < WORKING_WINDOW_MS,
    });
  }
}

// Las sesiones que abre una coordinadora llevan al principio el encargo con el hilo de origen:
// <codex_delegation><source_thread_id>…</source_thread_id>. El principio no cambia, así que se guarda.
const DELEGATION_HEAD_BYTES = 512 * 1024;
const parentCache = new Map();

function readParent(rolloutPath) {
  if (parentCache.has(rolloutPath)) return parentCache.get(rolloutPath);
  const head = readTextHead(rolloutPath, DELEGATION_HEAD_BYTES);
  const match = /<source_thread_id>([0-9a-f-]{36})<\/source_thread_id>/.exec(head);
  const parentId = match ? `codex:${match[1]}` : null;
  // Un hilo recién creado puede no tener aún el encargo escrito: se vuelve a mirar más tarde.
  if (parentId || head.length >= 4096) parentCache.set(rolloutPath, parentId);
  return parentId;
}

// Codex apunta sus límites de uso en cada evento `token_count`. Se toma el más reciente.
function readUsage(threadRows) {
  let latest = null;
  for (const row of threadRows.slice(0, USAGE_ROLLOUTS)) {
    const rows = readJsonlTail(row.rollout_path, TAIL_BYTES);
    for (let i = rows.length - 1; i >= 0; i--) {
      const limits = rows[i].type === 'event_msg' && rows[i].payload?.type === 'token_count'
        ? rows[i].payload.rate_limits
        : null;
      if (!limits?.primary && !limits?.secondary) continue;
      const observedAt = Date.parse(rows[i].timestamp);
      if (!latest || observedAt > latest.observedAt) {
        latest = {
          plan: limits.plan_type ?? null,
          observedAt,
          windows: [limits.primary, limits.secondary].filter(Boolean).map((w) => ({
            usedPercent: w.used_percent,
            windowMinutes: w.window_minutes,
            resetsAt: w.resets_at * 1000,
          })),
        };
      }
      break;
    }
  }
  return latest;
}

// Un turno de Codex empieza con `task_started` y acaba con `task_complete`.
export function readTurn(rolloutPath) {
  let stat;
  try {
    stat = statSync(rolloutPath);
  } catch {
    return { open: null, lastActivity: null };
  }
  const cached = turnCache.get(rolloutPath);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.turn;

  const boundary = findLastJsonl(rolloutPath, (row) => row.type === 'event_msg' &&
    ['task_started', 'task_complete', 'turn_aborted'].includes(row.payload?.type));
  const open = boundary ? boundary.payload.type === 'task_started' : null;
  const turn = { open, lastActivity: stat.mtimeMs };
  turnCache.set(rolloutPath, { mtimeMs: stat.mtimeMs, size: stat.size, turn });
  return turn;
}
