import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { OrderError } from './orders.js';
import { binCandidates } from './bins.js';
import { getConfig } from './config.js';

// Datask por su CLI (`datask`, con la sesión guardada en el llavero). En Datask cada presupuesto,
// evolutivo o mantenimiento es un proyecto distinto del mismo cliente y el original suele estar cerrado,
// así que el código de la carpeta no basta: se proponen candidatos y se recuerda lo que eliges.
const BINS = binCandidates('DATASK_BIN', ['/opt/homebrew/bin/datask', '/usr/local/bin/datask', join(homedir(), '.local/bin/datask')]);
const CHILD_PATH = [join(homedir(), '.local/bin'), '/opt/homebrew/bin', '/usr/local/bin', process.env.PATH].join(':');
const TIMEOUT_MS = 60 * 1000;
const PROJECTS_TTL_MS = 60 * 60 * 1000;
const MY_TASKS_TTL_MS = 10 * 60 * 1000;
// Estados de proyecto que da la API. La especificación no los nombra; por los datos, 2 es cerrado.
const CLOSED = 2;
const MAX_CANDIDATES = 6;

const cache = { projects: null, myTasks: null, userId: undefined, lists: new Map() };

export function dataskBin() {
  return BINS.find((path) => path && existsSync(path)) ?? null;
}

// Candidatos para el proyecto del panel `entry` (puede ser null), del más probable al menos.
// Sin proyecto, se busca con las palabras de la nota.
export async function dataskCandidates(entry, noteText = '') {
  const [projects, myTasks] = await Promise.all([allProjects(), myTasks_()]);
  const byId = new Map(projects.map((p) => [p.id, p]));
  const openTasks = new Map();
  for (const task of myTasks) openTasks.set(task.projectId, (openTasks.get(task.projectId) ?? 0) + 1);
  const words = entry ? keywords(entry) : textWords(noteText);
  const list = [];
  const push = (project, reason) => {
    if (!project || list.some((c) => c.id === project.id)) return;
    list.push({ ...publicProject(project), tasks: openTasks.get(project.id) ?? 0, reason });
  };

  const remembered = entry?.destinations?.datask;
  if (remembered) {
    const project = byId.get(remembered.projectId);
    if (project && project.status !== CLOSED) push(project, 'recordado');
  }
  for (const [projectId] of [...openTasks].sort((a, b) => b[1] - a[1])) {
    const project = byId.get(projectId);
    if (project && matches(project, words)) push(project, 'tienes tareas abiertas');
  }
  const coded = entry?.code ? projects.filter((p) => p.code === entry.code) : [];
  for (const project of coded) {
    if (project.status !== CLOSED) push(project, 'código de la carpeta');
  }
  // Por cliente no: un intermediario puede llevar decenas de clientes. Por nombre, los más nuevos primero.
  const similar = projects.filter((p) => p.status !== CLOSED && matches(p, words)).sort((a, b) => b.id - a.id);
  for (const project of similar) push(project, 'nombre parecido');
  // El del código aunque esté cerrado, al final y marcado: a veces sigue siendo el sitio.
  for (const project of coded) push(project, 'código de la carpeta (cerrado)');
  return {
    candidates: list.slice(0, MAX_CANDIDATES),
    // El recordado ya no vale si su proyecto se ha cerrado: se avisa y se vuelve a elegir.
    rememberedClosed: Boolean(remembered && byId.get(remembered.projectId)?.status === CLOSED),
  };
}

export async function searchDatask(query) {
  const text = String(query ?? '').trim().toLowerCase();
  if (text.length < 2) return [];
  const projects = await allProjects();
  return projects
    .filter((p) => `${p.code} ${p.name} ${p.company ?? ''}`.toLowerCase().includes(text))
    // Activos primero.
    .sort((a, b) => (a.status === CLOSED) - (b.status === CLOSED))
    .slice(0, 20)
    .map(publicProject);
}

export async function findDataskProject(projectId) {
  const project = (await allProjects()).find((p) => p.id === Number(projectId));
  if (!project) throw new OrderError(400, 'No encuentro ese proyecto en Datask.');
  return publicProject(project);
}

export async function createDataskTask(projectId, { title, description }) {
  const project = await findDataskProject(projectId);
  const list = await todoList(project.id);
  const args = ['task', 'create', '--title', title, '--list', String(list.id), '--description', description, '--json'];
  const userId = await myUserId();
  if (userId) args.push('--assignee', String(userId));
  const task = await run(args);
  if (!task?.id) throw new OrderError(502, 'Datask no devolvió la tarea creada.');
  cache.myTasks = null;
  return { kind: 'datask', ref: `${project.code} · tarea ${task.id}`, taskId: task.id, project, list: list.name };
}

// ¿Está completada la tarea? `datask task complete` la deja en estado 2.
export async function dataskTaskDone(taskId) {
  const result = await run(['task', 'show', String(taskId)]);
  const status = result?.task?.status;
  return status === undefined ? null : String(status) === '2';
}

function publicProject(project) {
  return { id: project.id, code: project.code, name: project.name, company: project.company, closed: project.status === CLOSED };
}

async function allProjects() {
  if (cache.projects && Date.now() - cache.projects.at < PROJECTS_TTL_MS) return cache.projects.data;
  const data = (await run(['projects', '--all'])).map((p) => ({
    id: p.id,
    code: String(p.code ?? '').trim().toUpperCase(),
    name: String(p.name ?? '').trim(),
    company: p.companyName ?? null,
    status: p.status,
  }));
  cache.projects = { at: Date.now(), data };
  return data;
}

// `myTasks_` y no `myTasks`, para no chocar con la variable local de dataskCandidates.
async function myTasks_() {
  if (cache.myTasks && Date.now() - cache.myTasks.at < MY_TASKS_TTL_MS) return cache.myTasks.data;
  const data = await run(['tasks']);
  cache.myTasks = { at: Date.now(), data };
  return data;
}

// El CLI no expone el usuario actual: se lee de una de sus tareas. Sin tareas, la nueva queda sin asignar.
async function myUserId() {
  if (cache.userId !== undefined) return cache.userId;
  const [first] = await myTasks_();
  cache.userId = first ? ((await run(['task', 'show', String(first.id)]))?.task?.userDataId ?? null) : null;
  return cache.userId;
}

async function todoList(projectId) {
  if (cache.lists.has(projectId)) return cache.lists.get(projectId);
  const [board] = await run(['boards', String(projectId)]);
  if (!board) throw new OrderError(400, 'Ese proyecto de Datask no tiene tablero.');
  const lists = await run(['lists', String(board.id)]);
  const list = lists.find((l) => /^(todo|por hacer|pendiente)/i.test(String(l.name).trim())) ?? lists[0];
  if (!list) throw new OrderError(400, 'El tablero de ese proyecto no tiene listas.');
  const found = { id: list.id, name: String(list.name).trim() };
  cache.lists.set(projectId, found);
  return found;
}

function textWords(text) {
  return [...new Set(normalize(text).split(/[^a-z0-9]+/).filter((w) => w.length >= 5 && !isGeneric(w)))];
}

function keywords(entry) {
  const raw = [entry.name, ...(entry.aliases ?? []), entry.code ?? ''].join(' ');
  return [...new Set(normalize(raw).split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !isGeneric(w)))];
}

// Palabras que aparecen en muchos proyectos y no ayudan a distinguirlos. Cada Mac añade las suyas
// en `datask.ignoredWords` de data/config.json.
const GENERIC_BASE = ['android', 'app', 'apps', 'web', 'mantenimiento', 'evolutivo'];

function isGeneric(word) {
  return GENERIC_BASE.includes(word) || getConfig().dataskIgnoredWords.includes(word);
}

function matches(project, words) {
  if (!words.length) return false;
  const text = normalize(`${project.code} ${project.name} ${project.company ?? ''}`);
  return words.some((word) => text.includes(word));
}

function normalize(value) {
  return String(value).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function run(args) {
  const bin = dataskBin();
  if (!bin) return Promise.reject(new OrderError(503, 'No encuentro el CLI de datask.'));
  return new Promise((resolve, reject) => {
    execFile(bin, [...args, '--json'.repeat(args.includes('--json') ? 0 : 1)].filter(Boolean),
      { timeout: TIMEOUT_MS, maxBuffer: 32 * 1024 * 1024, env: { ...process.env, PATH: CHILD_PATH } },
      (error, stdout, stderr) => {
        if (error) {
          const detail = String(stderr || error.message).trim().split('\n').slice(-2).join(' ');
          console.error(`datask ${args.slice(0, 2).join(' ')}: ${detail}`);
          reject(new OrderError(502, error.killed ? 'Datask ha tardado demasiado.' : `Datask: ${detail}`));
          return;
        }
        try {
          resolve(JSON.parse(stdout));
        } catch {
          reject(new OrderError(502, 'Datask devolvió una respuesta inesperada.'));
        }
      });
  });
}
