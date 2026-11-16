import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isSameOrigin, orderAccess, requestReach } from './access.js';
import { answerApproval, OrderError, startOrder, startSession, steerJob, stopJob } from './orders.js';
import { collectState, findSession } from './state.js';
import { transcribe, transcribeCommand } from './transcribe.js';
import {
  addNote, catalogForInbox, dataskOptions, listNotes, openCount, replanNote, sendNote, sessionBrief, startFollowUp, updateNote,
} from './inbox.js';
import { searchDatask } from './datask.js';
import { readTranscript } from './transcripts.js';
import { liveSnapshot, streamSession } from './live.js';
import { startClaudeUsageProbe } from './claude-usage.js';
import { archiveSessions } from './archive.js';
import { logoPath } from './config.js';

const HOST = process.env.HOST ?? '127.0.0.1';
const PORT = Number(process.env.PORT ?? 4317);
const PUBLIC_DIR = fileURLToPath(new URL('../public/', import.meta.url));
const ASSETS_DIR = fileURLToPath(new URL('../assets/', import.meta.url));

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.json': 'application/json; charset=utf-8',
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  // Ni la página ni los datos salen por Funnel, por otro proxy o con un Host extraño (src/access.js).
  const reach = requestReach(req);
  if (reach.kind === 'blocked') {
    if (url.pathname.startsWith('/api/')) sendJson(res, 403, { error: reach.reason });
    else res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' }).end(reach.reason);
    return;
  }

  if (url.pathname === '/api/state') {
    try {
      const access = await orderAccess(req);
      sendJson(res, 200, {
        ...collectState(),
        canOrder: access.allowed,
        orderBlockedReason: access.reason ?? null,
        canDictate: access.allowed && transcribeCommand() !== null,
        inboxOpen: access.allowed ? openCount() : 0,
      });
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
    return;
  }

  if (url.pathname === '/api/sessions') {
    await handleAction(req, res, async (body) => {
      const known = collectState().launchRoots.some((root) => root.cwd === body.cwd);
      if (!known) throw new OrderError(400, 'Solo se pueden abrir sesiones en carpetas de tus proyectos.');
      return startSession({ agent: body.agent, cwd: body.cwd, mode: body.mode, text: body.text });
    });
    return;
  }

  // Bandeja: hasta leerla exige ser el dueño, porque las notas pueden nombrar clientes.
  if (url.pathname === '/api/inbox' && req.method === 'GET') {
    await handleRead(req, res, () => ({ notes: listNotes(), projects: catalogForInbox() }));
    return;
  }

  const dataskMatch = /^\/api\/inbox\/([^/]+)\/datask$/.exec(url.pathname);
  if (dataskMatch && req.method === 'GET') {
    await handleRead(req, res, () => dataskOptions(decodeURIComponent(dataskMatch[1])));
    return;
  }

  if (url.pathname === '/api/datask/search' && req.method === 'GET') {
    await handleRead(req, res, async () => ({ projects: await searchDatask(url.searchParams.get('q')) }));
    return;
  }

  if (url.pathname === '/api/inbox') {
    await handleAction(req, res, async (body) => ({ note: addNote({ text: body.text, source: body.source }) }));
    return;
  }

  const inboxMatch = /^\/api\/inbox\/([^/]+)(?:\/(plan|send))?$/.exec(url.pathname);
  if (inboxMatch) {
    const noteId = decodeURIComponent(inboxMatch[1]);
    await handleAction(req, res, async (body) => {
      if (inboxMatch[2] === 'plan') return { note: replanNote(noteId) };
      if (inboxMatch[2] === 'send') {
        const options = { kind: String(body.kind), projectId: body.projectId, agent: body.agent, mode: body.mode };
        if (body.preview) return { preview: sessionBrief(noteId) };
        return { note: await sendNote(noteId, options) };
      }
      return { note: updateNote(noteId, body) };
    });
    return;
  }

  if (url.pathname === '/api/transcribe') {
    await handleTranscribe(req, res);
    return;
  }

  const liveMatch = /^\/api\/sessions\/([^/]+)\/live$/.exec(url.pathname);
  if (liveMatch && req.method === 'GET') {
    const access = await orderAccess(req);
    if (!access.allowed) {
      sendJson(res, 403, { error: access.reason });
      return;
    }
    const sessionId = decodeURIComponent(liveMatch[1]);
    if (!findSession(sessionId)) {
      sendJson(res, 404, { error: 'No encuentro esa sesión.' });
      return;
    }
    streamSession(res, liveSnapshot(sessionId));
    return;
  }

  // Conversación reciente de una sesión: solo para quien puede mandar órdenes (este Mac o tu cuenta de Tailscale)
  const transcriptMatch = /^\/api\/sessions\/([^/]+)\/transcript$/.exec(url.pathname);
  if (transcriptMatch && req.method === 'GET') {
    const access = await orderAccess(req);
    if (!access.allowed) {
      sendJson(res, 403, { error: access.reason });
      return;
    }
    const messages = readTranscript(decodeURIComponent(transcriptMatch[1]));
    if (!messages) sendJson(res, 404, { error: 'No encuentro la conversación de esa sesión.' });
    else sendJson(res, 200, { messages });
    return;
  }

  // Archivar en el panel (Misiones): mismas comprobaciones de origen y de cuenta que las órdenes.
  if (url.pathname === '/api/sessions/archive') {
    await handleAction(req, res, async (body) => archiveSessions(body.ids));
    return;
  }

  const actionMatch = /^\/api\/sessions\/([^/]+)\/(order|stop|approval|steer)$/.exec(url.pathname);
  if (actionMatch) {
    const sessionId = decodeURIComponent(actionMatch[1]);
    await handleAction(req, res, async (body) => {
      if (actionMatch[2] === 'stop') return { order: stopJob(sessionId) };
      if (actionMatch[2] === 'approval') return { order: answerApproval(sessionId, body.requestId, body.decision) };
      if (actionMatch[2] === 'steer') return { order: await steerJob(sessionId, body.text) };
      const session = findSession(sessionId);
      if (!session) throw new OrderError(404, 'No encuentro esa sesión.');
      return { order: startOrder(session, body.text) };
    });
    return;
  }

  // Logotipo opcional de la planta destacada: el archivo que diga `logo` en data/config.json.
  if (url.pathname === '/brand/logo') {
    const path = logoPath();
    try {
      if (!path) throw new Error('Sin logotipo');
      const body = await readFile(path);
      res.writeHead(200, { 'Content-Type': CONTENT_TYPES[extname(path)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(body);
    } catch {
      res.writeHead(404).end('No encontrado');
    }
    return;
  }

  // Los sprites viven en `assets/`, fuera de `public/`.
  const isAsset = url.pathname.startsWith('/assets/');
  const baseDir = isAsset ? ASSETS_DIR : PUBLIC_DIR;
  const relative = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(isAsset ? 8 : 1));
  const filePath = normalize(join(baseDir, relative));
  if (!filePath.startsWith(baseDir)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const body = await readFile(filePath);
    res.writeHead(200, {
      'Content-Type': CONTENT_TYPES[extname(filePath)] ?? 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(body);
  } catch {
    res.writeHead(404).end('No encontrado');
  }
});

// Acciones que lanzan o paran agentes: mismas comprobaciones de origen y de cuenta para todas.
async function handleAction(req, res, action) {
  const access = await checkPost(req, res, (type) => type.startsWith('application/json'));
  if (!access) return;
  try {
    const body = JSON.parse((await readBody(req)) || '{}');
    const result = await action(body);
    console.log(`${req.method} ${req.url} (${access.via})`);
    sendJson(res, 202, result);
  } catch (error) {
    sendJson(res, error.status ?? 400, { error: error instanceof SyntaxError ? 'Cuerpo JSON inválido.' : error.message });
  }
}

// Lecturas con datos que pueden nombrar clientes: mismas comprobaciones de cuenta que las acciones.
async function handleRead(req, res, read) {
  const access = await orderAccess(req);
  if (!access.allowed) {
    sendJson(res, 403, { error: access.reason });
    return;
  }
  try {
    sendJson(res, 200, await read());
  } catch (error) {
    sendJson(res, error.status ?? 500, { error: error.message });
  }
}

// El dictado manda el audio tal cual; `audio/*` tampoco es un tipo simple, así que también exige preflight.
async function handleTranscribe(req, res) {
  const type = String(req.headers['content-type']);
  const access = await checkPost(req, res, (value) => value.startsWith('audio/'));
  if (!access) return;
  try {
    const audio = await readBuffer(req, 10 * 1024 * 1024);
    if (!audio.length) throw new OrderError(400, 'No ha llegado audio.');
    const vocabulary = collectState().projects.map((project) => project.name);
    const text = await transcribe(audio, type, vocabulary);
    console.log(`${req.method} ${req.url} (${access.via}, ${Math.round(audio.length / 1024)} KB)`);
    sendJson(res, 200, { text });
  } catch (error) {
    sendJson(res, error.status ?? 400, { error: error.message });
  }
}

async function checkPost(req, res, acceptsType) {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Método no permitido.' });
    return null;
  }
  // Un tipo que no es simple obliga al navegador a hacer preflight en peticiones de otro origen, y no lo aceptamos.
  if (!acceptsType(String(req.headers['content-type'])) || !isSameOrigin(req)) {
    sendJson(res, 403, { error: 'Petición de otro origen rechazada.' });
    return null;
  }
  const access = await orderAccess(req);
  if (!access.allowed) {
    sendJson(res, 403, { error: access.reason });
    return null;
  }
  return access;
}

function readBuffer(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new OrderError(413, 'El audio es demasiado largo.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function readBody(req, limit = 16 * 1024) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > limit) {
        reject(new OrderError(413, 'La orden es demasiado larga.'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': CONTENT_TYPES['.json'], 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

startClaudeUsageProbe();
startFollowUp();

server.listen(PORT, HOST, () => {
  console.log(`Dashboard en http://${HOST}:${PORT}`);
});
