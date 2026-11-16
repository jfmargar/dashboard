import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from './data-dir.js';
import { addAlias, buildCatalog, findProject, rememberProject } from './catalog.js';
import { createDataskTask, dataskBin, dataskCandidates, dataskTaskDone } from './datask.js';
import { createIssue, destinationsFor, issueClosed } from './destinations.js';
import { OrderError, startSession } from './orders.js';
import { planNote, simplePlan } from './planner.js';
import { collectState } from './state.js';
import { zoneById } from './config.js';

// Bandeja de entrada: notas de voz o texto que se apuntan al momento y se envían después a su destino.
// Viven solo en este Mac, en `data/inbox.json` (ignorado por git: los títulos pueden nombrar clientes).
const INBOX_FILE = join(DATA_DIR, 'inbox.json');
const TEXT_MAX = 4000;
const SOURCES = new Set(['text', 'voice']);
// Cada cuánto se mira si lo enviado ya está cerrado.
const FOLLOW_UP_MS = Number(process.env.INBOX_FOLLOW_UP_MINUTES ?? 15) * 60 * 1000;

let notes = load();
// Un plan cada vez: así una ráfaga de notas no lanza varios Haiku a la vez.
let planQueue = Promise.resolve();
const sending = new Set();

export function listNotes() {
  return notes.filter((note) => note.status !== 'archived').sort((a, b) => b.createdAt - a.createdAt);
}

export function openCount() {
  return notes.filter((note) => note.status === 'open').length;
}

export function catalogForInbox() {
  return buildCatalog(collectState()).map((entry) => ({
    key: entry.key,
    name: entry.name,
    code: entry.code,
    repo: entry.repo ? { kind: entry.repo.kind, path: entry.repo.path, url: entry.repo.url } : null,
    destinations: [...destinationsFor(entry), ...(dataskBin() && mayBeInDatask(entry) ? ['datask'] : []), 'session'],
  }));
}

// Datask no lleva todos los proyectos: las zonas con `"datask": false` en data/config.json (la personal,
// por defecto) no lo ofrecen, salvo que el proyecto tenga código o ya tenga proyecto de Datask recordado.
// En zona desconocida sí se ofrece (ahí la ventana de Datask busca candidatos o pregunta).
export function mayBeInDatask(entry) {
  const zone = entry.zone ? zoneById(entry.zone) : null;
  return (zone ? zone.datask : true) || Boolean(entry.code) || Boolean(entry.destinations?.datask);
}

// Proyectos de Datask propuestos para una nota, según su proyecto del panel.
export function dataskOptions(id) {
  const note = getNote(id);
  const entry = note.plan.project ? findProject(buildCatalog(collectState()), note.plan.project) : null;
  return dataskCandidates(entry, note.text);
}

export function addNote({ text: rawText, source }) {
  const text = cleanText(rawText);
  const note = {
    id: randomUUID(),
    text,
    source: SOURCES.has(source) ? source : 'text',
    createdAt: Date.now(),
    status: 'open',
    plan: { state: 'pending' },
    sentTo: [],
  };
  notes.push(note);
  save();
  queuePlan(note.id);
  return note;
}

// Correcciones desde la tarjeta: título, descripción, proyecto o archivar.
export function updateNote(id, patch) {
  const note = getNote(id);
  if (patch.status !== undefined) {
    if (!['open', 'archived'].includes(patch.status)) throw new OrderError(400, 'Estado no válido.');
    // Desarchivar devuelve la nota a como estaba: abierta o ya enviada.
    note.status = patch.status === 'open' && note.sentTo.length ? 'sent' : patch.status;
  }
  if (patch.title !== undefined || patch.description !== undefined || patch.project !== undefined) {
    const plan = { ...note.plan, state: 'ready', edited: true };
    if (patch.title !== undefined) plan.title = cleanText(patch.title).slice(0, 200);
    if (patch.description !== undefined) plan.description = String(patch.description).trim().slice(0, TEXT_MAX);
    if (patch.project !== undefined) plan.project = patch.project ? projectKey(patch.project) : null;
    note.plan = plan;
  }
  // Si el proyecto lo eliges tú y la nota lo nombraba de otra forma, ese nombre queda como alias.
  if (patch.alias && note.plan.project) {
    const entry = findProject(buildCatalog(collectState()), note.plan.project);
    if (entry) addAlias(entry, String(patch.alias));
  }
  save();
  return note;
}

// Envía la nota ya aprobada a un destino. La confirmación se hace antes, en la interfaz.
// El encargo de la sesión: si la nota ya tiene issue, se trabaja sobre él.
export function sessionBrief(id) {
  const note = getNote(id);
  const { title, description } = note.plan;
  const issue = note.sentTo.find((sent) => sent.kind === 'gitlab' || sent.kind === 'github');
  const body = description && description !== title ? `\n\n${description}` : '';
  if (!issue) return `${title}${body}`;
  return `Trabaja en el issue ${issue.ref} (${issue.url}): ${title}.${body}\n\n` +
    'Sigue el AGENTS.md del repositorio para la rama y el flujo de trabajo.';
}

export async function sendNote(id, { kind, projectId, agent, mode = 'auto' }) {
  const note = getNote(id);
  if (note.plan.state !== 'ready') throw new OrderError(400, 'La nota todavía no tiene plan.');
  if (note.sentTo.some((sent) => sent.kind === kind)) throw new OrderError(409, 'Esta nota ya se envió ahí.');
  if (sending.has(id)) throw new OrderError(409, 'La nota ya se está enviando.');
  const entry = note.plan.project ? findProject(buildCatalog(collectState()), note.plan.project) : null;
  // Datask no necesita repo: una nota sin proyecto del panel también puede ir allí.
  if (kind === 'session') {
    if (!entry) throw new OrderError(400, 'La nota necesita un proyecto para abrir la sesión en su carpeta.');
  } else if (kind !== 'datask' && (!entry || !destinationsFor(entry).includes(kind))) {
    throw new OrderError(400, 'Ese destino no está disponible para este proyecto.');
  }
  sending.add(id);
  try {
    const content = { title: note.plan.title, description: note.plan.description || note.text };
    let sent;
    if (kind === 'session') sent = launchSession(entry, agent, sessionBrief(id), mode);
    else if (kind === 'datask') sent = await sendToDatask(entry, projectId, content);
    else sent = await createIssue(entry, content);
    note.sentTo.push({ ...sent, sentAt: Date.now() });
    note.status = 'sent';
    save();
    return note;
  } finally {
    sending.delete(id);
  }
}

// Misma sesión que «Nueva sesión» del panel, con el nivel de permisos elegido (Editar o Solo mirar) y el encargo ya escrito.
function launchSession(entry, agent, text, mode) {
  const { sessionId } = startSession({ agent, cwd: entry.key, mode, text });
  return { kind: 'session', ref: `${agent === 'codex' ? 'Codex' : 'Claude'} en ${entry.name}`, agent, sessionId };
}

async function sendToDatask(entry, projectId, content) {
  if (!projectId) throw new OrderError(400, 'Elige el proyecto de Datask.');
  const sent = await createDataskTask(projectId, content);
  // Lo que eliges queda como destino de este proyecto, en todos sus repos, para las próximas notas.
  if (entry) {
    const datask = { projectId: sent.project.id, code: sent.project.code, name: sent.project.name };
    for (const sibling of buildCatalog(collectState()).filter((e) => e.group === entry.group)) {
      rememberProject(sibling, { destinations: { ...sibling.destinations, datask } });
    }
  }
  return sent;
}

// Una nota enviada se archiva sola cuando todo lo que se creó con ella está cerrado.
// Las sesiones lanzadas no cuentan: no tienen un «cerrado».
export async function followUpSent() {
  for (const note of notes.filter((n) => n.status === 'sent')) {
    let changed = false;
    for (const sent of note.sentTo) {
      if (sent.closed || sent.kind === 'session') continue;
      try {
        const closed = sent.kind === 'datask' ? await dataskTaskDone(sent.taskId) : await issueClosed(sent);
        if (closed) {
          sent.closed = Date.now();
          changed = true;
        }
      } catch (error) {
        console.error(`Seguimiento de ${sent.ref}: ${error.message}`);
      }
    }
    const trackable = note.sentTo.filter((sent) => sent.kind !== 'session');
    if (trackable.length && trackable.every((sent) => sent.closed)) {
      note.status = 'archived';
      note.closedAt = Date.now();
      changed = true;
    }
    if (changed) save();
  }
}

export function startFollowUp() {
  if (!(FOLLOW_UP_MS > 0)) return;
  const tick = () => followUpSent().catch((error) => console.error(`Seguimiento de la bandeja: ${error.message}`));
  // El primero, al poco de arrancar (antes si el intervalo es más corto).
  setTimeout(tick, Math.min(30 * 1000, FOLLOW_UP_MS));
  setInterval(tick, FOLLOW_UP_MS);
}

// Volver a proponer tiene en cuenta lo que corregiste: el título y la descripción van con la nota,
// y el proyecto que elegiste a mano se queda.
export function replanNote(id) {
  const note = getNote(id);
  const previous = note.plan ?? {};
  const fixed = previous.edited
    ? { title: previous.title ?? null, description: previous.description ?? null, project: previous.project ?? null }
    : null;
  note.plan = { state: 'pending', ...(fixed ? { fixed } : {}) };
  save();
  queuePlan(id);
  return note;
}

// Texto con el que se vuelve a proponer: la nota y, si la corregiste, tus correcciones.
export function replanText(note, catalog) {
  const fixed = note.plan?.fixed;
  if (!fixed) return note.text;
  const project = fixed.project ? findProject(catalog, fixed.project) : null;
  const lines = ['', 'Corrección del usuario:'];
  if (project) lines.push(`Proyecto: ${project.name}`);
  if (fixed.title) lines.push(`Título: ${fixed.title}`);
  if (fixed.description) lines.push(`Descripción: ${fixed.description}`);
  return `${note.text}\n${lines.join('\n')}`;
}

function queuePlan(id) {
  planQueue = planQueue.then(() => runPlan(id)).catch((error) => console.error(`Plan de la nota: ${error.message}`));
}

async function runPlan(id) {
  const note = notes.find((n) => n.id === id);
  if (!note || note.plan.state !== 'pending') return;
  const catalog = buildCatalog(collectState());
  const text = replanText(note, catalog);
  const plan = await planNote(text, catalog).catch(() => simplePlan(text, catalog));
  const chosen = note.plan.fixed?.project;
  if (chosen) plan.project = chosen;
  // La nota pudo cambiar mientras Haiku pensaba: no se pisa lo que hayas corregido.
  const current = notes.find((n) => n.id === id);
  if (!current || current.plan.state !== 'pending') return;
  current.plan = { state: 'ready', ...plan };
  save();
}

function projectKey(key) {
  const entry = findProject(buildCatalog(collectState()), String(key));
  if (!entry) throw new OrderError(400, 'Ese proyecto no está en el catálogo.');
  return entry.key;
}

function getNote(id) {
  const note = notes.find((n) => n.id === id);
  if (!note) throw new OrderError(404, 'No encuentro esa nota.');
  return note;
}

function cleanText(rawText) {
  const text = String(rawText ?? '').trim();
  if (!text) throw new OrderError(400, 'La nota está vacía.');
  if (text.length > TEXT_MAX) throw new OrderError(400, 'La nota es demasiado larga.');
  return text;
}

function load() {
  try {
    const data = JSON.parse(readFileSync(INBOX_FILE, 'utf8'));
    // Un plan a medias al reiniciar se vuelve a pedir.
    const loaded = Array.isArray(data.notes) ? data.notes : [];
    for (const note of loaded) {
      if (note.plan?.state === 'pending') setTimeout(() => queuePlan(note.id), 0);
    }
    return loaded;
  } catch {
    return [];
  }
}

function save() {
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(INBOX_FILE, `${JSON.stringify({ notes }, null, 2)}\n`);
  } catch (error) {
    console.error(`No he podido guardar la bandeja: ${error.message}`);
  }
}
