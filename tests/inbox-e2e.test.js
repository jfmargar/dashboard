import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { buildWorld } from './fixtures/inbox-world.js';

// Bandeja de inicio a fin: el servidor de verdad, con un HOME y unos datos de usar y tirar, repos de
// prueba y CLI falsos que apuntan cada llamada (tests/fixtures/inbox-world.js).
// Ninguna variable apunta a un CLI real (src/bins.js): si falta un falso, ese destino no está.
const SERVER = fileURLToPath(new URL('../src/server.js', import.meta.url));
const root = realpathSync(mkdtempSync(join(tmpdir(), 'dashboard-inbox-e2e-')));
let world = null;
let dataDir = '';
let stateDir = '';
let LOG = '';
let parking = '';
let recetas = '';
let sueltos = '';

let server = null;
let port = 0;

function freePort() {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.listen(0, '127.0.0.1', () => {
      const { port: free } = probe.address();
      probe.close(() => resolve(free));
    });
  });
}

async function startServer() {
  const child = spawn(process.execPath, [SERVER], {
    env: { ...process.env, ...world.env, PORT: String(port), INBOX_FOLLOW_UP_MINUTES: '0.01' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  for (let i = 0; i < 100 && !output.includes('Dashboard en'); i++) await delay(50);
  assert.match(output, /Dashboard en/, `El servidor no arrancó:\n${output}`);
  child.output = () => output;
  return child;
}

async function stopServer() {
  if (!server) return;
  const exited = new Promise((resolve) => server.once('exit', resolve));
  server.kill('SIGTERM');
  await exited;
  server = null;
}

async function api(path, { method = 'GET', body, headers = {}, raw } = {}) {
  const init = { method, headers: { ...headers } };
  if (method !== 'GET') {
    init.headers = { 'Content-Type': 'application/json', Origin: `http://127.0.0.1:${port}`, ...headers };
    init.body = raw ?? JSON.stringify(body ?? {});
  }
  const res = await fetch(`http://127.0.0.1:${port}${path}`, init);
  return { status: res.status, data: await res.json() };
}

const inbox = () => api('/api/inbox').then((res) => res.data);
const noteById = async (id) => (await inbox()).notes.find((note) => note.id === id);

async function until(check, message, tries = 150) {
  for (let i = 0; i < tries; i++) {
    const value = await check();
    if (value) return value;
    await delay(40);
  }
  assert.fail(message);
}

async function addNote(text, source = 'text') {
  const res = await api('/api/inbox', { method: 'POST', body: { text, source } });
  assert.equal(res.status, 202, JSON.stringify(res.data));
  return res.data.note;
}

async function planned(text) {
  const { id } = await addNote(text);
  return until(async () => {
    const note = await noteById(id);
    return note?.plan.state === 'ready' && note;
  }, `La nota «${text}» no recibió plan`);
}

const calls = (bin) => (existsSync(LOG) ? readFileSync(LOG, 'utf8').trim().split('\n').map((line) => JSON.parse(line)) : [])
  .filter((call) => call.bin === bin);
const storedNotes = () => JSON.parse(readFileSync(join(dataDir, 'inbox.json'), 'utf8')).notes;
const learned = () => JSON.parse(readFileSync(join(dataDir, 'catalog.json'), 'utf8')).projects;
const close = (name) => appendFileSync(join(stateDir, name), '');

describe('bandeja de inicio a fin', () => {
  before(async () => {
    world = buildWorld(root);
    ({ stateDir, log: LOG } = world);
    ({ parking, recetas, sueltos } = world.projects);
    dataDir = world.env.DASHBOARD_DATA_DIR;
    port = await freePort();
    server = await startServer();
  });

  after(async () => {
    await stopServer();
    rmSync(root, { recursive: true, force: true });
  });

  it('el catálogo ofrece los destinos de cada proyecto', async () => {
    const { notes, projects } = await inbox();
    assert.deepEqual(notes, []);
    const byKey = Object.fromEntries(projects.map((p) => [p.key, p]));
    assert.deepEqual(byKey[parking].destinations, ['gitlab', 'datask', 'session']);
    assert.equal(byKey[parking].code, 'PRJ123');
    assert.deepEqual(byKey[parking].repo, { kind: 'gitlab', path: 'grupo/parking', url: 'https://gitlab.example.com/grupo/parking' });
    // Personal y sin código: nada de Datask.
    assert.deepEqual(byKey[recetas].destinations, ['github', 'session']);
    // Una carpeta sin remoto, código ni alias no es un proyecto de la bandeja.
    assert.equal(byKey[sueltos], undefined);
  });

  it('rechaza peticiones sin origen, de otro tipo, de otra cuenta o con JSON roto', async () => {
    const noOrigin = await fetch(`http://127.0.0.1:${port}/api/inbox`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"text":"hola"}',
    });
    assert.equal(noOrigin.status, 403);
    const otherOrigin = await api('/api/inbox', { method: 'POST', body: { text: 'hola' }, headers: { Origin: 'https://otra.web' } });
    assert.equal(otherOrigin.status, 403);
    const form = await api('/api/inbox', { method: 'POST', raw: 'text=hola', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    assert.equal(form.status, 403);
    const intruder = await api('/api/inbox', { headers: { 'Tailscale-User-Login': 'intruso@example.com', 'X-Forwarded-For': '100.101.102.103' } });
    assert.equal(intruder.status, 403);
    assert.match(intruder.data.error, /intruso@example.com/);
    const funnel = await api('/api/state', { headers: { 'Tailscale-Funnel-Request': '?1' } });
    assert.equal(funnel.status, 403);
    const proxied = await api('/api/state', { headers: { 'X-Forwarded-For': '203.0.113.5' } });
    assert.equal(proxied.status, 403);
    const broken = await api('/api/inbox', { method: 'POST', raw: '{texto' });
    assert.equal(broken.status, 400);
    assert.equal(broken.data.error, 'Cuerpo JSON inválido.');
    assert.deepEqual((await inbox()).notes, []);
  });

  it('valida el texto y el origen de la nota', async () => {
    assert.equal((await api('/api/inbox', { method: 'POST', body: { text: '   ' } })).status, 400);
    assert.equal((await api('/api/inbox', { method: 'POST', body: { text: 'x'.repeat(4001) } })).status, 400);
    const voice = await addNote('Recetas: probar el modo oscuro', 'voice');
    assert.equal(voice.source, 'voice');
    assert.equal(voice.status, 'open');
    assert.deepEqual(voice.plan, { state: 'pending' });
    const odd = await addNote('Recetas: revisar textos', 'telepatía');
    assert.equal(odd.source, 'text');
    assert.equal((await api('/api/inbox/no-existe', { method: 'POST', body: { title: 'x' } })).status, 404);
  });

  it('Haiku propone proyecto, título, descripción y cómo lo nombraste', async () => {
    const note = await planned('Revisar el parking: falla el login');
    assert.equal(note.plan.by, 'haiku');
    assert.equal(note.plan.project, parking);
    assert.equal(note.plan.mention, 'el parking');
    assert.equal(note.plan.title, 'Plan: Revisar el parking: falla el login');
    assert.deepEqual(note.plan.candidates, []);
    // El catálogo le llega a Haiku con ids y la nota entre etiquetas.
    const prompt = calls('claude').find((call) => call.stdin.includes('falla el login'));
    assert.ok(prompt.args.includes('--no-session-persistence'));
    assert.deepEqual(prompt.args.slice(prompt.args.indexOf('--tools'), prompt.args.indexOf('--tools') + 2), ['--tools', '']);
    assert.match(prompt.stdin, /código PRJ123/);
    assert.match(prompt.stdin, /<nota>\nRevisar el parking: falla el login\n<\/nota>/);
    const { data } = await api('/api/state');
    assert.equal(data.inboxOpen, 3);
  });

  it('con dudas da candidatos y descarta proyectos que no están en el catálogo', async () => {
    const doubt = await planned('DUDA: no sé dónde va esto');
    assert.equal(doubt.plan.project, null);
    assert.deepEqual(new Set(doubt.plan.candidates), new Set([parking, recetas]));
    const invented = await planned('INVENTADO: proyecto fantasma');
    assert.equal(invented.plan.project, null);
    assert.equal(invented.plan.reason, 'Haiku propuso un proyecto que no está en el catálogo.');
  });

  it('si Haiku falla, el plan sale por coincidencia de nombres', async () => {
    const note = await planned('FALLA pero es de Recetas');
    assert.equal(note.plan.by, 'match');
    assert.equal(note.plan.project, recetas);
    assert.match(note.plan.error, /Haiku no ha respondido/);
    assert.equal(note.plan.title, 'FALLA pero es de Recetas');
  });

  it('corregir el plan guarda el alias y volver a proponer respeta tu proyecto', async () => {
    const note = await planned('Lo del parking: cambiar el icono');
    assert.equal((await api(`/api/inbox/${note.id}`, { method: 'POST', body: { project: '/no/existe' } })).status, 400);
    const edited = await api(`/api/inbox/${note.id}`, {
      method: 'POST',
      body: { project: recetas, title: 'Cambiar el icono', description: 'El de la pantalla de inicio', alias: 'la de cocina' },
    });
    assert.equal(edited.status, 202);
    assert.equal(edited.data.note.plan.project, recetas);
    assert.equal(edited.data.note.plan.edited, true);
    assert.deepEqual(learned()[recetas].aliases, ['la de cocina']);

    assert.equal((await api(`/api/inbox/${note.id}/plan`, { method: 'POST' })).status, 202);
    const replanned = await until(async () => {
      const current = await noteById(note.id);
      return current.plan.state === 'ready' && current;
    }, 'No se volvió a proponer');
    // Haiku vuelve a leer «parking» en la nota, pero el proyecto que elegiste se queda.
    assert.equal(replanned.plan.project, recetas);
    const prompt = calls('claude').filter((call) => call.stdin.includes('cambiar el icono')).pop();
    assert.match(prompt.stdin, /Corrección del usuario:\nProyecto: Recetas\nTítulo: Cambiar el icono\nDescripción: El de la pantalla de inicio/);
    assert.match(prompt.stdin, /alias: la de cocina/);
  });

  it('no envía una nota sin plan', async () => {
    const { id } = await addNote('LENTO: parking, esperar al plan');
    const early = await api(`/api/inbox/${id}/send`, { method: 'POST', body: { kind: 'gitlab' } });
    assert.equal(early.status, 400);
    assert.equal(early.data.error, 'La nota todavía no tiene plan.');
    await until(async () => (await noteById(id)).plan.state === 'ready', 'El plan lento no llegó', 200);
  });

  it('crea el issue en GitLab una sola vez y con el host del remoto', async () => {
    const note = await planned('Parking DESPACIO: pantalla de reservas');
    assert.equal((await api(`/api/inbox/${note.id}/send`, { method: 'POST', body: { kind: 'github' } })).status, 400);
    // Dos envíos a la vez: solo uno llega a crear el issue.
    const [first, second] = await Promise.all([
      api(`/api/inbox/${note.id}/send`, { method: 'POST', body: { kind: 'gitlab' } }),
      api(`/api/inbox/${note.id}/send`, { method: 'POST', body: { kind: 'gitlab' } }),
    ]);
    assert.deepEqual([first.status, second.status].sort(), [202, 409]);
    const sent = [first, second].find((res) => res.status === 202).data.note;
    assert.equal(sent.status, 'sent');
    assert.equal(sent.sentTo.length, 1);
    assert.deepEqual(
      { kind: sent.sentTo[0].kind, ref: sent.sentTo[0].ref, url: sent.sentTo[0].url, number: sent.sentTo[0].number },
      { kind: 'gitlab', ref: 'grupo/parking#42', url: 'https://gitlab.example.com/grupo/parking/-/issues/42', number: 42 },
    );
    const create = calls('glab').filter((call) => call.args[1] === 'create');
    assert.equal(create.length, 1);
    assert.equal(create[0].gitlabHost, 'gitlab.example.com');
    assert.deepEqual(create[0].args.slice(0, 4), ['issue', 'create', '-R', 'grupo/parking']);
    assert.equal(create[0].args[create[0].args.indexOf('--title') + 1], 'Plan: Parking DESPACIO: pantalla de reservas');
    assert.ok(create[0].args.includes('--yes'));
    const again = await api(`/api/inbox/${note.id}/send`, { method: 'POST', body: { kind: 'gitlab' } });
    assert.equal(again.status, 409);
    assert.equal(again.data.error, 'Esta nota ya se envió ahí.');
  });

  it('si el CLI falla, la nota sigue pendiente y se puede reintentar', async () => {
    const note = await planned('Parking ROMPE: guardar favoritos');
    const failed = await api(`/api/inbox/${note.id}/send`, { method: 'POST', body: { kind: 'gitlab' } });
    assert.equal(failed.status, 502);
    assert.match(failed.data.error, /error de red/);
    const after = await noteById(note.id);
    assert.equal(after.status, 'open');
    assert.deepEqual(after.sentTo, []);
    // Con otro título ya no falla.
    await api(`/api/inbox/${note.id}`, { method: 'POST', body: { title: 'Guardar favoritos' } });
    assert.equal((await api(`/api/inbox/${note.id}/send`, { method: 'POST', body: { kind: 'gitlab' } })).status, 202);
  });

  it('Datask: candidatos, búsqueda, lista TODO, asignación y destino recordado', async () => {
    const note = await planned('Parking: exportar informes');
    const options = await api(`/api/inbox/${note.id}/datask`);
    assert.equal(options.status, 200);
    assert.deepEqual(options.data.candidates.map((c) => [c.id, c.reason]), [
      [10, 'tienes tareas abiertas'],
      [11, 'código de la carpeta (cerrado)'],
    ]);
    assert.equal(options.data.rememberedClosed, false);
    const search = await api('/api/datask/search?q=parking');
    assert.deepEqual(search.data.projects.map((p) => [p.id, p.closed]), [[10, false], [11, true]]);
    assert.deepEqual((await api('/api/datask/search?q=p')).data.projects, []);

    const missing = await api(`/api/inbox/${note.id}/send`, { method: 'POST', body: { kind: 'datask' } });
    assert.equal(missing.status, 400);
    assert.equal(missing.data.error, 'Elige el proyecto de Datask.');
    assert.equal((await api(`/api/inbox/${note.id}/send`, { method: 'POST', body: { kind: 'datask', projectId: 999 } })).status, 400);

    const sent = await api(`/api/inbox/${note.id}/send`, { method: 'POST', body: { kind: 'datask', projectId: 10 } });
    assert.equal(sent.status, 202, JSON.stringify(sent.data));
    assert.equal(sent.data.note.sentTo[0].ref, 'PRJ123 · tarea 900');
    const create = calls('datask').find((call) => call.args[1] === 'create').args;
    assert.equal(create[create.indexOf('--list') + 1], '31');
    assert.equal(create[create.indexOf('--assignee') + 1], '77');
    assert.equal(create[create.indexOf('--description') + 1], 'Parking: exportar informes');
    assert.equal(learned()[parking].destinations.datask.projectId, 10);

    // La siguiente nota del mismo proyecto lo propone primero.
    const next = await planned('Parking: otra cosa');
    const remembered = await api(`/api/inbox/${next.id}/datask`);
    assert.deepEqual(remembered.data.candidates[0].reason, 'recordado');
  });

  it('una nota sin proyecto solo puede ir a Datask', async () => {
    const note = await planned('Algo suelto sin proyecto');
    assert.equal(note.plan.project, null);
    assert.equal((await api(`/api/inbox/${note.id}/send`, { method: 'POST', body: { kind: 'gitlab' } })).status, 400);
    const session = await api(`/api/inbox/${note.id}/send`, { method: 'POST', body: { kind: 'session', agent: 'claude' } });
    assert.equal(session.status, 400);
    assert.match(session.data.error, /necesita un proyecto/);
    const options = await api(`/api/inbox/${note.id}/datask`);
    assert.equal(options.status, 200);
    assert.equal((await api(`/api/inbox/${note.id}/send`, { method: 'POST', body: { kind: 'datask', projectId: 20 } })).status, 202);
  });

  it('GitHub y después una sesión que trabaja sobre ese issue', async () => {
    const note = await planned('Recetas: añadir búsqueda por ingrediente');
    const issue = await api(`/api/inbox/${note.id}/send`, { method: 'POST', body: { kind: 'github' } });
    assert.equal(issue.status, 202);
    assert.equal(issue.data.note.sentTo[0].ref, 'yo/recetas#7');
    const gh = calls('gh').find((call) => call.args[1] === 'create').args;
    assert.deepEqual(gh.slice(0, 4), ['issue', 'create', '-R', 'yo/recetas']);
    assert.equal(gh[gh.indexOf('--assignee') + 1], '@me');

    const preview = await api(`/api/inbox/${note.id}/send`, { method: 'POST', body: { kind: 'session', preview: true } });
    assert.match(preview.data.preview, /^Trabaja en el issue yo\/recetas#7 \(https:\/\/github.com\/yo\/recetas\/issues\/7\)/);
    assert.match(preview.data.preview, /AGENTS\.md/);

    // Codex no está instalado en esta prueba: falla sin dejar la nota bloqueada.
    const codex = await api(`/api/inbox/${note.id}/send`, { method: 'POST', body: { kind: 'session', agent: 'codex' } });
    assert.equal(codex.status, 500);
    assert.equal((await api(`/api/inbox/${note.id}/send`, { method: 'POST', body: { kind: 'session', agent: 'claude', mode: 'raro' } })).status, 400);

    const session = await api(`/api/inbox/${note.id}/send`, { method: 'POST', body: { kind: 'session', agent: 'claude', mode: 'plan' } });
    assert.equal(session.status, 202, JSON.stringify(session.data));
    const launched = session.data.note.sentTo.find((sent) => sent.kind === 'session');
    assert.equal(launched.ref, 'Claude en Recetas');
    assert.match(launched.sessionId, /^claude:/);
    const run = await until(() => calls('claude').find((call) => call.args.includes('--session-id')), 'No se lanzó la sesión');
    assert.equal(run.cwd, recetas);
    assert.equal(run.args[run.args.indexOf('--permission-mode') + 1], 'plan');
    assert.equal(run.stdin, preview.data.preview);
    // Queda registrada como sesión del panel con su nivel de permisos, en los datos de la prueba.
    const managed = JSON.parse(readFileSync(join(dataDir, 'managed.json'), 'utf8'));
    const entry = managed.find((s) => s.id === launched.sessionId);
    assert.equal(entry.mode, 'plan');
    assert.equal(entry.cwd, recetas);
  });

  it('archivar y recuperar devuelve la nota a como estaba', async () => {
    const open = await planned('Recetas: archivar y volver');
    assert.equal((await api(`/api/inbox/${open.id}`, { method: 'POST', body: { status: 'sent' } })).status, 400);
    await api(`/api/inbox/${open.id}`, { method: 'POST', body: { status: 'archived' } });
    assert.equal(await noteById(open.id), undefined);
    assert.equal((await api(`/api/inbox/${open.id}`, { method: 'POST', body: { status: 'open' } })).data.note.status, 'open');

    const sent = (await inbox()).notes.find((note) => note.sentTo.some((s) => s.kind === 'github'));
    await api(`/api/inbox/${sent.id}`, { method: 'POST', body: { status: 'archived' } });
    assert.equal((await api(`/api/inbox/${sent.id}`, { method: 'POST', body: { status: 'open' } })).data.note.status, 'sent');
  });

  it('el seguimiento archiva lo enviado cuando todo está cerrado', async () => {
    const { notes } = await inbox();
    const gitlab = notes.find((note) => note.sentTo.some((s) => s.ref === 'grupo/parking#42') && note.plan.title.includes('DESPACIO'));
    const datask = notes.find((note) => note.sentTo.some((s) => s.kind === 'datask' && s.project.id === 10));
    const github = notes.find((note) => note.sentTo.some((s) => s.kind === 'github'));
    // Un hito cerrado no cierra el issue: tras varias vueltas, sigue enviada.
    await until(() => calls('glab').filter((call) => call.args[1] === 'view').length >= 4, 'El seguimiento no consultó GitLab');
    assert.equal((await noteById(gitlab.id)).status, 'sent');

    close('glab-42');
    close('datask-900');
    await until(async () => !(await noteById(gitlab.id)) && !(await noteById(datask.id)), 'No se archivaron las notas cerradas');
    const stored = storedNotes().find((note) => note.id === gitlab.id);
    assert.equal(stored.status, 'archived');
    assert.ok(stored.closedAt);
    assert.ok(stored.sentTo[0].closed);
    // La de GitHub tiene además una sesión, que no cuenta; su issue sigue abierto.
    assert.equal((await noteById(github.id)).status, 'sent');
    close('gh-7');
    await until(async () => !(await noteById(github.id)), 'No se archivó la nota de GitHub');
  });

  it('el dictado transcribe con los nombres de los proyectos', async () => {
    const empty = await api('/api/transcribe', { method: 'POST', raw: '', headers: { 'Content-Type': 'audio/webm' } });
    assert.equal(empty.status, 400);
    const json = await api('/api/transcribe', { method: 'POST', raw: 'audio' });
    assert.equal(json.status, 403);
    const res = await api('/api/transcribe', { method: 'POST', raw: 'audio falso', headers: { 'Content-Type': 'audio/mp4' } });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    assert.equal(res.data.text, 'Nota dictada para el parking');
    const call = calls('whisper').pop();
    assert.match(call.args[0], /audio\.m4a$/);
    assert.match(call.args[call.args.indexOf('--initial-prompt') + 1], /PRJ123-Parking/);
    assert.equal((await api('/api/state')).data.canDictate, true);
  });

  it('un plan a medias se vuelve a pedir al reiniciar el servidor', async () => {
    const { id } = await addNote('LENTO: parking tras reiniciar');
    await stopServer();
    assert.equal(storedNotes().find((note) => note.id === id).plan.state, 'pending');
    server = await startServer();
    const note = await until(async () => {
      const current = await noteById(id);
      return current?.plan.state === 'ready' && current;
    }, 'El plan no se retomó tras reiniciar', 200);
    assert.equal(note.plan.project, parking);
  });
});
