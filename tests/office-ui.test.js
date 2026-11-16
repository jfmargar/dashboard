import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function loadFunction(file, name, next, context) {
  const source = readFileSync(new URL('../public/' + file, import.meta.url), 'utf8');
  const start = source.indexOf('  function ' + name + '(');
  const end = source.indexOf('  function ' + next + '(', start);
  vm.runInNewContext(source.slice(start, end), context);
  return context[name];
}

test('la distribución no cambia al desplazar la página', () => {
  const context = {
    stage: { clientWidth: 1200, getBoundingClientRect: () => ({ top: 300 - context.window.pageYOffset }) },
    window: { innerHeight: 900, pageYOffset: 0 },
    stations: Array.from({ length: 24 }, () => ({ project: { name: 'Proyecto largo' } })),
    ctx: { measureText: value => ({ width: value.length * 5 }) }, STATION_W: 112, STATION_H: 96,
    MARGIN: 16, WALL_H: 32, TILE: 16, AISLE: 16, LOUNGE_H: 96, zoom: 1, overview: false, belowStage: 110,
    closedRooms: [], DOOR_W: 56, DOOR_H: 44, DOOR_GAP: 6, CLOSED_HEAD: 16
  };
  loadFunction('office.js', 'wrapStationName', 'computeLayout', context);
  loadFunction('office.js', 'doorsPerRow', 'measureBelowStage', context);
  const layout = loadFunction('office.js', 'computeLayout', 'doorsPerRow', context);
  const before = JSON.stringify(layout());
  assert.ok(layout().cssScale * 96 >= 160, 'cada placa dispone de anchura legible');
  context.overview = true;
  assert.ok(layout().h * layout().cssScale <= 490, 'la vista general cabe en la altura disponible');
  context.overview = false;
  context.window.pageYOffset = 250;
  assert.equal(JSON.stringify(layout()), before);
});

test('el refresco conserva la posición de lectura y sigue el final solo si estaba abajo', () => {
  let list = { scrollTop: 80, scrollHeight: 1000, clientHeight: 300 };
  const attrs = {};
  const box = {
    getAttribute: key => attrs[key], setAttribute: (key, value) => { attrs[key] = value; },
    set innerHTML(value) { list = { scrollTop: 0, scrollHeight: 1200, clientHeight: 300 }; }
  };
  const context = {
    $: id => id === 'detail-chat' ? box : list,
    chat: { messages: [{ role: 'user', text: 'Mensaje nuevo' }], agent: 'codex' },
    AGENT_LABELS: { codex: 'Codex' }, escapeHtml: String,
    live: { id: 'otra-sesion' },
    relativeTime: () => 'ahora'
  };
  const savedChat = context.chat;
  loadFunction('app.js', 'currentMessages', 'updateChat', context);
  context.chat = savedChat;
  const render = loadFunction('app.js', 'renderChat', 'findSessionById', context);
  render();
  assert.equal(list.scrollTop, 80);
  const previous = list;
  render();
  assert.equal(list, previous, 'no reemplaza mensajes sin cambios');
  list.scrollTop = 900;
  context.chat.messages.push({ role: 'agent', text: 'Respuesta' });
  render();
  assert.equal(list.scrollTop, list.scrollHeight);
});

test('el modo en vivo guarda novedades mientras lees e ignora una conexión anterior', () => {
  const sources = [];
  const painted = [];
  const context = {
    window: { EventSource: function (url) { this.url = url; this.close = () => {}; sources.push(this); } },
    lastState: { canOrder: true }, currentView: 'office', detailView: () => true, document: { hidden: false },
    live: { source: null, id: null, connected: false, following: true, snapshot: null },
    renderLive() {}, renderOrder() {}, renderSteer() {},
    applyLiveMessages: body => painted.push(body),
    stopLive() { context.live.source = null; context.live.id = null; context.live.following = true; },
    selection: { session: { id: 'codex:uno' } }
  };
  const start = loadFunction('app.js', 'startLive', 'applyLiveMessages', context);
  start(context.selection.session);
  const first = sources[0];
  first.onmessage({ data: JSON.stringify({ messages: [{ text: 'Primer fragmento' }], order: null }) });
  assert.equal(painted.length, 1);
  context.live.following = false;
  first.onmessage({ data: JSON.stringify({ messages: [{ text: 'Fragmento nuevo' }], order: null }) });
  assert.equal(painted.length, 1, 'no reemplaza lo que estás leyendo');
  assert.equal(context.live.snapshot.messages[0].text, 'Fragmento nuevo');
  context.selection = { session: { id: 'claude:dos' } };
  start(context.selection.session);
  first.onmessage({ data: JSON.stringify({ messages: [{ text: 'Evento antiguo' }], order: null }) });
  assert.equal(painted.length, 1, 'no mezcla sesiones al cambiar de agente');
  assert.equal(sources.length, 2);
});


test('los nombres pixel se reparten en líneas completas, incluso sin espacios', () => {
  const context = { ctx: { measureText: value => ({ width: value.length * 5 }) } };
  const wrap = loadFunction('office.js', 'wrapStationName', 'computeLayout', context);
  for (const name of ['PuntosClub-Ultramarinos', 'ABC - Granos verdes del valle', 'UnNombreDeProyectoMuyLargoSinEspacios']) {
    const lines = wrap(name, 76);
    assert.equal(lines.join('').replace(/\s/g, ''), name.replace(/\s/g, ''));
    assert.ok(lines.every(line => line.length * 5 <= 76));
    assert.ok(lines.every(line => !line.includes('…')));
  }
});

test('el pellizco escala el zoom con la separación de los dedos y respeta los límites', () => {
  const context = { MIN_ZOOM: 1, MAX_ZOOM: 3 };
  loadFunction('office.js', 'clampZoom', 'easeInOut', context);
  const pinchZoom = loadFunction('office.js', 'pinchZoom', 'releaseVelocity', context);
  assert.equal(pinchZoom(1, 100, 150), 1.5);
  assert.equal(pinchZoom(2, 100, 400), 3);
  assert.equal(pinchZoom(1.5, 100, 20), 1);
  assert.equal(pinchZoom(2, 0, 50), 2);
});

test('la inercia usa la velocidad del final del arrastre y se anula si el dedo se paró', () => {
  const releaseVelocity = loadFunction('office.js', 'releaseVelocity', 'waitingQueue', {});
  const samples = [{ x: 0, y: 0, t: 0 }, { x: 10, y: 0, t: 150 }, { x: 40, y: -20, t: 170 }, { x: 70, y: -40, t: 190 }];
  assert.deepEqual({ ...releaseVelocity(samples, 200) }, { x: 1.5, y: -1 });
  assert.deepEqual({ ...releaseVelocity(samples, 400) }, { x: 0, y: 0 });
});

test('la cola de espera recorre las que te toca contestar y las que piden aprobación, y vuelve a empezar', () => {
  const context = {};
  const waitingQueue = loadFunction('office.js', 'waitingQueue', 'nextWaiting', context);
  const nextWaiting = loadFunction('office.js', 'nextWaiting', 'reducedMotion', context);
  const stations = [
    { project: { id: 'a', sessions: [{ id: 'a1', status: 'working' }, { id: 'a2', status: 'yours' }] } },
    { project: { id: 'b', sessions: [{ id: 'b1', status: 'working', order: { approvals: [{ id: 'r1' }] } }, { id: 'b2', status: 'idle', order: { approvals: [] } }] } }
  ];
  const queue = waitingQueue(stations);
  assert.deepEqual([...queue.map(item => item.session.id)], ['a2', 'b1']);
  assert.equal(queue[1].project.id, 'b');
  assert.equal(nextWaiting(queue, null).session.id, 'a2');
  assert.equal(nextWaiting(queue, 'a2').session.id, 'b1');
  assert.equal(nextWaiting(queue, 'b1').session.id, 'a2');
  assert.equal(nextWaiting([], 'a2'), null);
});

test('de noche la oficina se oscurece menos en el móvil o muy alejada', () => {
  const darknessFor = loadFunction('office.js', 'darknessFor', 'drawLighting', {});
  assert.equal(darknessFor('night', 2, 1440), 0.58);
  assert.equal(darknessFor('night', 2, 375), 0.3);
  assert.equal(darknessFor('night', 1, 1440), 0.3);
  assert.equal(darknessFor('dusk', 2, 375), 0.3);
  assert.equal(darknessFor('day', 1, 375), 0.1);
});

test('el móvil reparte los puestos en una planta por zona con puestos, en el orden de las zonas', () => {
  const groupFloors = loadFunction('office.js', 'groupFloors', 'swipeFloor', { ZONE_ORDER: { trabajo: 0, personal: 1, otros: 2 } });
  const station = (id, zone) => ({ project: { id, zone } });
  const floors = groupFloors([station('a', 'personal'), station('b', 'personal'), station('c', 'otros'), station('d', 'raro')]);
  assert.deepEqual([...floors.map(f => f.zone)], ['personal', 'otros']);
  assert.deepEqual([...floors[0].stations.map(s => s.project.id)], ['a', 'b']);
  assert.deepEqual([...floors[1].stations.map(s => s.project.id)], ['c', 'd'], 'una zona desconocida va a Otros');
  assert.deepEqual([...groupFloors([station('x', 'otros'), station('y', 'trabajo')]).map(f => f.zone)], ['trabajo', 'otros']);
  assert.equal(groupFloors([]).length, 0);
});

test('deslizar en horizontal cambia de planta solo desde el borde y con un gesto claro', () => {
  const swipeFloor = loadFunction('office.js', 'swipeFloor', 'menuActions', {});
  assert.equal(swipeFloor(-120, 10, true, true), 1, 'hacia la izquierda, la siguiente');
  assert.equal(swipeFloor(120, -10, true, true), -1, 'hacia la derecha, la anterior');
  assert.equal(swipeFloor(-120, 10, true, false), 0, 'si aún se podía desplazar, no cambia');
  assert.equal(swipeFloor(-40, 0, true, true), 0, 'gesto corto');
  assert.equal(swipeFloor(-90, 80, true, true), 0, 'gesto en diagonal');
});

test('el menú circular solo ofrece lo que aplica y nunca a un ayudante', () => {
  const menuActions = loadFunction('office.js', 'menuActions', 'activeStations', {});
  const list = (session, canOrder) => [...menuActions(session, canOrder)];
  assert.deepEqual(list({ status: 'yours' }, true), ['open', 'reply']);
  assert.deepEqual(list({ status: 'yours' }, false), ['open']);
  assert.deepEqual(list({ status: 'working', order: { status: 'running', approvals: [{ id: 'r1' }] } }, true), ['open', 'approve', 'stop']);
  assert.deepEqual(list({ status: 'working', order: { status: 'running', approvals: [] } }, true), ['open', 'stop']);
  assert.deepEqual(list({ status: 'idle', order: { status: 'done' } }, true), ['open', 'reply']);
  assert.deepEqual(list({ status: 'working', isHelper: true }, true), []);
  assert.deepEqual(list(null, true), []);
});

test('el modo ambiente pasea solo por los puestos con alguien trabajando o esperándote', () => {
  const activeStations = loadFunction('office.js', 'activeStations', 'floorMode', {});
  const stations = [
    { project: { id: 'a', sessions: [{ status: 'idle' }] } },
    { project: { id: 'b', sessions: [{ status: 'idle' }, { status: 'working' }] } },
    { project: { id: 'c', sessions: [{ status: 'yours' }] } }
  ];
  assert.deepEqual([...activeStations(stations).map(s => s.project.id)], ['b', 'c']);
});

test('avisa cuando aumentan las sesiones que te esperan o las aprobaciones, nunca en la primera carga', () => {
  const alertCounts = loadFunction('app.js', 'alertCounts', 'alertIncreased', {});
  const alertIncreased = loadFunction('app.js', 'alertIncreased', 'notifyArrival', {});
  const state = approvals => ({ projects: [{ sessions: [
    { status: 'yours' }, { status: 'working', order: { approvals } }, { status: 'idle' }
  ] }] });
  const one = alertCounts(state([]));
  assert.deepEqual({ ...one }, { yours: 1, approvals: 0 });
  const two = alertCounts(state([{ id: 'r1' }]));
  assert.equal(alertIncreased(null, two), false, 'primera carga');
  assert.equal(alertIncreased(one, two), true, 'nueva aprobación');
  assert.equal(alertIncreased(two, one), false, 'bajar no avisa');
  assert.equal(alertIncreased(one, one), false);
  assert.equal(alertIncreased({ yours: 0, approvals: 1 }, { yours: 1, approvals: 0 }), true, 'nueva sesión esperando');
});

test('las salas sin nadie trabajando, esperándote ni ayudantes en marcha pasan al pasillo de salas sin uso', () => {
  const context = { stations: [], closedRooms: [] };
  loadFunction('office.js', 'isDormant', 'splitRooms', context);
  const split = loadFunction('office.js', 'splitRooms', 'applyFloor', context);
  const station = (id, sessions) => ({ project: { id, sessions } });
  split([
    station('pausa', [{ status: 'idle' }]),
    station('trabaja', [{ status: 'working' }]),
    station('espera', [{ status: 'yours' }]),
    station('ayudante', [{ status: 'idle', subagents: [{ running: true }] }]),
    station('vacia', [])
  ]);
  assert.deepEqual(context.stations.map(s => s.project.id), ['trabaja', 'espera', 'ayudante']);
  assert.deepEqual(context.closedRooms.map(s => s.project.id), ['pausa', 'vacia']);
  assert.ok(context.closedRooms.every(s => s.closed));
});

test('misiones: cada coordinadora va con sus delegadas, en la sala del miembro que más urge', () => {
  const context = { Math, Date, MAX_ROWS: 3, DAY_MS: 24 * 60 * 60 * 1000 };
  loadFunction('missions.js', 'memberState', 'teamState', context);
  loadFunction('missions.js', 'teamState', 'roomOf', context);
  loadFunction('missions.js', 'roomOf', 'buildTeams', context);
  const build = loadFunction('missions.js', 'buildTeams', 'ticketHeight', context);
  const now = Date.now();
  const session = (id, status, extra) => Object.assign({ id, status, ownStatus: status, lastActivity: now - 1000, title: id }, extra);
  const state = { projects: [
    { id: 'p1', name: 'Atalaya', zone: 'trabajo', sessions: [
      session('coord', 'working', { childIds: ['w1', 'w2'], ownStatus: 'yours', waitingForTeam: true }),
      session('w1', 'working', { parentId: 'coord' }),
      session('w2', 'working', { parentId: 'coord', order: { approvals: [{}] } })] },
    { id: 'p4', name: 'Faro', zone: 'otros', sessions: [
      session('espera', 'working', { childIds: ['hija'], ownStatus: 'yours', waitingForTeam: true }),
      session('hija', 'working', { parentId: 'espera' })] },
    { id: 'p2', name: 'Dashboard', zone: 'personal', sessions: [
      session('solo', 'working'),
      session('vieja', 'idle', { lastActivity: now - 3 * 24 * 60 * 60 * 1000 })] },
    { id: 'p3', name: 'Librarian', zone: 'personal', sessions: [
      session('lib', 'idle', { childIds: ['hecha'] }),
      session('hecha', 'idle', { parentId: 'lib', ownStatus: 'yours', completedForParent: true })] }
  ] };
  const teams = build(state, now);
  const byId = Object.fromEntries(teams.map((t) => [t.id, t]));
  assert.deepEqual(Array.from(teams, (t) => t.id).sort(), ['coord', 'espera', 'lib', 'solo'], 'una por coordinadora o sesión suelta; lo viejo no entra');
  assert.equal(byId.coord.room, 'wait', 'una delegada que pide aprobación lleva a todo el equipo a «Te esperan»');
  assert.equal(byId.espera.room, 'work', 'una coordinadora que espera a sus delegadas está trabajando, no esperándote');
  assert.deepEqual(Array.from(byId.coord.workers, (w) => w.id), ['w2', 'w1'], 'primero la delegada que más urge');
  assert.equal(byId.solo.room, 'work');
  assert.equal(byId.lib.room, 'rest', 'una delegada que ya acabó no cuenta como «te espera»');
  assert.equal(context.memberState({ ownStatus: 'working', order: { approvals: [{}] } }), 'approval');
});

test('misiones: en el móvil las salas se apilan por prioridad y en la tablet son columnas sin pisarse', () => {
  const context = {
    Math, WALL_H: 18, SCENE_H: 40, MAX_ROWS: 3, ticketHeights: {},
    ROOMS: [{ key: 'wait' }, { key: 'work' }, { key: 'rest' }], COLUMN_ORDER: ['work', 'wait', 'rest']
  };
  loadFunction('missions.js', 'ticketHeight', 'computeLayout', context);
  const layout = loadFunction('missions.js', 'computeLayout', 'rect', context);
  const teams = [
    { id: 'a', room: 'work', workers: [] }, { id: 'b', room: 'wait', workers: [{}, {}] }, { id: 'c', room: 'wait', workers: [] }
  ];
  const phone = layout(180, false, teams);
  assert.deepEqual(Array.from(phone.rooms, (r) => r.room.key), ['wait', 'work', 'rest']);
  assert.ok(phone.rooms[0].slots[1].y > phone.rooms[0].slots[0].y + 40, 'los equipos de una sala van uno debajo de otro');
  assert.equal(phone.rooms[1].y, phone.rooms[0].y + phone.rooms[0].h);
  const tablet = layout(540, true, teams);
  assert.deepEqual(Array.from(tablet.rooms, (r) => [r.room.key, r.x]), [['work', 0], ['wait', 180], ['rest', 360]]);
  assert.ok(tablet.rooms.every((r) => r.h === tablet.h), 'todas las columnas igual de altas');
});

test('misiones: la nota de la Bandeja decide el tablón, la revisión y las hechas', () => {
  const context = {};
  loadFunction('missions.js', 'roomOf', 'issueNumber', context);
  loadFunction('missions.js', 'issueNumber', 'linkNote', context);
  const link = loadFunction('missions.js', 'linkNote', 'launchable', context);
  const launchable = loadFunction('missions.js', 'launchable', 'buildTeams', context);
  const ready = { state: 'ready', project: '/repo', title: 'Nota' };
  const notes = [
    { id: 'a', status: 'open', plan: ready, sentTo: [] },
    { id: 'b', status: 'sent', plan: ready, sentTo: [{ kind: 'session', sessionId: 's1' }, { kind: 'gitlab', ref: 'g/repo#42' }] },
    { id: 'c', status: 'sent', plan: ready, sentTo: [{ kind: 'gitlab', ref: 'g/repo#7', closed: 1 }] },
    { id: 'd', status: 'open', plan: { state: 'pending' }, sentTo: [] }
  ];
  assert.deepEqual(Array.from(launchable(notes), (n) => n.id), ['a'], 'solo las notas con plan y sin enviar van al tablón');
  const bySession = link([{ id: 's1' }], notes);
  assert.equal(bySession.note.id, 'b');
  assert.equal(context.roomOf('idle', bySession), 'review', 'issue abierto: en revisión');
  const byIssue = link([{ id: 'x', issue: '7', cwd: '/repo/app' }], notes);
  assert.equal(byIssue.note.id, 'c', 'una sesión abierta a mano se une por el número de issue en el mismo repo');
  assert.equal(context.roomOf('idle', byIssue), 'done', 'todo cerrado: hecha');
  assert.equal(context.roomOf('yours', byIssue), 'wait', 'si te espera, manda la espera');
  assert.equal(link([{ id: 'x', issue: '7', cwd: '/otro' }], notes), null);
});

test('el texto en vivo se reconcilia por mensaje aunque ya haya herramientas posteriores', () => {
  const context = { chat: {}, renderChat() {} };
  const apply = loadFunction('app.js', 'applyLiveMessages', 'updateChat', context);
  const agent = { role: 'agent', id: 'msg-1', text: 'Respuesta completa', at: 200 };
  const tool = { role: 'tool', text: 'Prueba', at: 210 };
  const body = { messages: [agent, tool], order: {
    status: 'running', startedAt: 100, replyId: 'msg-1', reply: 'Respuesta'
  } };
  apply(body);
  assert.equal(context.chat.messages.length, 2, 'no duplica el mensaje ya persistido');
  body.order.replyId = 'msg-2';
  apply(body);
  assert.equal(context.chat.messages.length, 3, 'dos mensajes distintos pueden repetir el texto');
  delete body.order.replyId;
  apply(body);
  assert.equal(context.chat.messages.length, 2, 'sin id compara solo dentro del turno actual');
  body.order.startedAt = 300;
  apply(body);
  assert.equal(context.chat.messages.length, 3, 'una respuesta antigua no oculta el nuevo turno');
  body.order.status = 'done';
  apply(body);
  assert.equal(context.chat.messages.length, 2);
  assert.equal(body.messages.length, 2, 'no modifica la instantánea recibida');
});

test('la ficha actual sustituye las respuestas anteriores y conserva el último encargo', () => {
  const current = loadFunction('app.js', 'currentMessages', 'updateChat', {});
  const messages = [
    { role: 'user', text: 'Encargo anterior' },
    { role: 'agent', text: 'Respuesta anterior' },
    { role: 'user', text: 'Ahora' },
    { role: 'agent', text: 'Primer avance' },
    { role: 'tool', text: 'Leyendo' },
    { role: 'agent', text: 'Último avance' }
  ];
  assert.deepEqual(Array.from(current(messages), m => m.text), ['Ahora', 'Último avance']);
  messages.push({ role: 'tool', text: 'Probando' });
  assert.deepEqual(Array.from(current(messages), m => m.text), ['Ahora', 'Último avance', 'Probando']);
  messages.push({ role: 'user', text: 'Siguiente turno' });
  assert.deepEqual(Array.from(current(messages), m => m.text), ['Siguiente turno']);
  assert.equal(messages.length, 8, 'el historial original se conserva');
});

test('abrir una superficie cierra las demás y el menú de la oficina', () => {
  const calls = [];
  const context = {
    window: { Office: { closeMenu() { calls.push('menu'); }, select(value) { calls.push(['select', value]); } } },
    selection: { session: { id: 's1' } }, launch: { open: true }, talk: { draft: 'Borrador' },
    closeTalk() { calls.push('talk'); context.talk = null; },
    renderLaunch() { calls.push('launch'); }
  };
  const prepare = loadFunction('app.js', 'prepareSurface', 'renderOfficeDetail', context);
  prepare('detail');
  assert.equal(context.launch.open, false);
  assert.equal(context.talk, null);
  assert.deepEqual(calls, ['menu', 'talk', 'launch'], 'conserva la ficha que se está abriendo');
  calls.length = 0;
  prepare('launch');
  assert.deepEqual(calls, ['menu', ['select', null]], 'nueva sesión cierra la ficha anterior');
});

test('Bandeja recoge el editor al cambiar de nota y conserva el borrador', () => {
  const draft = { id: 'n1', title: 'Corrección sin guardar', description: 'Texto' };
  const context = {
    editing: draft, editDrafts: {}, confirming: { id: 'n2' },
    dataskSearch: { q: 'app', timer: 12 }, listKey: 'anterior',
    clearTimeout() {}, renderList() { context.renders = (context.renders || 0) + 1; }
  };
  const suspend = loadFunction('inbox.js', 'suspend', 'dictated', context);
  suspend();
  assert.equal(context.editing, null);
  assert.equal(context.confirming, null);
  assert.equal(context.editDrafts.n1, draft);
  assert.equal(context.dataskSearch.q, '');
  assert.equal(context.listKey, null);
  assert.equal(context.renders, 1);
});

test('Bandeja conserva el foco y la selección del buscador al refrescar las notas', () => {
  let focused = false;
  let range;
  const field = { id: 'datask-search', selectionStart: 2, selectionEnd: 4 };
  const restored = { focus() { focused = true; }, setSelectionRange(a, b) { range = [a, b]; } };
  const box = { contains(el) { return el === field; }, innerHTML: '' };
  const context = {
    editing: null, data: { notes: [{ id: 'n1' }] }, busy: {}, confirming: {}, listKey: null, inboxFilter: 'all',
    document: { activeElement: field }, Date,
    h: { $: id => id === 'inbox-list' ? box : restored }, renderNote() { return '<article>Nota</article>'; }
  };
  const render = loadFunction('inbox.js', 'renderList', 'renderNote', context);
  render();
  assert.equal(focused, true);
  assert.deepEqual(range, [2, 4]);
});

test('Bandeja filtra pendientes y enviadas sin perder las notas originales', () => {
  const filter = loadFunction('inbox.js', 'filterNotes', 'renderNote', {});
  const notes = [{ id: 'pendiente', status: 'open' }, { id: 'enviada', status: 'sent' }];
  assert.deepEqual(Array.from(filter(notes, 'open'), n => n.id), ['pendiente']);
  assert.deepEqual(Array.from(filter(notes, 'sent'), n => n.id), ['enviada']);
  assert.equal(filter(notes, 'all').length, 2);
  assert.equal(notes.length, 2);
});

test('las notas dejan el original y las acciones secundarias plegados y conservan su apertura', () => {
  const context = {
    h: { escapeHtml: String, relativeTime: () => 'ahora' }, confirming: null, busy: {}, noteOpen: {},
    projectByKey: () => ({ name: 'App' }), projectChip: () => 'App', renderCandidates: () => '',
    renderSent: () => '', renderDestinations: () => '<button>Enviar</button>', sameText: (a, b) => a === b
  };
  const render = loadFunction('inbox.js', 'renderNote', 'renderCandidates', context);
  const note = { id: 'n1', status: 'open', text: 'Texto original', plan: { project: 'app', title: 'Encargo', description: 'Detalle' } };
  const html = render(note, Date.now());
  assert.match(html, /class="note-options"><summary>Detalles y opciones/);
  assert.ok(html.indexOf('Texto original') > html.indexOf('<summary>Detalles y opciones'));
  assert.match(html, /Por enviar/);
  context.noteOpen.n1 = true;
  assert.match(render(note, Date.now()), /class="note-options" open/);
});

test('los nombres se parten por palabras y MayúsculasInternas antes que dentro de una palabra', () => {
  const context = { ctx: { measureText: value => ({ width: value.length * 4.5 }) } };
  const wrap = loadFunction('office.js', 'wrapStationName', 'computeLayout', context);
  assert.equal(JSON.stringify(wrap('GameWallKMP', 44)), JSON.stringify(['GameWall', 'KMP']));
  assert.equal(JSON.stringify(wrap('ABC - Granos verde', 44)), JSON.stringify(['ABC -', 'Granos', 'verde']));
  // Una palabra que no cabe se parte en trozos iguales, no deja una letra suelta.
  assert.equal(JSON.stringify(wrap('puntosclub', 44)), JSON.stringify(['punto', 'sclub']));
  assert.equal(JSON.stringify(wrap('puntosclub-molino', 44)), JSON.stringify(['punto', 'sclub-', 'molino']));
});

test('la oficina abre en la planta que te espera y si no en la que trabaja', () => {
  const busiestFloor = loadFunction('office.js', 'busiestFloor', 'applyFloor', {});
  const floor = (zone, ...statuses) => ({ zone, stations: [{ project: { sessions: statuses.map(status => ({ status })) } }] });
  assert.equal(busiestFloor([floor('trabajo', 'idle'), floor('personal', 'working')]).zone, 'personal');
  assert.equal(busiestFloor([floor('trabajo', 'working'), floor('personal', 'yours')]).zone, 'personal');
  assert.equal(busiestFloor([floor('trabajo', 'idle'), floor('personal', 'idle')]).zone, 'trabajo');
  const approval = { zone: 'otros', stations: [{ project: { sessions: [{ status: 'working', order: { approvals: [{ id: 1 }] } }] } }] };
  assert.equal(busiestFloor([floor('trabajo', 'working'), approval]).zone, 'otros');
});

test('las salas sin uso se pliegan en una fila con «+N» y se despliegan enteras', () => {
  const context = { MARGIN: 16, DOOR_W: 56, DOOR_H: 44, DOOR_GAP: 6, CLOSED_HEAD: 16, closedOpen: false,
    closedRooms: Array.from({ length: 18 }, () => ({})) };
  loadFunction('office.js', 'doorsPerRow', 'closedSlots', context);
  const slots = loadFunction('office.js', 'closedSlots', 'closedBand', context);
  const band = loadFunction('office.js', 'closedBand', 'measureBelowStage', context);
  const w = 16 * 2 + 56 * 4;
  assert.equal(JSON.stringify(slots(w)), JSON.stringify({ per: 4, shown: 3, toggle: true }));
  assert.equal(band(w), 16 + 50 + 4, 'plegado ocupa una sola fila');
  context.closedOpen = true;
  assert.equal(JSON.stringify(slots(w)), JSON.stringify({ per: 4, shown: 18, toggle: true }));
  assert.equal(band(w), 16 + 5 * 50 + 4);
  context.closedRooms = context.closedRooms.slice(0, 4);
  context.closedOpen = false;
  assert.equal(JSON.stringify(slots(w)), JSON.stringify({ per: 4, shown: 4, toggle: false }), 'si caben todas no hay botón');
});

test('el puesto enseña la sesión que más urge y turna las que urgen igual', () => {
  const focus = loadFunction('office.js', 'stationFocus', 'drawActionBubbles', {});
  const working = { id: 'a', status: 'working' };
  const waiting = { id: 'b', status: 'yours' };
  const asking = { id: 'c', status: 'working', order: { approvals: [{ id: 1 }] } };
  assert.equal(focus([working, waiting], 0), waiting);
  assert.equal(focus([waiting, asking], 0).id, 'b');
  assert.equal(focus([waiting, asking], 4000).id, 'c');
  assert.equal(focus([{ id: 'd', status: 'idle' }], 0), null);
});

test('una sesión que trabaja sin escribir nada en 10 minutos sale como atascada', () => {
  const isStuck = loadFunction('office.js', 'isStuck', 'drawStuck', { STUCK_MS: 10 * 60 * 1000 });
  const now = 100 * 60 * 1000;
  assert.equal(isStuck({ status: 'working', lastActivity: now - 11 * 60 * 1000 }, now), true);
  assert.equal(isStuck({ status: 'working', lastActivity: now - 2 * 60 * 1000 }, now), false);
  // Una orden del panel que sigue informando de actividad no está atascada.
  assert.equal(isStuck({ status: 'working', lastActivity: now - 11 * 60 * 1000, order: { activity: { at: now - 1000 } } }, now), false);
  assert.equal(isStuck({ status: 'yours', lastActivity: 0 }, now), false);
});

test('la pizarra resume el día solo por la noche y con nada trabajando', () => {
  const station = (...sessions) => ({ project: { sessions } });
  const context = { EVENING_HOUR: 20, allStations: [] };
  const summary = loadFunction('office.js', 'eveningSummary', 'drawDaySummary', context);
  const evening = new Date(2026, 10, 3, 21, 0);
  const today = new Date(2026, 10, 3, 10, 0).getTime();
  const yesterday = new Date(2026, 10, 2, 10, 0).getTime();
  context.allStations = [station({ status: 'done', lastActivity: today }, { status: 'idle', lastActivity: yesterday }), station({ status: 'yours', lastActivity: today })];
  assert.equal(summary(evening), 2);
  assert.equal(summary(new Date(2026, 10, 3, 18, 0)), null, 'antes de las 20:00 no');
  context.allStations.push(station({ status: 'working', lastActivity: today }));
  assert.equal(summary(evening), null, 'con alguien trabajando no');
});
