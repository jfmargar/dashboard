// Oficina pixel: cada proyecto es un puesto de trabajo y cada sesión, un personaje.
// Quien trabaja se sienta en su puesto; quien te espera queda de pie delante; las sesiones
// en pausa descansan en la zona común. Al cambiar de estado, el personaje camina hasta su sitio.
// Sin optional chaining ni `??`: la tablet puede llevar un Chrome antiguo.
(function () {
  'use strict';

  var FRAME = 32;

  // Medidas lógicas (en píxeles del pixel art, antes de escalar)
  // Todo va en múltiplos de 16 px, la rejilla de los gráficos de pixel-agents.
  var TILE = 16;
  var STATION_W = 112;
  var STATION_H = 128;
  var SIGN_HEIGHT = 32;
  var AISLE = 16;
  var MARGIN = 16;
  var WALL_H = 32;
  var LOUNGE_H = 80;
  var SEATS = [44, 68];
  // Salas sin uso: puerta con su placa, en un pasillo entre los puestos y la zona común.
  var DOOR_W = 56;
  var DOOR_H = 44;
  var DOOR_GAP = 6;
  var CLOSED_HEAD = 16;
  var STANDING = [28, 56, 84];
  // Sitios de los ayudantes (subagentes) a los lados de la mesa
  var HELPER_SPOTS = [{ x: 10, y: 92 }, { x: 102, y: 92 }, { x: 10, y: 110 }, { x: 102, y: 110 }];
  // Todos los ayudantes llevan la misma ropa para distinguirlos de las sesiones
  var HELPER_OUTFIT = 3;
  // Quien trabaja se sienta delante de la mesa, de espaldas, mirando su PC.
  var SEAT_FEET = 106;
  var STAND_FEET = 124;
  var DESK_X = 32;
  var DESK_Y = 58;

  var LOUNGE_RECENT_MS = 24 * 60 * 60 * 1000;
  // Momentos: el destello al terminar dura poco; «atascada» es trabajar sin escribir nada en 10 min.
  var CELEBRATE_MS = 1200;
  var STUCK_MS = 10 * 60 * 1000;
  // Desde esta hora, con todo parado, la pizarra enseña lo que se ha movido hoy.
  var EVENING_HOUR = 20;
  var WALK_SPEED = 46;
  var STEP_MS = 50;
  var WALK_FRAME_MS = 110;

  // Fotogramas del pack MetroCity: 0-5 abajo, 6-11 derecha, 12-17 arriba. La izquierda es la derecha en espejo.
  var DIR_FRAMES = { down: 0, right: 6, up: 12, left: 6 };
  var SKIN_ROWS = 6;
  var OUTFITS = 6;
  var HAIR_ROWS = 8;

  // Zonas de la oficina en orden. Llegan con el estado (`state.zones`, de data/config.json); estos son los
  // valores por defecto mientras tanto. La zona destacada (`accent`) lleva puestos rojos y el logotipo.
  var ZONE_ORDER = { trabajo: 0, personal: 1, otros: 2 };
  var ACCENT_ZONES = { trabajo: true };

  var COLORS = {
    background: '#101218',
    wall: '#262a36',
    wallLine: '#3a4052',
    window: '#2f4a63',
    windowLight: '#46698a',
    floorA: '#4a3b35',
    floorB: '#463831',
    floorSeam: '#3a2e29',
    rug: '#40364a',
    rugSelected: '#4c4258',
    lounge: '#273a3a',
    loungeB: '#243636',
    sofa: '#7a4d5c',
    sofaDark: '#5e3a47',
    coffee: '#4b5163',
    plant: '#4f9a62',
    pot: '#8a5a3c',
    door: '#5a4636',
    deskTop: '#9a6b45',
    deskFront: '#6e4a30',
    deskShadow: '#4a3222',
    chair: '#2b2f3a',
    laptop: '#4b5163',
    screenOn: '#5fd38d',
    screenOnDim: '#4bb877',
    screenOff: '#2c3a33',
    bubble: '#f4f1e8',
    ink: '#2b2f3a',
    yours: '#f2c14e',
    working: '#5fd38d',
    idle: '#8a90a0',
    text: '#e8eaf0',
    textDim: '#8a90a0',
    dim: 'rgba(16,18,24,0.5)',
    claude: '#d97757',
    codex: '#8ea2ff',
    // Coordinadora y sesiones de issue (tema oscuro)
    coordinator: '#adc6ff',
    worker: '#5fd6e3',
    // Mobiliario
    partition: '#3b4252',
    partitionTop: '#4f586d',
    partitionShade: '#2c313d',
    plate: '#262a35',
    chairSeat: '#3d4250',
    deskTopHi: '#b5835a',
    deskPanel: '#5e3f29',
    monitorBack: '#454b5c',
    monitorStand: '#2b2f3a',
    mug: '#e8e3d6',
    paper: '#d8d4c8',
    lampShade: '#f2c14e',
    book1: '#c4574f',
    book2: '#5b8def',
    book3: '#5fb37a',
    shelf: '#5a4636',
    rugLounge: '#2f4a48',
    rugLoungeBorder: '#3d5f5c',
    cooler: '#9fd3e6',
    // Luz según la hora
    skyDay: '#86bde8',
    skyDayHi: '#b4d8f2',
    skyDusk: '#e89a6b',
    skyDuskHi: '#f4c48f',
    skyNight: '#1b2340',
    skyNightHi: '#26305a',
    sunPatch: 'rgba(255,236,190,0.07)',
    night: 'rgba(8,10,30,0.24)',
    // Zona destacada y placa del logotipo
    accent: '#c43f3c',
    accentEdge: '#d77766',
    plaque: '#fcf8f7'
  };

  // Iconos de 7×7 para lo que hace una sesión lanzada desde el panel: '#' = píxel.
  var ACTIVITY_ICONS = {
    reading: ['.###...', '#...#..', '#...#..', '#...#..', '.###...', '....##.', '.....##'],
    editing: ['.....##', '....###', '...###.', '..###..', '.###...', '##.....', '#......'],
    running: ['#......', '.#.....', '..#....', '.#.....', '#......', '.......', '...####'],
    delegating: ['.#...#.', '###.###', '.#...#.', '.......', '.#...#.', '###.###', '.#...#.'],
    // Esperando tu aprobación: una llave
    approval: ['..###..', '..#.#..', '..###..', '...#...', '...##..', '...#...', '...##..']
  };

  var sheets = null;
  var logo = null;
  var logoUrl = null;
  // Capas HTML sobre el canvas: letreros nítidos, tarjeta flotante y controles de zoom
  var stage = null;
  var world = null;
  var labelsLayer = null;
  var projectPicker = null;
  var overviewButton = null;
  var inboxHandler = null;
  var card = null;
  var zoom = 1;
  var overview = false;
  var ZOOM_LEVELS = [1, 1.5, 2, 3];
  var MAX_SCALE = 4;
  var TOUCH_REACH = 22;
  var hoverId = null;
  var belowStage = 110;
  // Cámara: gesto en curso (arrastre o pellizco), dedos apoyados, vuelo o inercia en marcha,
  // escala CSS provisional mientras se pellizca y hueco que tapan la hoja o el panel.
  var MIN_ZOOM = 1;
  var MAX_ZOOM = 3;
  var FLY_MS = 380;
  var DOUBLE_TAP_MS = 320;
  var gesture = null;
  var pointers = {};
  var pointerCount = 0;
  var camera = null;
  var preview = null;
  var lastTap = null;
  var wheelTimer = null;
  var suppressUntil = 0;
  var insets = { right: 0, bottom: 0 };
  var frameProvider = null;
  var queueButton = null;
  var lightCanvas = null;
  // Mando: menú circular al mantener pulsado, plantas por zona en el móvil y paseo del modo ambiente.
  var LONG_PRESS_MS = 450;
  var MENU_RADIUS = 64;
  var MENU_SLOTS = { open: -90, reply: 0, stop: 90, approve: 180 };
  var MENU_LABELS = { open: 'Abrir', reply: 'Contestar', approve: 'Aprobar', stop: 'Parar' };
  var FLOOR_QUERY = '(max-width: 760px)';
  var FLOOR_TITLES = { trabajo: 'Trabajo', personal: 'Personal', otros: 'Otros' };
  var STROLL_MS = 4200;
  var STROLL_PAUSE_MS = 6000;
  var allStations = [];
  var floors = [];
  var floorZone = null;
  var floorNav = null;
  var menu = null;
  var actionHandler = function () {};
  var stroll = null;
  var eyes = [];
  var canvas = null;
  var ctx = null;
  var scale = 2;
  var layout = null;
  var view = null;
  var stations = [];
  var closedRooms = [];
  // Las salas sin uso van plegadas en una fila; tocar «+N» las enseña todas.
  var closedOpen = false;
  var characters = {};
  var selected = { sessionId: null, projectId: null };
  var initialized = false;
  var timer = null;
  var clock = 0;
  var lastState = null;
  var onSelect = function () {};

  // Carga de sprites

  function loadImage(src) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = reject;
      img.src = src;
    });
  }

  function loadSheets() {
    var base = '/assets/MetroCity/';
    var outfits = [];
    for (var i = 1; i <= OUTFITS; i++) outfits.push(loadImage(base + 'Outfits/Outfit' + i + '.png'));
    return Promise.all([
      loadImage(base + 'CharacterModel/Character%20Model.png'),
      loadImage(base + 'CharacterModel/Shadow.png'),
      loadImage(base + 'Hair/Hairs.png'),
      Promise.all(outfits)
    ]).then(function (images) {
      sheets = { body: images[0], shadow: images[1], hair: images[2], outfits: images[3] };
      return loadOfficeAssets();
    }).then(function () {
    });
  }

  // Gráficos de oficina de pixel-agents (MIT). Suelos, paredes y alfombras vienen en gris y se colorean al pintar.
  var OFFICE_ASSETS = {
    floor: 'floors/floor_1.png',
    loungeFloor: 'floors/floor_4.png',
    wall: 'walls/wall_0.png',
    carpet: 'carpets/carpet_0.png',
    desk: 'furniture/DESK/DESK_FRONT.png',
    pcOn1: 'furniture/PC/PC_FRONT_ON_1.png',
    pcOn2: 'furniture/PC/PC_FRONT_ON_2.png',
    pcOn3: 'furniture/PC/PC_FRONT_ON_3.png',
    pcOff: 'furniture/PC/PC_FRONT_OFF.png',
    chair: 'furniture/CUSHIONED_CHAIR/CUSHIONED_CHAIR_BACK.png',
    sofa: 'furniture/SOFA/SOFA_FRONT.png',
    coffeeTable: 'furniture/COFFEE_TABLE/COFFEE_TABLE.png',
    coffee: 'furniture/COFFEE/COFFEE.png',
    bookshelf: 'furniture/DOUBLE_BOOKSHELF/DOUBLE_BOOKSHELF.png',
    smallTable: 'furniture/SMALL_TABLE/SMALL_TABLE_FRONT.png',
    whiteboard: 'furniture/WHITEBOARD/WHITEBOARD.png',
    clock: 'furniture/CLOCK/CLOCK.png',
    largePainting: 'furniture/LARGE_PAINTING/LARGE_PAINTING.png',
    smallPainting: 'furniture/SMALL_PAINTING/SMALL_PAINTING.png',
    smallPainting2: 'furniture/SMALL_PAINTING_2/SMALL_PAINTING_2.png',
    hangingPlant: 'furniture/HANGING_PLANT/HANGING_PLANT.png',
    plant: 'furniture/PLANT/PLANT.png',
    plant2: 'furniture/PLANT_2/PLANT_2.png',
    largePlant: 'furniture/LARGE_PLANT/LARGE_PLANT.png',
    cactus: 'furniture/CACTUS/CACTUS.png',
    bin: 'furniture/BIN/BIN.png',
    bookshelfSmall: 'furniture/BOOKSHELF/BOOKSHELF.png'
  };
  var office = {};

  function loadOfficeAssets() {
    var keys = Object.keys(OFFICE_ASSETS);
    return Promise.all(keys.map(function (key) {
      return loadImage('/assets/pixel-agents/' + OFFICE_ASSETS[key])
        .then(function (img) { office[key] = img; })
        .catch(function () {});
    }));
  }

  // El aspecto de cada personaje sale del id de la sesión, así no cambia entre refrescos.
  function hash(text) {
    var h = 2166136261;
    for (var i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function lookFor(sessionId, isHelper) {
    var h = hash(sessionId);
    return { skin: h % SKIN_ROWS, outfit: isHelper ? HELPER_OUTFIT : (h >>> 4) % OUTFITS, hair: (h >>> 8) % HAIR_ROWS };
  }

  // Distribución: los puestos van en orden fijo (zona y nombre) para que cada proyecto tenga siempre su sitio.

  function buildStations(state) {
    var projects = state.projects.slice().sort(function (a, b) {
      var za = ZONE_ORDER[a.zone] === undefined ? 9 : ZONE_ORDER[a.zone];
      var zb = ZONE_ORDER[b.zone] === undefined ? 9 : ZONE_ORDER[b.zone];
      if (za !== zb) return za - zb;
      return a.name.localeCompare(b.name, 'es');
    });
    return projects.map(function (project) { return { project: project, seatTaken: [false, false], extra: 0 }; });
  }

  // Plantas del móvil: una por zona con puestos, en el orden de las zonas. Una zona desconocida va a Otros.
  function groupFloors(list) {
    var byZone = {};
    var result = [];
    list.forEach(function (station) {
      var zone = ZONE_ORDER[station.project.zone] === undefined ? 'otros' : station.project.zone;
      if (!byZone[zone]) {
        byZone[zone] = { zone: zone, stations: [] };
        result.push(byZone[zone]);
      }
      byZone[zone].stations.push(station);
    });
    return result.sort(function (a, b) { return ZONE_ORDER[a.zone] - ZONE_ORDER[b.zone]; });
  }

  // Deslizar en horizontal cambia de planta (1 la siguiente, -1 la anterior) si el gesto es claramente
  // horizontal y la oficina ya no se podía desplazar hacia ese lado.
  function swipeFloor(dx, dy, atLeftEdge, atRightEdge) {
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return 0;
    if (dx < 0 && atRightEdge) return 1;
    if (dx > 0 && atLeftEdge) return -1;
    return 0;
  }

  // Acciones del menú circular de una sesión: abrir siempre; contestar si se le puede escribir;
  // aprobar con peticiones pendientes y parar con una orden en marcha.
  function menuActions(session, canOrder) {
    if (!session || session.isHelper) return [];
    var order = session.order || null;
    var actions = ['open'];
    if (!canOrder) return actions;
    if (session.status !== 'working') actions.push('reply');
    if (order && order.approvals && order.approvals.length) actions.push('approve');
    if (order && order.status === 'running') actions.push('stop');
    return actions;
  }

  // Puestos con alguien trabajando o esperándote: por donde pasea la cámara en el modo ambiente.
  function activeStations(list) {
    return list.filter(function (station) {
      return station.project.sessions.some(function (s) { return s.status === 'working' || s.status === 'yours'; });
    });
  }

  function floorMode() {
    return Boolean(window.matchMedia && window.matchMedia(FLOOR_QUERY).matches);
  }

  function isAccent(zone) {
    return ACCENT_ZONES[zone] === true;
  }

  // Zonas y logotipo de data/config.json, que llegan con cada estado.
  function applyZones(state) {
    if (state.zones && state.zones.length) {
      var order = {};
      var accent = {};
      var titles = {};
      state.zones.forEach(function (zone, i) {
        order[zone.id] = i;
        titles[zone.id] = zone.title;
        if (zone.accent) accent[zone.id] = true;
      });
      ZONE_ORDER = order;
      ACCENT_ZONES = accent;
      FLOOR_TITLES = titles;
    }
    var url = state.logo || null;
    if (url === logoUrl) return;
    logoUrl = url;
    logo = null;
    // El logotipo es opcional: sin él la oficina se pinta igual.
    if (url) loadImage(url).then(function (img) { if (logoUrl === url) { logo = img; draw(); } }).catch(function () {});
  }

  function zoneOf(project) {
    return ZONE_ORDER[project.zone] === undefined ? 'otros' : project.zone;
  }

  // Sala sin uso: nadie trabaja ni te espera y no hay ayudantes en marcha. No ocupa un puesto entero.
  function isDormant(project) {
    return !project.sessions.some(function (s) {
      return s.status === 'working' || s.status === 'yours' ||
        (s.subagents || []).some(function (sub) { return sub.running; });
    });
  }

  // Reparte los puestos visibles entre la rejilla (con actividad) y el pasillo de salas sin uso.
  function splitRooms(list) {
    stations = list.filter(function (station) { return !(station.closed = isDormant(station.project)); });
    closedRooms = list.filter(function (station) { return station.closed; });
  }

  // Al abrir, la planta con algo que hacer: la que te espera (o pide aprobación), si no la que trabaja.
  function busiestFloor(list) {
    var best = list[0];
    var bestScore = -1;
    list.forEach(function (floor) {
      var score = 0;
      floor.stations.forEach(function (station) {
        station.project.sessions.forEach(function (s) {
          var approvals = s.order && s.order.approvals && s.order.approvals.length;
          if (s.status === 'yours' || approvals) score = 2;
          else if (s.status === 'working' && score < 1) score = 1;
        });
      });
      if (score > bestScore) {
        best = floor;
        bestScore = score;
      }
    });
    return best;
  }

  // Elige los puestos que se dibujan: todos, o los de la planta actual en el móvil.
  function applyFloor() {
    floors = groupFloors(allStations);
    if (!floorMode() || !floors.length) {
      splitRooms(allStations);
      renderFloorNav();
      return;
    }
    var floor = null;
    floors.forEach(function (f) { if (f.zone === floorZone) floor = f; });
    if (!floor) floor = floorZone === null ? busiestFloor(floors) : floors[0];
    floorZone = floor.zone;
    splitRooms(floor.stations);
    renderFloorNav();
  }

  // Nombre en líneas completas, sin acortarlo nunca. Se corta por espacios, guiones, barras bajas o
  // MayúsculasInternas; una palabra que no cabe sola se parte en trozos iguales («LOYAL / TYAPP»).
  function wrapStationName(value, width, font) {
    ctx.font = font || '8px Silkscreen, monospace';
    var fits = function (piece) { return ctx.measureText(piece.replace(/\u200b/g, '').trim()).width <= width; };
    var pieces = [];
    var marked = String(value).trim().replace(/_/g, ' ').replace(/([a-z\u00e0-\u00ff])([A-Z])/g, '$1\u200b$2');
    (marked.match(/[^\s\-\u200b·]+[\s\-\u200b·]*|[\s\-\u200b·]+/g) || []).forEach(function (piece) {
      if (fits(piece)) {
        pieces.push(piece);
        return;
      }
      var tail = /[\s\-\u200b·]*$/.exec(piece)[0];
      var word = piece.slice(0, piece.length - tail.length);
      for (var parts = 2; parts <= word.length; parts++) {
        var size = Math.ceil(word.length / parts);
        var chunks = [];
        for (var i = 0; i < word.length; i += size) chunks.push(word.slice(i, i + size));
        chunks[chunks.length - 1] += tail.replace(/\u200b/g, '');
        if (chunks.every(fits)) {
          pieces.push.apply(pieces, chunks.map(function (chunk, n) { return n < chunks.length - 1 ? chunk + '\u200b' : chunk; }));
          return;
        }
      }
      pieces.push(piece);
    });
    var lines = [];
    var line = '';
    pieces.forEach(function (piece) {
      if (!line || fits(line + piece)) line += piece;
      else {
        lines.push(line);
        line = piece;
      }
    });
    if (line) lines.push(line);
    lines = lines.map(function (l) { return l.replace(/\u200b/g, '').trim(); }).filter(Boolean);
    return lines.length ? lines : [''];
  }

  function computeLayout() {
    var availableW = stage.clientWidth;
    if (!availableW) return null;
    var availableH = Math.max(260, window.innerHeight - (stage.getBoundingClientRect().top + window.pageYOffset) - belowStage);
    var maxLines = 1;
    stations.forEach(function (station) {
      station.nameLines = wrapStationName(station.project.label || station.project.name, STATION_W - 20);
      maxLines = Math.max(maxLines, station.nameLines.length);
    });
    SIGN_HEIGHT = Math.max(32, maxLines * 10 + 18);
    STATION_H = 96 + SIGN_HEIGHT;
    DESK_Y = 26 + SIGN_HEIGHT;
    SEAT_FEET = 74 + SIGN_HEIGHT;
    STAND_FEET = 92 + SIGN_HEIGHT;
    HELPER_SPOTS = [{ x: 10, y: 60 + SIGN_HEIGHT }, { x: 102, y: 60 + SIGN_HEIGHT },
      { x: 10, y: 78 + SIGN_HEIGHT }, { x: 102, y: 78 + SIGN_HEIGHT }];
    closedRooms.forEach(function (station) {
      var lines = wrapStationName(station.project.label || station.project.name, DOOR_W - 12, '6px Silkscreen, monospace');
      if (lines.length > 2) lines = [lines[0], lines.slice(1).join('')];
      station.doorLines = lines;
    });
    // El ancho cuenta todas las salas, para que no cambie cuando una se queda sin uso; el alto, solo las activas.
    var count = Math.max(stations.length + closedRooms.length, 1);
    var active = stations.length;
    var best = null;
    for (var cols = 2; cols <= Math.max(2, Math.min(count, 8)); cols++) {
      var rows = Math.ceil(active / cols);
      var w = cols * STATION_W + MARGIN * 2;
      var h = WALL_H + TILE + rows * (STATION_H + AISLE) + closedBand(w) + LOUNGE_H;
      var fit = Math.min(availableW / w, availableH / h);
      if (!best || fit > best.fit) best = { cols: cols, rows: rows, w: w, h: h, fit: fit };
    }
    if (!overview) {
      var cols = Math.max(1, Math.min(count, 6, Math.floor(availableW / 190)));
      var rows = Math.ceil(active / cols);
      var width = cols * STATION_W + MARGIN * 2;
      best = { cols: cols, rows: rows, w: width,
        h: WALL_H + TILE + rows * (STATION_H + AISLE) + closedBand(width) + LOUNGE_H };
      best.fit = Math.min(2, availableW / best.w);
    }
    best.fitScale = Math.min(best.fit, availableW / best.w);
    best.cssScale = best.fitScale * zoom;
    best.availableH = availableH;
    best.viewH = Math.min(availableH, Math.floor(best.h * best.cssScale));
    best.stationsTop = WALL_H + TILE;
    best.closedTop = best.stationsTop + best.rows * (STATION_H + AISLE);
    best.closedPer = doorsPerRow(best.w);
    best.loungeTop = best.closedTop + closedBand(best.w);
    best.door = { x: best.w - MARGIN - 8, y: best.loungeTop + LOUNGE_H - 6 };
    return best;
  }

  function doorsPerRow(w) {
    return Math.max(1, Math.floor((w - MARGIN * 2) / DOOR_W));
  }

  // Huecos del pasillo: plegado cabe en una fila (las primeras puertas y «+N»); desplegado, todas y «Plegar».
  function closedSlots(w) {
    var per = doorsPerRow(w);
    if (closedRooms.length <= per) return { per: per, shown: closedRooms.length, toggle: false };
    if (closedOpen) return { per: per, shown: closedRooms.length, toggle: true };
    return { per: per, shown: per - 1, toggle: true };
  }

  // Alto del pasillo de salas sin uso (nada si no hay ninguna).
  function closedBand(w) {
    if (!closedRooms.length) return 0;
    var slots = closedSlots(w);
    return CLOSED_HEAD + Math.ceil((slots.shown + (slots.toggle ? 1 : 0)) / slots.per) * (DOOR_H + DOOR_GAP) + 4;
  }

  // Sitio que se deja bajo la oficina: el que pide la hoja de estilos (--office-below) más
  // la barra de navegación cuando va fija abajo.
  function measureBelowStage() {
    var below = parseFloat(window.getComputedStyle(stage).getPropertyValue('--office-below')) || 110;
    var bar = document.querySelector('.tabs');
    if (bar && window.getComputedStyle(bar).position === 'fixed') {
      var box = bar.getBoundingClientRect();
      if (box.top > window.innerHeight / 2) below += box.height;
    }
    return below;
  }

  function resize() {
    if (!canvas) return false;
    belowStage = measureBelowStage();
    var next = computeLayout();
    if (!next) return false;
    var changed = !layout || layout.cols !== next.cols || layout.rows !== next.rows;
    layout = next;
    var dpr = window.devicePixelRatio || 1;
    // Escala interna entera (nítida) y con tope, para no gastar memoria al acercar.
    scale = Math.min(MAX_SCALE, Math.max(2, Math.ceil(layout.cssScale * dpr)));
    view = null;
    var cssW = Math.floor(layout.w * layout.cssScale);
    var cssH = Math.floor(layout.h * layout.cssScale);
    world.style.width = cssW + 'px';
    world.style.height = cssH + 'px';
    stage.style.height = Math.min(cssH, layout.viewH) + 'px';
    stage.className = 'office-stage' + (overview ? ' is-overview' : '');
    applyInsets();
    stations.forEach(function (station, index) {
      station.x = MARGIN + (index % layout.cols) * STATION_W;
      station.y = layout.stationsTop + Math.floor(index / layout.cols) * (STATION_H + AISLE);
      station.row = Math.floor(index / layout.cols);
    });
    var slots = closedSlots(layout.w);
    var per = slots.per;
    var startX = MARGIN + Math.floor((layout.w - MARGIN * 2 - per * DOOR_W) / 2);
    var slotAt = function (index) {
      return { x: startX + (index % per) * DOOR_W + 3, y: layout.closedTop + CLOSED_HEAD + Math.floor(index / per) * (DOOR_H + DOOR_GAP) };
    };
    // Las plegadas comparten el hueco de «+N»: elegirlas (selector, atrás) despliega el pasillo.
    closedRooms.forEach(function (station, index) {
      var spot = slotAt(Math.min(index, slots.shown));
      station.x = spot.x;
      station.y = spot.y;
      station.folded = index >= slots.shown;
    });
    layout.closedToggle = slots.toggle ? slotAt(slots.shown) : null;
    layout.closedFolded = closedRooms.length - slots.shown;
    renderLabels();
    return changed;
  }

  function aisleBelow(row) {
    return layout.stationsTop + row * (STATION_H + AISLE) + STATION_H + AISLE / 2;
  }

  function aisleAbove(row) {
    return layout.stationsTop + row * (STATION_H + AISLE) - AISLE / 2;
  }

  function loungeSpots() {
    var top = layout.loungeTop;
    // Dos sofás de dos plazas y, a la derecha de la mesa del café, sitio de pie.
    var spots = [
      { x: 40, y: top + 44, pose: 'sofa' },
      { x: 56, y: top + 44, pose: 'sofa' },
      { x: 88, y: top + 44, pose: 'sofa' },
      { x: 104, y: top + 44, pose: 'sofa' }
    ];
    // Con recepción junto a la puerta, el sitio de pie termina antes del mostrador.
    var end = receptionBox() ? receptionBox().x - 52 : layout.w - 72;
    for (var x = 200; x < end && spots.length < 10; x += 18) spots.push({ x: x, y: top + 62, pose: 'lounge' });
    spots.forEach(function (spot) { spot.aisle = top - AISLE / 2; });
    return spots;
  }

  // A dónde tiene que ir cada sesión según su estado.
  function assignTargets(now) {
    var targets = {};
    stations.forEach(function (station) {
      var project = station.project;
      var working = [];
      var waiting = [];
      project.sessions.forEach(function (s) {
        if (s.status === 'working') working.push(s);
        else if (s.status === 'yours') waiting.push(s);
      });
      var byRole = function (a, b) {
        var ca = a.role === 'coordinator' ? 0 : 1;
        var cb = b.role === 'coordinator' ? 0 : 1;
        return ca !== cb ? ca - cb : b.lastActivity - a.lastActivity;
      };
      working.sort(byRole);
      waiting.sort(byRole);
      var queue = working.concat(waiting);
      station.extra = 0;
      station.active = queue.length > 0;
      station.seatTaken = [false, false];
      var standing = 0;
      queue.forEach(function (s, i) {
        if (s.status === 'working' && i < SEATS.length) {
          station.seatTaken[i] = true;
          targets[s.id] = {
            session: s, project: project, pose: 'seat',
            x: station.x + SEATS[i], y: station.y + SEAT_FEET, aisle: aisleBelow(station.row)
          };
        } else if (standing < STANDING.length) {
          targets[s.id] = {
            session: s, project: project, pose: 'stand',
            x: station.x + STANDING[standing], y: station.y + STAND_FEET, aisle: aisleBelow(station.row)
          };
          standing += 1;
        } else {
          station.extra += 1;
        }
      });
    });

    // Ayudantes: los subagentes que siguen trabajando, junto a la mesa de la sesión que los lanzó.
    stations.forEach(function (station) {
      var used = 0;
      station.project.sessions.forEach(function (s) {
        (s.subagents || []).forEach(function (sub) {
          if (!sub.running || used >= HELPER_SPOTS.length) return;
          var spot = HELPER_SPOTS[used];
          used += 1;
          targets[sub.id] = {
            session: {
              id: sub.id, isHelper: true, agent: sub.agent, kind: sub.kind,
              description: sub.description, parentId: s.id, status: 'working'
            },
            project: station.project, pose: 'helper',
            x: station.x + spot.x, y: station.y + spot.y, aisle: aisleBelow(station.row)
          };
        });
      });
    });

    // Zona común: las sesiones en pausa de las últimas 24 h que quepan.
    var resting = [];
    stations.forEach(function (station) {
      station.project.sessions.forEach(function (s) {
        // Las terminadas también descansan: ya no les toca nada, ni a ti.
        if ((s.status === 'idle' || s.status === 'done') && now - s.lastActivity <= LOUNGE_RECENT_MS) resting.push({ session: s, project: station.project });
      });
    });
    resting.sort(function (a, b) { return b.session.lastActivity - a.session.lastActivity; });
    var spots = loungeSpots();
    resting.slice(0, spots.length).forEach(function (item, i) {
      var spot = spots[i];
      targets[item.session.id] = {
        session: item.session, project: item.project, pose: spot.pose,
        x: spot.x, y: spot.y, aisle: spot.aisle
      };
    });
    return targets;
  }

  // Personajes y paseos

  function targetKey(target) {
    return target.pose + ':' + target.x + ':' + target.y;
  }

  // Camino por los pasillos: al pasillo propio, por la junta entre puestos hasta el pasillo
  // de destino y de ahí a su sitio. Así nadie atraviesa las mesas.
  function planPath(from, to) {
    var corridor = MARGIN + Math.round((to.x - MARGIN) / STATION_W) * STATION_W;
    corridor = Math.max(MARGIN / 2, Math.min(layout.w - MARGIN / 2, corridor));
    return [
      { x: from.x, y: from.aisle },
      { x: corridor, y: from.aisle },
      { x: corridor, y: to.aisle },
      { x: to.x, y: to.aisle },
      { x: to.x, y: to.y }
    ];
  }

  function doorPoint() {
    return { x: layout.door.x, y: layout.door.y, aisle: layout.loungeTop - AISLE / 2 };
  }

  function syncCharacters(targets) {
    Object.keys(targets).forEach(function (id) {
      var target = targets[id];
      var c = characters[id];
      if (!c) {
        var start = initialized ? doorPoint() : target;
        c = characters[id] = {
          id: id, look: lookFor(id, target.session.isHelper), x: start.x, y: start.y, aisle: start.aisle,
          dir: 'down', path: initialized ? planPath(start, target) : [], key: targetKey(target), leaving: false
        };
      } else if (c.session && c.session.status !== 'done' && target.session.status === 'done') {
        c.celebrateAt = Date.now();
      }
      if (c.key !== targetKey(target) || c.leaving) {
        c.path = planPath(c, target);
        c.walkElapsed = 0;
        c.key = targetKey(target);
        c.leaving = false;
      }
      c.target = target;
      c.session = target.session;
      c.project = target.project;
    });

    // Quien ya no tiene sitio sale por la puerta.
    Object.keys(characters).forEach(function (id) {
      var c = characters[id];
      if (targets[id] || c.leaving) return;
      c.leaving = true;
      c.target = null;
      c.path = planPath(c, doorPoint());
    });
  }

  // Al cargar o cambiar el tamaño, todos aparecen directamente en su sitio.
  function snapCharacters(targets) {
    Object.keys(characters).forEach(function (id) {
      if (!targets[id]) delete characters[id];
    });
    Object.keys(targets).forEach(function (id) {
      var target = targets[id];
      var c = characters[id];
      if (!c) return;
      c.x = target.x;
      c.y = target.y;
      c.aisle = target.aisle;
      c.path = [];
      c.dir = 'down';
      c.key = targetKey(target);
    });
  }

  function remainingDistance(c) {
    var total = 0;
    var x = c.x;
    var y = c.y;
    c.path.forEach(function (p) {
      total += Math.abs(p.x - x) + Math.abs(p.y - y);
      x = p.x;
      y = p.y;
    });
    return total;
  }

  function step(dt) {
    Object.keys(characters).forEach(function (id) {
      var c = characters[id];
      if (!c.path.length) {
        c.walkElapsed = 0;
      } else {
        // Arranca y frena con suavidad en lugar de ir siempre a la misma velocidad.
        c.walkElapsed = (c.walkElapsed || 0) + dt;
        var remaining = remainingDistance(c);
        var easeIn = Math.min(1, 0.4 + c.walkElapsed / 500);
        var easeOut = remaining < 16 ? Math.max(0.35, remaining / 16) : 1;
        var left = (WALK_SPEED * easeIn * easeOut * dt) / 1000;
      }
      while (c.path.length && left > 0) {
        var point = c.path[0];
        var dx = point.x - c.x;
        var dy = point.y - c.y;
        if (Math.abs(dx) + Math.abs(dy) <= left) {
          left -= Math.abs(dx) + Math.abs(dy);
          c.x = point.x;
          c.y = point.y;
          c.path.shift();
          continue;
        }
        // Primero en horizontal y luego en vertical, como en una rejilla.
        if (dx !== 0) {
          var mx = Math.min(Math.abs(dx), left);
          c.x += dx > 0 ? mx : -mx;
          left -= mx;
          c.dir = dx > 0 ? 'right' : 'left';
        } else {
          var my = Math.min(Math.abs(dy), left);
          c.y += dy > 0 ? my : -my;
          left -= my;
          c.dir = dy > 0 ? 'down' : 'up';
        }
      }
      if (!c.path.length) {
        if (c.leaving) {
          delete characters[id];
          return;
        }
        c.dir = 'down';
        if (c.target) c.aisle = c.target.aisle;
      }
    });
  }

  // Dibujo

  function rect(x, y, w, h, color) {
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(x), Math.round(y), w, h);
  }

  function text(value, x, y, color, maxWidth) {
    ctx.fillStyle = color;
    ctx.font = '8px Silkscreen, monospace';
    ctx.textBaseline = 'top';
    ctx.fillText(maxWidth ? fitText(value, maxWidth) : value, x, y);
  }

  function fitText(value, maxWidth) {
    if (ctx.measureText(value).width <= maxWidth) return value;
    var cut = value;
    while (cut.length > 1 && ctx.measureText(cut + '…').width > maxWidth) cut = cut.slice(0, -1);
    return cut + '…';
  }

  // Colores de suelos, paredes y alfombras, con el mismo modelo que pixel-agents
  // (h = tono, s = saturación, b = brillo, c = contraste sobre la luminancia del gris original).
  // Paleta coherente: suelo cálido, pared azul pizarra, alfombras en tonos joya apagados.
  var TINTS = {
    floor: { h: 32, s: 26, b: -10, c: -50 },
    loungeFloor: { h: 150, s: 14, b: -28, c: -55 },
    wall: { h: 222, s: 20, b: -32, c: -35 },
    carpet: { h: 200, s: 26, b: -32, c: -25 },
    carpetAccent: { h: 2, s: 48, b: -24, c: -20 },
    carpetSelected: { h: 200, s: 38, b: -14, c: -15 }
  };
  var tintCache = {};

  // Coloreado tipo "Colorize": luminancia del gris → color HSL fijo. Se guarda cada pieza ya pintada.
  function tinted(key, img, sx, sy, sw, sh, tint) {
    var cacheKey = key + ':' + sx + ':' + sy + ':' + tint.h + ':' + tint.s + ':' + tint.b + ':' + tint.c;
    if (tintCache[cacheKey]) return tintCache[cacheKey];
    var c = document.createElement('canvas');
    c.width = sw;
    c.height = sh;
    var g = c.getContext('2d');
    g.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
    var data = g.getImageData(0, 0, sw, sh);
    var px = data.data;
    for (var i = 0; i < px.length; i += 4) {
      if (px[i + 3] === 0) continue;
      var l = (0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]) / 255;
      l = 0.5 + (l - 0.5) * ((100 + tint.c) / 100);
      l = Math.max(0, Math.min(1, l + tint.b / 200));
      var rgb = hslToRgb(tint.h / 360, tint.s / 100, l);
      px[i] = rgb[0];
      px[i + 1] = rgb[1];
      px[i + 2] = rgb[2];
    }
    g.putImageData(data, 0, 0);
    tintCache[cacheKey] = c;
    return c;
  }

  function hslToRgb(h, s, l) {
    if (s === 0) return [l * 255, l * 255, l * 255];
    var q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    var p = 2 * l - q;
    function hue(t) {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    }
    return [hue(h + 1 / 3) * 255, hue(h) * 255, hue(h - 1 / 3) * 255];
  }

  function sprite(key, x, y) {
    var img = office[key];
    if (img) ctx.drawImage(img, Math.round(x), Math.round(y));
  }

  // Momento del día: de noche la oficina se oscurece un poco.
  function daylight() {
    var hour = new Date().getHours();
    if (hour >= 21 || hour < 7) return 'night';
    if (hour < 9 || hour >= 18) return 'dusk';
    return 'day';
  }

  // Suelo de baldosas y pared de pixel-agents, con cuadros, pizarra, reloj y plantas colgadas.
  function drawFloor() {
    rect(view.x, view.y, view.w, view.h, COLORS.background);
    if (office.floor) {
      var floor = tinted('floor', office.floor, 0, 0, TILE, TILE, TINTS.floor);
      var firstRow = Math.max(WALL_H, WALL_H + Math.floor((view.y - WALL_H) / TILE) * TILE);
      var lastRow = Math.min(layout.loungeTop, view.y + view.h);
      for (var y = firstRow; y < lastRow; y += TILE) {
        for (var x = 0; x < layout.w; x += TILE) ctx.drawImage(floor, x, y);
      }
    }
    if (view.y > WALL_H) return;
    // Pared: tramo horizontal del juego de piezas (máscara E+W = 10), de 16×32
    if (office.wall) {
      var wall = tinted('wall', office.wall, (10 % 4) * TILE, Math.floor(10 / 4) * 32, TILE, 32, TINTS.wall);
      for (var wx = 0; wx < layout.w; wx += TILE) ctx.drawImage(wall, wx, 0);
    }
    drawBrandPlaque();
    // Decoración de pared repartida a lo largo del muro
    var decor = ['largePainting', 'hangingPlant', 'whiteboard', 'smallPainting', 'clock', 'smallPainting2', 'hangingPlant', 'largePainting'];
    var start = logo ? 96 : 24;
    var summary = eveningSummary(new Date());
    for (var i = 0, dx = start; dx + 32 < layout.w; i++, dx += 72) {
      var key = decor[i % decor.length];
      var img = office[key];
      if (!img) continue;
      sprite(key, dx, key === 'clock' || key === 'hangingPlant' || key.indexOf('smallPainting') === 0 ? 0 : 2);
      if (key === 'whiteboard' && summary !== null) drawDaySummary(dx, summary);
    }
  }

  // Fin del día: desde las 20:00 y con nadie trabajando, cuántas sesiones se han movido hoy (null si no toca).
  function eveningSummary(now) {
    if (now.getHours() < EVENING_HOUR) return null;
    var midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    var count = 0;
    var busy = false;
    allStations.forEach(function (station) {
      station.project.sessions.forEach(function (s) {
        if (s.status === 'working') busy = true;
        if (s.lastActivity >= midnight) count++;
      });
    });
    return busy ? null : count;
  }

  // En la pizarra: un visto y el número, con las cifras pequeñas.
  function drawDaySummary(x, count) {
    // La parte blanca del sprite va de la fila 14 a la 22 del mundo (el sprite se pinta 2 px más abajo).
    rect(x + 6, 15, 20, 7, '#f2f0ea');
    rect(x + 8, 18, 1, 1, COLORS.working);
    rect(x + 9, 19, 1, 1, COLORS.working);
    rect(x + 10, 18, 1, 1, COLORS.working);
    rect(x + 11, 17, 1, 1, COLORS.working);
    rect(x + 12, 16, 1, 1, COLORS.working);
    tinyText(String(Math.min(count, 999)), x + 20, 16, COLORS.ink);
  }

  // Placa clara con el logotipo de la zona destacada en la pared (el logo va tal cual, sobre fondo claro).
  function drawBrandPlaque() {
    if (!logo || (stations !== allStations && !isAccent(floorZone))) return;
    var h = 14;
    var ratio = logo.naturalWidth && logo.naturalHeight ? logo.naturalWidth / logo.naturalHeight : 4;
    var w = Math.min(Math.round(h * ratio), 80);
    var x = MARGIN;
    rect(x - 3, 6, w + 6, h + 4, COLORS.wallLine);
    rect(x - 2, 7, w + 4, h + 2, COLORS.plaque);
    var smoothing = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(logo, x, 8, w, h);
    ctx.imageSmoothingEnabled = smoothing;
  }

  // Alfombra con bordes: cada baldosa elige su pieza según tenga vecinas al norte, este, sur u oeste.
  function drawCarpet(x, y, cols, rows, tint) {
    if (!office.carpet) return;
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        var mask = (r > 0 ? 1 : 0) | (c < cols - 1 ? 2 : 0) | (r < rows - 1 ? 4 : 0) | (c > 0 ? 8 : 0);
        var piece = tinted('carpet', office.carpet, (mask % 4) * TILE, Math.floor(mask / 4) * TILE, TILE, TILE, tint);
        ctx.drawImage(piece, x + c * TILE, y + r * TILE);
      }
    }
  }

  // Zona común: suelo distinto, estantería, dos sofás con mesa de café, mesita con cafetera, planta y puerta.
  function drawLounge() {
    var top = layout.loungeTop;
    if (office.loungeFloor) {
      var tile = tinted('loungeFloor', office.loungeFloor, 0, 0, TILE, TILE, TINTS.loungeFloor);
      for (var y = top; y < top + LOUNGE_H; y += TILE) {
        for (var x = 0; x < layout.w; x += TILE) ctx.drawImage(tile, x, y);
      }
    }
    rect(0, top, layout.w, 2, COLORS.wallLine);
    sprite('bookshelf', 8, top + 2);
    sprite('bookshelfSmall', 136, top + 6);
    sprite('smallTable', 152, top + 30);
    sprite('coffee', 160, top + 33);
    steam(166, top + 33);
    // Puerta
    var door = layout.door;
    rect(door.x - 10, top + LOUNGE_H - 32, 20, 30, COLORS.wallLine);
    rect(door.x - 8, top + LOUNGE_H - 30, 16, 28, COLORS.door);
    rect(door.x - 5, top + LOUNGE_H - 27, 10, 6, COLORS.skyDayHi);
    rect(door.x + 4, top + LOUNGE_H - 16, 2, 2, COLORS.yours);
    drawMailbox(top);
    drawReception();
    text('Zona común', 120, top + LOUNGE_H - 10, COLORS.textDim);
  }

  // Recepción junto a la puerta: un mostrador con lo que te espera haciendo cola delante. Solo en
  // oficinas anchas; en el móvil la zona común no tiene sitio y queda el botón «te esperan».
  function receptionBox() {
    if (!layout || layout.w < 360) return null;
    return { x: layout.door.x - 110, y: layout.loungeTop + LOUNGE_H - 44, w: 40, h: 30 };
  }

  function drawReception() {
    var box = receptionBox();
    if (!box) return;
    var queue = waitingQueue(allStations);
    // Rótulo con el número, en amarillo si hay alguien.
    rect(box.x + 1, box.y + 1, box.w, 9, 'rgba(0,0,0,0.35)');
    rect(box.x, box.y, box.w, 9, queue.length ? COLORS.yours : COLORS.plate);
    ctx.font = '6px Silkscreen, monospace';
    ctx.textBaseline = 'top';
    ctx.fillStyle = queue.length ? COLORS.ink : '#e2d3ca';
    var label = queue.length ? queue.length + ' esperan' : 'Recepción';
    if (queue.length === 1) label = '1 espera';
    ctx.fillText(label, Math.round(box.x + box.w / 2 - ctx.measureText(label).width / 2), box.y + 2);
    // Mostrador
    shadow(box.x + box.w / 2, box.y + box.h, box.w / 2 + 2, 3, 0.3);
    rect(box.x, box.y + 16, box.w, 14, '#8a5a32');
    rect(box.x, box.y + 14, box.w, 3, '#b98552');
    rect(box.x + 4, box.y + 20, box.w - 8, 1, 'rgba(0,0,0,0.25)');
    // Cola: hasta tres, mirando al mostrador; el primero, pegado a él.
    queue.slice(0, 3).forEach(function (item, i) {
      var look = lookFor(item.session.id, false);
      var px = box.x - 12 - i * 14;
      var dy = box.y + 2;
      ctx.drawImage(sheets.shadow, 0, 0, FRAME, FRAME, px - FRAME / 2, dy, FRAME, FRAME);
      ctx.drawImage(sheets.body, DIR_FRAMES.right * FRAME, look.skin * FRAME, FRAME, FRAME, px - FRAME / 2, dy, FRAME, FRAME);
      ctx.drawImage(sheets.outfits[look.outfit], DIR_FRAMES.right * FRAME, 0, FRAME, FRAME, px - FRAME / 2, dy, FRAME, FRAME);
      ctx.drawImage(sheets.hair, DIR_FRAMES.right * FRAME, look.hair * FRAME, FRAME, FRAME, px - FRAME / 2, dy, FRAME, FRAME);
    });
    if (queue.length > 3) text('+' + (queue.length - 3), box.x - 58, box.y + 14, COLORS.yours);
  }

  // Pasillo de salas sin uso: una puerta cerrada con su placa por proyecto.
  function drawClosedRooms() {
    var top = layout.closedTop;
    ctx.font = '6px Silkscreen, monospace';
    var label = 'Salas sin uso · ' + closedRooms.length;
    var labelW = Math.ceil(ctx.measureText(label).width) + 8;
    rect(MARGIN, top + 7, layout.w - MARGIN * 2, 1, COLORS.wallLine);
    rect(MARGIN, top + 3, labelW, 9, COLORS.wall);
    ctx.fillStyle = '#d8d2c8';
    ctx.textBaseline = 'top';
    ctx.fillText(label, MARGIN + 4, top + 5);
    closedRooms.forEach(function (station) {
      if (!station.folded && inView(station.y, station.y + DOOR_H)) drawDoor(station);
    });
    if (layout.closedToggle) drawClosedToggle(layout.closedToggle);
  }

  // «+N» con una pila de puertas pequeñas, o «Plegar» con el pasillo abierto.
  function drawClosedToggle(spot) {
    var w = DOOR_W - 6;
    var label = closedOpen ? 'Plegar' : '+' + layout.closedFolded;
    rect(spot.x + 1, spot.y + 2, w, 18, 'rgba(0,0,0,0.35)');
    rect(spot.x, spot.y, w, 18, '#606c7b');
    rect(spot.x + 1, spot.y + 1, w - 2, 16, COLORS.plate);
    ctx.font = '6px Silkscreen, monospace';
    ctx.fillStyle = '#efe2d2';
    ctx.textBaseline = 'top';
    ctx.fillText(label, Math.round(spot.x + w / 2 - ctx.measureText(label).width / 2), spot.y + 6);
    if (closedOpen) return;
    for (var i = 0; i < 3; i++) {
      var dx = Math.round(spot.x + w / 2 - 14 + i * 10);
      rect(dx, spot.y + 26 - i, 8, DOOR_H - 27 + i, COLORS.wallLine);
      rect(dx + 1, spot.y + 27 - i, 6, DOOR_H - 28 + i, COLORS.door);
    }
  }

  function drawDoor(station) {
    var x = station.x;
    var y = station.y;
    var w = DOOR_W - 6;
    var accent = isAccent(station.project.zone);
    var isSelected = selected.projectId === station.project.id;
    // Puerta debajo de la placa
    var dx = x + w / 2 - 9;
    shadow(x + w / 2, y + DOOR_H - 1, 11, 2, 0.3);
    rect(dx, y + 20, 18, DOOR_H - 21, COLORS.wallLine);
    rect(dx + 2, y + 22, 14, DOOR_H - 23, COLORS.door);
    rect(dx + 4, y + 25, 10, 5, 'rgba(0,0,0,0.22)');
    rect(dx + 11, y + 33, 2, 2, COLORS.textDim);
    // Placa con el nombre
    rect(x + 1, y + 2, w, 18, 'rgba(0,0,0,0.35)');
    rect(x, y, w, 18, isSelected ? COLORS.yours : accent ? COLORS.accentEdge : '#606c7b');
    rect(x + 1, y + 1, w - 2, 16, accent ? COLORS.accent : COLORS.plate);
    ctx.font = '6px Silkscreen, monospace';
    ctx.fillStyle = '#efe2d2';
    ctx.textBaseline = 'top';
    var lines = station.doorLines || [station.project.name];
    lines.forEach(function (line, i) {
      line = fitText(line, w - 4);
      var top = lines.length === 1 ? y + 6 : y + 2 + i * 7;
      ctx.fillText(line, Math.round(x + w / 2 - ctx.measureText(line).width / 2), top);
    });
  }

  // Buzón de la bandeja junto a la puerta: con notas pendientes, la bandera levantada y en amarillo.
  function mailboxPoint(top) {
    return { x: layout.door.x - 30, y: top + LOUNGE_H - 26 };
  }

  function drawMailbox(top) {
    var m = mailboxPoint(top);
    var pending = inboxCount() > 0;
    rect(m.x + 4, m.y + 8, 2, 12, COLORS.wallLine);
    rect(m.x, m.y + 1, 10, 8, COLORS.wallLine);
    rect(m.x + 1, m.y, 8, 8, pending ? '#c43f3c' : '#5b6274');
    rect(m.x + 2, m.y + 3, 6, 1, 'rgba(0, 0, 0, 0.35)');
    if (pending) {
      rect(m.x + 9, m.y - 4, 1, 6, COLORS.wallLine);
      rect(m.x + 10, m.y - 4, 3, 2, COLORS.yours);
    } else {
      rect(m.x + 9, m.y + 2, 4, 1, COLORS.wallLine);
    }
  }

  function inboxCount() {
    return (lastState && lastState.inboxOpen) || 0;
  }

  function hitMailbox(x, y) {
    if (!layout || !inboxHandler) return false;
    var m = mailboxPoint(layout.loungeTop);
    return x >= m.x - 4 && x <= m.x + 16 && y >= m.y - 6 && y <= m.y + 22;
  }

  // Sofás y mesa delante de quien se sienta; planta grande junto a la puerta.
  function drawLoungeFront() {
    var top = layout.loungeTop;
    shadow(48, top + 50, 17, 3, 0.3);
    shadow(96, top + 50, 17, 3, 0.3);
    shadow(72, top + 77, 17, 3, 0.25);
    sprite('sofa', 32, top + 34);
    sprite('sofa', 80, top + 34);
    sprite('coffeeTable', 56, top + 46);
    shadow(layout.w - MARGIN - 40, top + 78, 14, 3, 0.3);
    swaySprite('largePlant', layout.w - MARGIN - 56, top + 30, 3);
  }

  // Fondo del puesto: alfombra y letrero con el nombre del proyecto.
  function drawStationBack(station) {
    var x = station.x;
    var y = station.y;
    var accent = isAccent(station.project.zone);
    var isSelected = selected.projectId === station.project.id;
    drawCarpet(x, y, STATION_W / TILE, STATION_H / TILE, isSelected ? TINTS.carpetSelected : accent ? TINTS.carpetAccent : TINTS.carpet);

  }

  function drawStationSign(station) {
    var x = station.x;
    var y = station.y;
    var accent = isAccent(station.project.zone);
    var isSelected = selected.projectId === station.project.id;
    // Rótulo pintado en la misma rejilla que los muebles; nunca se acorta el nombre.
    var sx = x + 4;
    var sy = y + 3;
    var sw = STATION_W - 8;
    rect(sx + 2, sy + 3, sw, SIGN_HEIGHT, 'rgba(0,0,0,0.35)');
    rect(sx, sy, sw, SIGN_HEIGHT, isSelected ? COLORS.yours : accent ? COLORS.accentEdge : '#606c7b');
    rect(sx + 1, sy + 1, sw - 2, SIGN_HEIGHT - 2, accent ? COLORS.accent : COLORS.plate);
    rect(sx + 3, sy + 3, 1, 1, '#ebc5a0');
    rect(sx + sw - 4, sy + 3, 1, 1, '#ebc5a0');
    var lines = station.nameLines || [station.project.name];
    lines.forEach(function (line, i) {
      ctx.font = '8px Silkscreen, monospace';
      text(line, Math.round(x + STATION_W / 2 - ctx.measureText(line).width / 2), sy + 5 + i * 10, '#fff3db');
    });
    var counts = station.project.counts || {};
    var status = counts.working ? counts.working + ' trabajando' : counts.yours ? counts.yours + (counts.yours === 1 ? ' espera' : ' esperan') : 'En pausa';
    // Pasos del plan de la sesión que más urge: «3/7» en el rótulo y una barra en su borde de abajo.
    var focus = stationFocus(station.project.sessions);
    var steps = focus && focus.task && focus.task.current;
    if (steps && steps.total) status += ' · ' + steps.done + '/' + steps.total;
    ctx.font = '6px Silkscreen, monospace';
    ctx.fillStyle = counts.working ? '#b8f1bd' : counts.yours ? '#ffe7a1' : '#e2d3ca';
    ctx.textBaseline = 'top';
    ctx.fillText(status, Math.round(x + STATION_W / 2 - ctx.measureText(status).width / 2), sy + SIGN_HEIGHT - 9);
    if (steps && steps.total) {
      var barW = sw - 12;
      rect(sx + 6, sy + SIGN_HEIGHT - 2, barW, 2, 'rgba(0,0,0,0.45)');
      rect(sx + 6, sy + SIGN_HEIGHT - 2, Math.round(barW * Math.min(1, steps.done / steps.total)), 2, COLORS.working);
    }
  }

  // La sesión de un puesto que se enseña en el rótulo y el bocadillo: la que te espera (o pide
  // aprobación) antes que la que trabaja; si hay varias iguales, se turnan cada 4 s.
  function stationFocus(sessions, now) {
    var rank = function (s) {
      if (s.isHelper) return 0;
      if (s.status === 'yours' || (s.order && s.order.approvals && s.order.approvals.length)) return 2;
      return s.status === 'working' ? 1 : 0;
    };
    var top = 0;
    (sessions || []).forEach(function (s) { top = Math.max(top, rank(s)); });
    if (!top) return null;
    var list = sessions.filter(function (s) { return rank(s) === top; });
    return list[Math.floor((now === undefined ? clock : now) / 4000) % list.length];
  }

  // Bocadillo con la última acción («Ejecutando npm test») sobre quien más urge de cada puesto. Solo
  // cuando la oficina se ve lo bastante grande para leerlo (zoom de lectura desde 1,5).
  function drawActionBubbles(shown) {
    if (!layout || layout.cssScale < 1.5) return;
    shown.forEach(function (station) {
      // Entre las que tienen algo que contar: una que te espera sin texto no tapa a la que trabaja.
      var s = stationFocus(station.project.sessions.filter(function (session) { return session.task && session.task.lastAction; }));
      var label = s && s.task.lastAction;
      var c = s && characters[s.id];
      if (!label || !c || c.leaving || c.path.length) return;
      ctx.font = '6px Silkscreen, monospace';
      label = fitText(label, STATION_W + 24);
      var w = Math.ceil(ctx.measureText(label).width) + 8;
      var bx = Math.round(Math.max(2, Math.min(layout.w - w - 2, c.x - w / 2)));
      var by = Math.round(c.y - 58) + bobOffset();
      var fill = s.status === 'working' ? COLORS.bubble : COLORS.yours;
      rect(bx + 1, by + 1, w, 11, 'rgba(0,0,0,0.35)');
      rect(bx, by, w, 11, fill);
      rect(Math.round(c.x) - 1, by + 11, 3, 2, fill);
      rect(Math.round(c.x), by + 13, 1, 1, fill);
      ctx.fillStyle = COLORS.ink;
      ctx.textBaseline = 'top';
      ctx.fillText(label, bx + 4, by + 3);
    });
  }

  // Mesa con dos PC de cara a quien se sienta: la pantalla se anima si alguien trabaja en ese sitio.
  function drawStationDesk(station) {
    var x = station.x;
    var y = station.y;
    shadow(x + DESK_X + 24, y + DESK_Y + 31, 26, 4, 0.3);
    sprite('desk', x + DESK_X, y + DESK_Y);
    SEATS.forEach(function (seatX, i) {
      var key = station.seatTaken[i] ? ['pcOn1', 'pcOn2', 'pcOn3'][Math.floor(clock / 220 + i) % 3] : 'pcOff';
      sprite(key, x + seatX - 8, y + DESK_Y - 12);
    });
    drawDeskItems(station);
    if (station.extra > 0) text('+' + station.extra, x + STATION_W - 22, y + DESK_Y + 34, COLORS.text);
  }

  // Sillas delante de la mesa: se pintan después de quien se sienta para que el respaldo le tape las piernas.
  function drawStationChairs(station) {
    SEATS.forEach(function (seatX) {
      shadow(station.x + seatX, station.y + SEAT_FEET + 5, 7, 2, 0.25);
      sprite('chair', station.x + seatX - 8, station.y + SEAT_FEET - 10);
    });
    if (!station.active) rect(station.x, station.y, STATION_W, STATION_H, 'rgba(16,18,24,0.22)');
  }

  // Una planta o papelera junto a la mesa, siempre la misma para cada proyecto.
  function drawDeskItems(station) {
    var h = hash(station.project.id);
    var left = ['plant', 'plant2', 'cactus', 'bin'][h % 4];
    // (sombras y balanceo en el bucle de abajo)
    var right = ['bin', 'plant', 'plant2', 'cactus'][(h >>> 3) % 4];
    [[left, station.x + 4], [right, station.x + STATION_W - 20]].forEach(function (item, i) {
      var y = station.y + DESK_Y + (item[0] === 'bin' ? 16 : 0);
      shadow(item[1] + 8, y + 31, 6, 2, 0.25);
      if (item[0] === 'bin' || item[0] === 'cactus') sprite(item[0], item[1], y);
      else swaySprite(item[0], item[1], y, h + i);
    });
  }

  function drawPlant(x, y) {
    sprite('plant', x, y - 32);
  }

  // Luz ambiente: de noche la oficina se oscurece un poco.
  function drawAmbient() {
    if (daylight() === 'night') rect(0, WALL_H, layout.w, layout.h - WALL_H, COLORS.night);
  }

  function drawCharacter(c) {
    var moving = c.path.length > 0;
    var seated = !moving && c.target && c.target.pose === 'seat';
    // Sentado delante de su PC se le ve de espaldas
    var frame = moving ? DIR_FRAMES[c.dir] + Math.floor(clock / WALK_FRAME_MS) % 6 : seated ? DIR_FRAMES.up : 0;
    var bob = seated ? Math.floor(clock / 480 + (hash(c.id) % 2)) % 2 : 0;
    // En reposo, de pie o en el sofá, respira: sube un píxel de vez en cuando.
    var breath = !moving && !seated ? Math.floor((clock + (hash(c.id) % 900)) / 1100) % 2 : 0;
    var sx = frame * FRAME;
    var dx = Math.round(c.x - FRAME / 2);
    var dy = Math.round(c.y - FRAME + 2) + bob - breath;
    ctx.save();
    if (moving && c.dir === 'left') {
      // La hoja solo trae la derecha: se pinta en espejo sobre el eje del personaje.
      ctx.translate(dx * 2 + FRAME, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(sheets.shadow, 0, 0, FRAME, FRAME, dx, dy - bob, FRAME, FRAME);
    ctx.drawImage(sheets.body, sx, c.look.skin * FRAME, FRAME, FRAME, dx, dy, FRAME, FRAME);
    ctx.drawImage(sheets.outfits[c.look.outfit], sx, 0, FRAME, FRAME, dx, dy, FRAME, FRAME);
    ctx.drawImage(sheets.hair, sx, c.look.hair * FRAME, FRAME, FRAME, dx, dy, FRAME, FRAME);
    // Parpadeo: cada pocos segundos se tapan los ojos con el color de la piel durante un instante.
    if (frame === 0 && eyes[c.look.skin] && (clock + hash(c.id) % 3700) % 3900 < 130) {
      var e = eyes[c.look.skin];
      e.points.forEach(function (pt) { rect(dx + pt.x, dy + pt.y, 1, 1, e.skin); });
    }
    ctx.restore();

    if (!c.session) return;
    var s = c.session;
    var headY = c.y - 30;
    if (s.isHelper) {
      // Con la sesión que lo lanzó seleccionada, el ayudante enseña su tipo (Explore, Plan…).
      if (selected.sessionId === s.parentId) {
        ctx.font = '8px Silkscreen, monospace';
        var label = s.kind;
        var labelW = ctx.measureText(label).width;
        var labelX = Math.max(1, Math.min(layout.w - labelW - 1, Math.round(c.x - labelW / 2)));
        text(label, labelX, headY - 10, COLORS.worker);
      }
      if (!moving) drawTyping(c.x - 4, headY + 2);
      return;
    }
    if (s.role && !seated) drawRing(c.x, c.y, s.role === 'coordinator' ? COLORS.coordinator : COLORS.worker);
    if (s.role === 'coordinator') drawCoordinatorMark(c.x - 13, headY - 2);
    var resting = c.target && (c.target.pose === 'sofa' || c.target.pose === 'lounge');
    if (s.role === 'worker' && s.issue && !seated && !resting) tinyText('#' + s.issue, c.x, c.y + 3, COLORS.worker);
    if (selected.sessionId === s.id) drawSelection(c.x, headY - 14);
    if (c.celebrateAt && Date.now() - c.celebrateAt < CELEBRATE_MS && !reducedMotion()) drawSparkle(c.x, headY, Date.now() - c.celebrateAt);
    if (moving) return;
    if (s.status === 'working') {
      var activity = s.order && s.order.activity;
      if (isStuck(s, Date.now())) drawStuck(c.x + 3, headY - 8);
      else if (activity && ACTIVITY_ICONS[activity.kind]) drawIconBubble(c.x + 3, headY - 8, ACTIVITY_ICONS[activity.kind]);
      else drawTyping(c.x - 4, headY + 2);
    } else if (s.status === 'yours') {
      drawAlertBubble(c.x + 4, headY - 4);
    } else if (s.status === 'done') {
      drawDone(c.x + 4, headY);
    } else {
      drawSleep(c.x + 5, headY);
    }
    // Marca del agente a los pies; las sesiones del panel llevan una segunda marca blanca
    if (!seated) {
      rect(c.x - 8, c.y - 1, 3, 3, s.agent === 'claude' ? COLORS.claude : COLORS.codex);
      if (s.managed) rect(c.x - 4, c.y, 2, 2, COLORS.bubble);
    }
  }

  // Cifras de 3×5 para el número de issue, más pequeñas que cualquier fuente.
  var TINY_GLYPHS = {
    '#': ['.#.#.', '#####', '.#.#.', '#####', '.#.#.'],
    '0': ['###', '#.#', '#.#', '#.#', '###'], '1': ['.#.', '##.', '.#.', '.#.', '###'],
    '2': ['###', '..#', '###', '#..', '###'], '3': ['###', '..#', '.##', '..#', '###'],
    '4': ['#.#', '#.#', '###', '..#', '..#'], '5': ['###', '#..', '###', '..#', '###'],
    '6': ['###', '#..', '###', '#.#', '###'], '7': ['###', '..#', '.#.', '.#.', '.#.'],
    '8': ['###', '#.#', '###', '#.#', '###'], '9': ['###', '#.#', '###', '..#', '###']
  };

  // Texto centrado en `cx` con las cifras pequeñas.
  function tinyText(value, cx, y, color) {
    var width = 0;
    var glyphs = value.split('').map(function (ch) { return TINY_GLYPHS[ch]; }).filter(Boolean);
    glyphs.forEach(function (g) { width += g[0].length + 1; });
    var x = Math.round(cx - width / 2);
    glyphs.forEach(function (g) {
      for (var row = 0; row < g.length; row++) {
        for (var col = 0; col < g[row].length; col++) {
          if (g[row].charAt(col) === '#') rect(x + col, y + row, 1, 1, color);
        }
      }
      x += g[0].length + 1;
    });
  }

  // Anillo bajo los pies: azul para la coordinadora, cian para las sesiones de issue.
  function drawRing(x, y, color) {
    rect(x - 6, y - 1, 12, 1, color);
    rect(x - 7, y, 1, 1, color);
    rect(x + 6, y, 1, 1, color);
    rect(x - 6, y + 1, 12, 1, color);
  }

  // Portapapeles junto a la cabeza de la coordinadora.
  function drawCoordinatorMark(x, y) {
    rect(x, y, 6, 8, COLORS.coordinator);
    rect(x + 1, y + 1, 4, 6, COLORS.plaque);
    rect(x + 2, y - 1, 2, 2, COLORS.coordinator);
    rect(x + 2, y + 3, 2, 1, COLORS.ink);
    rect(x + 2, y + 5, 2, 1, COLORS.ink);
  }

  // Al seleccionar una coordinadora o una de sus sesiones, línea de puntos entre ellas.
  function drawLinks() {
    var selectedChar = selected.sessionId ? characters[selected.sessionId] : null;
    if (!selectedChar || !selectedChar.session) return;
    var s = selectedChar.session;
    var coordinatorId = s.role === 'coordinator' ? s.id : s.role === 'worker' ? s.parentId : null;
    var coordinator = coordinatorId ? characters[coordinatorId] : null;
    if (!coordinator || !coordinator.session) return;
    (coordinator.session.childIds || []).forEach(function (childId) {
      var child = characters[childId];
      if (!child || child.leaving) return;
      dottedLine(coordinator.x, coordinator.y - 14, child.x, child.y - 14, COLORS.coordinator);
    });
  }

  function dottedLine(x1, y1, x2, y2, color) {
    var length = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
    for (var i = 0; i <= length; i += 3) {
      var t = length ? i / length : 0;
      rect(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, 1, 1, color);
    }
  }

  function bobOffset() {
    return Math.floor(clock / 640) % 2 === 0 ? 0 : -1;
  }

  function drawAlertBubble(x, y) {
    var by = y + bobOffset();
    rect(x, by, 9, 9, COLORS.bubble);
    rect(x + 1, by - 1, 7, 1, COLORS.bubble);
    rect(x + 1, by + 9, 7, 1, COLORS.bubble);
    rect(x + 1, by + 10, 2, 2, COLORS.bubble);
    rect(x + 4, by + 1, 1, 5, COLORS.yours);
    rect(x + 4, by + 7, 1, 1, COLORS.yours);
  }

  function drawIconBubble(x, y, icon) {
    var by = y + bobOffset();
    rect(x, by, 11, 11, COLORS.bubble);
    rect(x + 1, by + 11, 2, 2, COLORS.bubble);
    for (var row = 0; row < icon.length; row++) {
      for (var col = 0; col < icon[row].length; col++) {
        if (icon[row].charAt(col) === '#') rect(x + 2 + col, by + 2 + row, 1, 1, COLORS.ink);
      }
    }
  }

  function drawTyping(x, y) {
    var current = Math.floor(clock / 160) % 4;
    for (var i = 0; i < 3; i++) rect(x + i * 3, y - (i === current ? 1 : 0), 2, 2, COLORS.working);
  }

  // Atascada: el turno sigue abierto pero hace 10 min que no escribe nada (ni en su registro ni en la orden).
  function isStuck(session, now) {
    if (session.status !== 'working') return false;
    var activity = session.order && session.order.activity;
    var last = Math.max(session.lastActivity || 0, activity && activity.at ? activity.at : 0);
    return Boolean(last) && now - last > STUCK_MS;
  }

  // Bocadillo rojo con «?» que parpadea.
  function drawStuck(x, y) {
    var by = y + bobOffset();
    var on = Math.floor(clock / 500) % 2 === 0;
    rect(x, by, 11, 11, on ? '#e0645c' : COLORS.bubble);
    rect(x + 1, by + 11, 2, 2, on ? '#e0645c' : COLORS.bubble);
    var ink = on ? COLORS.bubble : '#e0645c';
    rect(x + 3, by + 2, 5, 1, ink);
    rect(x + 7, by + 3, 1, 2, ink);
    rect(x + 5, by + 5, 2, 1, ink);
    rect(x + 5, by + 6, 1, 1, ink);
    rect(x + 5, by + 8, 1, 1, ink);
  }

  // Al terminar: chispas que suben y se abren durante un momento.
  function drawSparkle(x, y, elapsed) {
    var t = elapsed / CELEBRATE_MS;
    var rise = Math.round(t * 8);
    [[-8, 0], [8, 2], [-3, -6], [5, -8], [0, -12]].forEach(function (p, i) {
      if ((i + Math.floor(elapsed / 120)) % 3 === 0) return;
      var px = Math.round(x + p[0] * (0.6 + t));
      var py = Math.round(y + p[1] - rise);
      rect(px, py - 1, 1, 3, COLORS.yours);
      rect(px - 1, py, 3, 1, COLORS.yours);
    });
  }

  // Terminada: un visto verde sobre la cabeza.
  function drawDone(x, y) {
    rect(x, y + 2, 1, 1, COLORS.working);
    rect(x + 1, y + 3, 1, 1, COLORS.working);
    rect(x + 2, y + 2, 1, 1, COLORS.working);
    rect(x + 3, y + 1, 1, 1, COLORS.working);
    rect(x + 4, y, 1, 1, COLORS.working);
  }

  function drawSleep(x, y) {
    var by = y - (Math.floor(clock / 800) % 3);
    rect(x, by, 4, 1, COLORS.idle);
    rect(x + 2, by + 1, 1, 1, COLORS.idle);
    rect(x + 1, by + 2, 1, 1, COLORS.idle);
    rect(x, by + 3, 4, 1, COLORS.idle);
  }

  function drawSelection(x, y) {
    rect(x - 3, y, 7, 1, COLORS.bubble);
    rect(x - 2, y + 1, 5, 1, COLORS.bubble);
    rect(x - 1, y + 2, 3, 1, COLORS.bubble);
    rect(x, y + 3, 1, 1, COLORS.bubble);
  }

  // Parte del mundo que se ve, en unidades enteras y con un margen para que al arrastrar no asome
  // el borde antes de repintar. El canvas solo cubre esa parte: con 16 puestos en columna el mundo
  // entero pasaba de 10 000 px de alto y en el iPhone cada fotograma tardaba unos 300 ms.
  var VIEW_PAD = 48;

  function visibleRect() {
    var k = layout.cssScale;
    var left = stage.scrollLeft - world.offsetLeft - VIEW_PAD;
    var top = stage.scrollTop - world.offsetTop - VIEW_PAD;
    var x0 = Math.max(0, Math.floor(left / k));
    var y0 = Math.max(0, Math.floor(top / k));
    var x1 = Math.min(layout.w, Math.ceil((left + stage.clientWidth + VIEW_PAD * 2) / k));
    var y1 = Math.min(layout.h, Math.ceil((top + stage.clientHeight + VIEW_PAD * 2) / k));
    return { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
  }

  function inView(y0, y1) {
    return y1 >= view.y && y0 <= view.y + view.h;
  }

  function placeCanvas() {
    var next = visibleRect();
    var w = Math.ceil(next.w * scale);
    var h = Math.ceil(next.h * scale);
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    if (!view || view.x !== next.x || view.y !== next.y || view.w !== next.w || view.h !== next.h) {
      var k = layout.cssScale;
      canvas.style.width = next.w * k + 'px';
      canvas.style.height = next.h * k + 'px';
      canvas.style.transform = 'translate(' + next.x * k + 'px,' + next.y * k + 'px)';
    }
    view = next;
  }

  function draw() {
    if (!ctx || !sheets || !layout) return;
    placeCanvas();
    ctx.setTransform(scale, 0, 0, scale, -view.x * scale, -view.y * scale);
    ctx.imageSmoothingEnabled = false;
    drawFloor();
    drawWallShade();
    if (closedRooms.length && inView(layout.closedTop, layout.loungeTop)) drawClosedRooms();
    if (inView(layout.loungeTop, layout.h)) drawLounge();

    // Lista de pintado ordenada por la altura de los pies: lo de delante tapa a lo de detrás.
    var items = [];
    var shown = stations.filter(function (station) { return inView(station.y - 8, station.y + STATION_H + 8); });
    shown.forEach(function (station) {
      items.push({ y: station.y, draw: function () { drawStationBack(station); } });
      items.push({ y: station.y + DESK_Y + 30, draw: function () { drawStationDesk(station); } });
      items.push({ y: station.y + SEAT_FEET + 0.5, draw: function () { drawStationChairs(station); } });
    });
    if (inView(layout.loungeTop, layout.h)) items.push({ y: layout.loungeTop + 45, draw: drawLoungeFront });
    Object.keys(characters).forEach(function (id) {
      var c = characters[id];
      if (!inView(c.y - 48, c.y + 8)) return;
      items.push({ y: c.y, draw: function () { drawCharacter(c); } });
    });
    items.sort(function (a, b) { return a.y - b.y; });
    items.forEach(function (item) { item.draw(); });
    drawMotes();
    drawLighting();
    shown.forEach(drawStationSign);
    drawActionBubbles(shown);
    drawLinks();
    drawVignette();
    updateCard();
  }

  // ---- Luz, sombras y efectos

  function shadow(cx, cy, rx, ry, alpha) {
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,' + alpha + ')';
    ctx.translate(cx, cy);
    ctx.scale(1, ry / rx);
    ctx.beginPath();
    ctx.arc(0, 0, rx, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Planta que se mece: la parte de arriba se desplaza un píxel a un lado y al otro.
  function swaySprite(key, x, y, seed) {
    var img = office[key];
    if (!img) return;
    var split = Math.round(img.height * 0.55);
    var offset = Math.round(Math.sin(clock / 900 + seed) * 0.9);
    ctx.drawImage(img, 0, 0, img.width, split, Math.round(x) + offset, Math.round(y), img.width, split);
    ctx.drawImage(img, 0, split, img.width, img.height - split, Math.round(x), Math.round(y) + split, img.width, img.height - split);
  }

  // Vapor que sube de una taza.
  function steam(x, y) {
    for (var k = 0; k < 3; k++) {
      var phase = ((clock / 1400) + k / 3) % 1;
      ctx.globalAlpha = (1 - phase) * 0.55;
      rect(x + Math.round(Math.sin(phase * 6 + k) * 1.5), y - phase * 10, 1, 1, COLORS.bubble);
    }
    ctx.globalAlpha = 1;
  }

  // Motas de polvo flotando con la luz del día.
  function drawMotes() {
    if (daylight() === 'night') return;
    ctx.globalAlpha = 0.35;
    for (var i = 0; i < 18; i++) {
      var bx = hash('mx' + i) % layout.w;
      var by = WALL_H + hash('my' + i) % Math.max(1, layout.loungeTop - WALL_H);
      var t = clock / 1000;
      var x = bx + Math.sin(t * 0.4 + i) * 8;
      var y = by - ((t * 2 + i * 13) % 40);
      rect(x, y, 1, 1, '#f6e7b8');
    }
    ctx.globalAlpha = 1;
  }

  // Sombra que cae de la pared sobre el suelo y sobre la zona común.
  function drawWallShade() {
    var g = ctx.createLinearGradient(0, WALL_H, 0, WALL_H + 14);
    g.addColorStop(0, 'rgba(0,0,0,0.32)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, WALL_H, layout.w, 14);
    var l = ctx.createLinearGradient(0, layout.loungeTop, 0, layout.loungeTop + 10);
    l.addColorStop(0, 'rgba(0,0,0,0.25)');
    l.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = l;
    ctx.fillRect(0, layout.loungeTop, layout.w, 10);
  }

  // Capa de luz: oscuridad según la hora con huecos donde hay luz, y brillo de las pantallas encima.
  // En pantallas pequeñas (o con la oficina muy alejada) la noche no puede tapar los personajes.
  function darknessFor(light, cssScale, viewportWidth) {
    var darkness = light === 'night' ? 0.58 : light === 'dusk' ? 0.3 : 0.1;
    if (viewportWidth <= 760 || cssScale < 1.5) darkness = Math.min(darkness, 0.3);
    return darkness;
  }

  function drawLighting() {
    var darkness = darknessFor(daylight(), layout.cssScale, window.innerWidth);
    if (!lightCanvas) lightCanvas = document.createElement('canvas');
    if (lightCanvas.width !== layout.w || lightCanvas.height !== layout.h) {
      lightCanvas.width = layout.w;
      lightCanvas.height = layout.h;
    }
    var lg = lightCanvas.getContext('2d');
    lg.globalCompositeOperation = 'source-over';
    lg.clearRect(0, 0, layout.w, layout.h);
    lg.fillStyle = 'rgba(12,14,42,' + darkness + ')';
    lg.fillRect(0, 0, layout.w, layout.h);
    lg.globalCompositeOperation = 'destination-out';

    var glows = [];
    function hole(x, y, r, a) {
      if (!inView(y - r, y + r)) return;
      var g = lg.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(0,0,0,' + a + ')');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      lg.fillStyle = g;
      lg.fillRect(x - r, y - r, r * 2, r * 2);
    }
    stations.forEach(function (station) {
      if (station.active) hole(station.x + STATION_W / 2, station.y + STATION_H / 2, 64, 0.45);
      SEATS.forEach(function (seatX, i) {
        if (!station.seatTaken[i]) return;
        var gx = station.x + seatX;
        var gy = station.y + DESK_Y + 2;
        hole(gx, gy + 10, 40, 0.95);
        if (inView(gy - 22, gy + 22)) glows.push({ x: gx, y: gy, flicker: (Math.sin(clock / 180 + i * 2 + station.x) + 1) / 2 });
      });
    });
    var top = layout.loungeTop;
    hole(72, top + 40, 70, 0.75);
    hole(layout.door.x, top + LOUNGE_H - 20, 34, 0.7);

    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(lightCanvas, view.x, view.y, view.w, view.h, view.x, view.y, view.w, view.h);
    // Brillo de pantalla: luz aditiva verdosa que parpadea un poco
    ctx.globalCompositeOperation = 'lighter';
    glows.forEach(function (gw) {
      var r = 22;
      var g = ctx.createRadialGradient(gw.x, gw.y, 0, gw.x, gw.y, r);
      g.addColorStop(0, 'rgba(90,210,255,' + (0.22 + gw.flicker * 0.1) + ')');
      g.addColorStop(1, 'rgba(90,210,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(gw.x - r, gw.y - r, r * 2, r * 2);
    });
    ctx.restore();
  }

  function drawVignette() {
    var hw = view.w / 2;
    var hh = view.h / 2;
    var cx = view.x + hw;
    var cy = view.y + hh;
    var outer = Math.sqrt(hw * hw + hh * hh);
    var g = ctx.createRadialGradient(cx, cy, outer * 0.55, cx, cy, outer);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.38)');
    ctx.fillStyle = g;
    ctx.fillRect(view.x, view.y, view.w, view.h);
  }

  // Ojos de cada tono de piel, para el parpadeo: los píxeles más oscuros de la cara en el fotograma de frente.
  function findEyes() {
    try {
      var c = document.createElement('canvas');
      c.width = FRAME;
      c.height = FRAME * SKIN_ROWS;
      var g = c.getContext('2d');
      for (var row = 0; row < SKIN_ROWS; row++) g.drawImage(sheets.body, 0, row * FRAME, FRAME, FRAME, 0, row * FRAME, FRAME, FRAME);
      var data = g.getImageData(0, 0, FRAME, FRAME * SKIN_ROWS).data;
      for (var skin = 0; skin < SKIN_ROWS; skin++) {
        var points = [];
        var counts = {};
        for (var y = 6; y < 20; y++) {
          for (var x = 8; x < 24; x++) {
            var i = ((skin * FRAME + y) * FRAME + x) * 4;
            if (data[i + 3] < 200) continue;
            var luma = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
            if (luma < 70 && y >= 10) points.push({ x: x, y: y });
            if (luma > 140) {
              var key = data[i] + ',' + data[i + 1] + ',' + data[i + 2];
              counts[key] = (counts[key] || 0) + 1;
            }
          }
        }
        var best = null;
        Object.keys(counts).forEach(function (k) { if (!best || counts[k] > counts[best]) best = k; });
        if (points.length && points.length <= 8 && best) eyes[skin] = { points: points, skin: 'rgb(' + best + ')' };
      }
    } catch (e) {
      // Sin acceso a los píxeles: no hay parpadeo.
    }
  }

  // ---- Capas HTML: letreros, tarjeta y zoom

  var STATUS_TEXT = { working: 'Trabajando', yours: 'Te toca', done: 'Terminada', idle: 'En pausa' };

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function relTime(timestamp) {
    var minutes = Math.floor((Date.now() - timestamp) / 60000);
    if (minutes < 1) return 'ahora';
    if (minutes < 60) return 'hace ' + minutes + ' min';
    var hours = Math.floor(minutes / 60);
    if (hours < 24) return 'hace ' + hours + ' h';
    return 'hace ' + Math.floor(hours / 24) + ' d';
  }

  function toCss(v) {
    return v * layout.cssScale;
  }

  // Botones transparentes sobre los rótulos del canvas: acceso por teclado, tacto y lector de pantalla.
  function renderLabels() {
    if (!labelsLayer || !layout) return;
    var html = stations.map(function (station) {
      var p = station.project;
      var counts = p.counts || {};
      var status = (counts.working ? ', ' + counts.working + ' trabajando' : '') +
        (counts.yours ? ', ' + counts.yours + ' esperando' : '');
      return '<button type="button" data-project="' + escapeHtml(p.id) + '" title="' + escapeHtml(p.name) +
        '" aria-label="Ver sesiones de ' + escapeHtml(p.name + status) + '" class="station-hit" style="left:' +
        toCss(station.x + 4) + 'px;top:' + toCss(station.y + 3) + 'px;width:' + toCss(STATION_W - 8) +
        'px;height:' + toCss(SIGN_HEIGHT) + 'px"></button>';
    }).join('') + closedRooms.filter(function (station) { return !station.folded; }).map(function (station) {
      var p = station.project;
      return '<button type="button" data-project="' + escapeHtml(p.id) + '" title="' + escapeHtml(p.name) +
        '" aria-label="Ver sesiones de ' + escapeHtml(p.name) + ', sin uso" class="station-hit" style="left:' +
        toCss(station.x) + 'px;top:' + toCss(station.y) + 'px;width:' + toCss(DOOR_W - 6) +
        'px;height:' + toCss(DOOR_H) + 'px"></button>';
    }).join('');
    var reception = receptionBox();
    var waitingCount = waitingQueue(allStations).length;
    if (reception && waitingCount) {
      html += '<button type="button" data-reception class="station-hit" aria-label="Recepción: ' + waitingCount +
        (waitingCount === 1 ? ' sesión te espera' : ' sesiones te esperan') + '. Ir a la siguiente" style="left:' +
        toCss(reception.x - 50) + 'px;top:' + toCss(reception.y) + 'px;width:' + toCss(reception.w + 50) + 'px;height:' + toCss(reception.h) + 'px"></button>';
    }
    var toggle = layout.closedToggle;
    if (toggle) {
      html += '<button type="button" data-closed-toggle class="station-hit" aria-expanded="' + closedOpen + '" aria-label="' +
        (closedOpen ? 'Plegar las salas sin uso' : 'Ver las ' + layout.closedFolded + ' salas sin uso que faltan') + '" style="left:' +
        toCss(toggle.x) + 'px;top:' + toCss(toggle.y) + 'px;width:' + toCss(DOOR_W - 6) + 'px;height:' + toCss(DOOR_H) + 'px"></button>';
    }
    var count = inboxCount();
    if (count && inboxHandler) {
      var m = mailboxPoint(layout.loungeTop);
      html += '<button class="mailbox-chip" data-mailbox style="left:' + toCss(m.x + 5) + 'px;top:' + toCss(m.y - 12) + 'px" ' +
        'aria-label="Abrir la bandeja: ' + count + ' notas pendientes">' + count + '</button>';
    }
    if (labelsLayer.innerHTML !== html) labelsLayer.innerHTML = html;
    if (projectPicker) {
      var options = '<option value="">Ir a un proyecto…</option>' + allStations.map(function (station) {
        var p = station.project;
        var counts = p.counts || {};
        return '<option value="' + escapeHtml(p.id) + '">' + escapeHtml(p.name) +
          (counts.working ? ' · ' + counts.working + ' trabajando' : counts.yours ? ' · te espera' : '') + '</option>';
      }).join('');
      if (projectPicker.innerHTML !== options && document.activeElement !== projectPicker) projectPicker.innerHTML = options;
    }
    if (queueButton) {
      var waiting = waitingQueue(allStations).length;
      var queueKey = String(waiting);
      if (queueButton.getAttribute('data-count') !== queueKey) {
        queueButton.innerHTML = '<span class="queue-mark" aria-hidden="true">!</span>' + waiting +
          (waiting === 1 ? ' te espera' : ' te esperan') + '<span class="queue-step"> · siguiente</span>';
        queueButton.setAttribute('aria-label', waiting + (waiting === 1 ? ' sesión te espera' : ' sesiones te esperan') + '. Ir a la siguiente');
        queueButton.setAttribute('data-count', queueKey);
      }
      queueButton.hidden = !waiting;
    }
    if (overviewButton) {
      overviewButton.textContent = overview ? 'Vista de lectura' : 'Vista general';
      overviewButton.setAttribute('aria-pressed', String(overview));
    }
  }

  // Tarjeta flotante sobre el personaje señalado (ratón) o seleccionado.
  function updateCard() {
    if (!card || !layout) return;
    var id = hoverId || selected.sessionId;
    var c = id ? characters[id] : null;
    if (!c || !c.session || c.leaving) {
      card.hidden = true;
      card.removeAttribute('data-id');
      return;
    }
    var s = c.session;
    var cardKey = id + s.status + Boolean(s.waitingForTeam) + Boolean(s.completedForParent);
    if (card.getAttribute('data-id') !== cardKey) {
      var meta = s.isHelper
        ? 'Subagente · ' + escapeHtml(s.kind)
        : escapeHtml(c.project.name) + (s.branch ? ' · ' + escapeHtml(s.branch) : '');
      card.innerHTML = '<div class="card-title">' + escapeHtml(s.isHelper ? s.description || s.kind : s.title) + '</div>' +
        '<div class="card-meta">' + meta + '</div>' +
        '<div class="card-foot"><span class="card-status is-' + s.status + '">' + (s.waitingForTeam ? 'Coordinando trabajo en curso' : s.completedForParent ? 'Lista para la coordinadora' : STATUS_TEXT[s.status] || '') + '</span>' +
        (s.agent ? '<span class="card-agent is-' + s.agent + '">' + (s.agent === 'claude' ? 'Claude' : 'Codex') + '</span>' : '') +
        (s.lastActivity ? '<span class="card-time">' + relTime(s.lastActivity) + '</span>' : '') + '</div>';
      card.setAttribute('data-id', cardKey);
    }
    card.hidden = false;
    card.style.left = toCss(c.x) + 'px';
    // Si no cabe por encima del personaje dentro de la vista, va debajo.
    var above = toCss(c.y - 34) - stage.scrollTop > 72;
    card.style.top = toCss(above ? c.y - 34 : c.y + 4) + 'px';
    card.className = 'office-card' + (above ? '' : ' is-below');
  }

  // Dentro del dibujo gana el que está delante. Si no, el más cercano a menos de 22 px de
  // pantalla, para que se pueda acertar con el dedo aunque el personaje se vea pequeño.
  function hitCharacter(x, y) {
    var hit = null;
    var best = Infinity;
    var reach = Math.max(12, TOUCH_REACH / layout.cssScale);
    Object.keys(characters).forEach(function (id) {
      var c = characters[id];
      if (c.leaving || !c.session) return;
      var inside = x >= c.x - 9 && x <= c.x + 9 && y >= c.y - 28 && y <= c.y + 2;
      var dx = x - c.x;
      var dy = y - (c.y - 13);
      var distance = inside ? 0 : Math.sqrt(dx * dx + dy * dy);
      if (distance > reach) return;
      if (!hit || distance < best || (distance === best && c.y > hit.y)) {
        hit = c;
        best = distance;
      }
    });
    return hit;
  }

  // Píxeles de la ventana por unidad del mundo, contando la escala provisional del pellizco.
  function worldBox() {
    var box = world.getBoundingClientRect();
    return { left: box.left, top: box.top, k: layout.cssScale * (world.offsetWidth ? box.width / world.offsetWidth : 1) };
  }

  function eventToWorld(event) {
    var box = worldBox();
    return { x: (event.clientX - box.left) / box.k, y: (event.clientY - box.top) / box.k };
  }

  function handleHover(event) {
    if (!layout || (gesture && gesture.moved)) return;
    var p = eventToWorld(event);
    var hit = hitCharacter(p.x, p.y);
    hoverId = hit ? hit.id : null;
    canvas.style.cursor = hit ? 'pointer' : 'grab';
  }

  // ---- Cámara: zoom continuo, vuelos animados, gestos y encuadre con la ficha abierta

  function clampZoom(value) {
    return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, value));
  }

  function easeInOut(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  // Zoom al pellizcar: el de partida por cuánto se han separado los dedos, dentro de los límites.
  function pinchZoom(startZoom, startDistance, distance) {
    if (!startDistance) return startZoom;
    return clampZoom(startZoom * distance / startDistance);
  }

  // Velocidad del dedo al soltar (px/ms), con lo último que se movió; si se paró antes de soltar, ninguna.
  function releaseVelocity(samples, now) {
    var recent = samples.filter(function (s) { return now - s.t <= 100; });
    if (recent.length < 2) return { x: 0, y: 0 };
    var a = recent[0];
    var b = recent[recent.length - 1];
    var dt = Math.max(1, b.t - a.t);
    return { x: (b.x - a.x) / dt, y: (b.y - a.y) / dt };
  }

  // Sesiones que esperan algo de ti, en el orden de los puestos: las que te toca contestar
  // y las que tienen una aprobación pendiente.
  function waitingQueue(list) {
    var queue = [];
    list.forEach(function (station) {
      station.project.sessions.forEach(function (s) {
        var approvals = s.order && s.order.approvals ? s.order.approvals.length : 0;
        if (s.status === 'yours' || approvals) queue.push({ session: s, project: station.project });
      });
    });
    return queue;
  }

  // La siguiente de la cola después de la seleccionada; al llegar al final vuelve a empezar.
  function nextWaiting(queue, currentId) {
    if (!queue.length) return null;
    var index = -1;
    queue.forEach(function (item, i) { if (item.session.id === currentId) index = i; });
    return queue[(index + 1) % queue.length];
  }

  function reducedMotion() {
    return Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  // Lo que tapan la hoja inferior o el panel lateral (lo mide app.js). Ese mismo hueco se añade
  // al final del mundo para poder llevar cualquier puesto a la parte que se ve, sin recolocar la rejilla.
  function applyInsets() {
    if (!stage || !world) return;
    var cover = frameProvider ? frameProvider() : null;
    var next = { right: 0, bottom: 0 };
    if (cover && stage.clientWidth) {
      var box = stage.getBoundingClientRect();
      next.right = Math.round(Math.max(0, Math.min(box.width, box.right - (window.innerWidth - (cover.right || 0)))));
      next.bottom = Math.round(Math.max(0, Math.min(box.height, box.bottom - (window.innerHeight - (cover.bottom || 0)))));
    }
    insets = next;
    var right = next.right ? next.right + 'px' : '';
    var bottom = next.bottom ? next.bottom + 'px' : '';
    if (world.style.paddingRight !== right) world.style.paddingRight = right;
    if (world.style.paddingBottom !== bottom) world.style.paddingBottom = bottom;
  }

  // Centro de la parte del escenario que se ve, en píxeles de la vista. Arriba se descuenta
  // la cola «te esperan» cuando está, para que la tarjeta del personaje no quede debajo.
  function frameCenter() {
    var w = stage.clientWidth;
    var h = stage.clientHeight;
    var bottom = Math.max(h / 3, h - insets.bottom);
    var top = queueButton && !queueButton.hidden ? Math.min(56, bottom / 4) : 0;
    return { x: Math.max(w / 3, w - insets.right) / 2, y: (top + bottom) / 2 };
  }

  function viewPoint(clientX, clientY) {
    var box = stage.getBoundingClientRect();
    return { x: clientX - box.left, y: clientY - box.top };
  }

  function viewToWorld(vx, vy) {
    return {
      x: (stage.scrollLeft + vx - world.offsetLeft) / layout.cssScale,
      y: (stage.scrollTop + vy - world.offsetTop) / layout.cssScale
    };
  }

  // Desplaza el escenario para que el punto p del mundo quede en (vx, vy) de la vista.
  function placeWorld(p, vx, vy) {
    stage.scrollLeft = p.x * layout.cssScale + world.offsetLeft - vx;
    stage.scrollTop = p.y * layout.cssScale + world.offsetTop - vy;
  }

  // Dónde puede quedar de verdad la cámara con ese zoom: junto a los bordes no se puede centrar.
  function reachable(p, z, vx, vy) {
    var s = layout.fitScale * z;
    var contentW = Math.floor(layout.w * s) + insets.right;
    var contentH = Math.floor(layout.h * s) + insets.bottom;
    var viewW = stage.clientWidth;
    var viewH = Math.min(Math.floor(layout.h * s), layout.availableH);
    var offsetX = Math.max(0, (viewW - contentW) / 2);
    var left = Math.max(0, Math.min(contentW - viewW, p.x * s + offsetX - vx));
    var top = Math.max(0, Math.min(contentH - viewH, p.y * s - vy));
    return { x: (left + vx - offsetX) / s, y: (top + vy) / s };
  }

  // Escala provisional con CSS: se estira el último fotograma y el punto p del mundo queda en
  // (vx, vy). Se repinta a la escala buena al soltar (commitPreview), que es lo que cuesta.
  function showPreview(z, p, vx, vy) {
    var s = layout.fitScale * z;
    var k = s / layout.cssScale;
    var tx = stage.scrollLeft + vx - world.offsetLeft - p.x * s;
    var ty = stage.scrollTop + vy - world.offsetTop - p.y * s;
    world.style.transformOrigin = '0 0';
    world.style.transform = 'translate(' + tx.toFixed(2) + 'px,' + ty.toFixed(2) + 'px) scale(' + k.toFixed(4) + ')';
    preview = { zoom: z, p: p, vx: vx, vy: vy };
  }

  function commitPreview() {
    if (!preview) return;
    var pv = preview;
    preview = null;
    window.clearTimeout(wheelTimer);
    world.style.transform = '';
    applyZoom(pv.zoom, pv.p, pv.vx, pv.vy);
  }

  // Zoom definitivo: se repinta a la nueva escala y el punto p queda en (vx, vy).
  function applyZoom(z, p, vx, vy) {
    zoom = clampZoom(z);
    if (resize()) {
      var targets = assignTargets(Date.now());
      syncCharacters(targets);
      snapCharacters(targets);
    }
    placeWorld(p, vx, vy);
    draw();
  }

  function stopCamera() {
    if (!camera) return;
    window.cancelAnimationFrame(camera.raf);
    window.clearTimeout(camera.timer);
    if (camera.kind === 'flip') {
      world.style.transform = '';
      world.style.opacity = '';
    }
    camera = null;
    commitPreview();
  }

  // Animación de cámara con requestAnimationFrame (t de 0 a 1). Si el navegador deja de dar
  // fotogramas (pestaña oculta), un temporizador la termina igualmente.
  function animate(kind, duration, onFrame, onEnd) {
    var started = null;
    var current = camera = { kind: kind, raf: 0, timer: 0 };
    function finish() {
      if (camera !== current) return;
      window.cancelAnimationFrame(current.raf);
      window.clearTimeout(current.timer);
      camera = null;
      onEnd();
    }
    function tick(now) {
      if (camera !== current) return;
      if (started === null) started = now;
      var t = (now - started) / duration;
      if (t >= 1) {
        finish();
        return;
      }
      onFrame(t);
      current.raf = window.requestAnimationFrame(tick);
    }
    current.raf = window.requestAnimationFrame(tick);
    current.timer = window.setTimeout(finish, duration + 200);
  }

  // Vuelo de cámara: lleva el punto (x, y) del mundo al centro de la parte visible, con el zoom
  // pedido (o el actual) y en `duration` ms (el paseo del modo ambiente va despacio).
  // Con «reducir movimiento», salto directo.
  function flyTo(x, y, nextZoom, duration) {
    if (!layout || !stage.clientWidth) return;
    stopCamera();
    commitPreview();
    var z = clampZoom(nextZoom === undefined ? zoom : nextZoom);
    var center = frameCenter();
    var to = reachable({ x: x, y: y }, z, center.x, center.y);
    var startZoom = zoom;
    if (reducedMotion()) {
      if (z !== startZoom) applyZoom(z, to, center.x, center.y);
      else placeWorld(to, center.x, center.y);
      return;
    }
    var from = viewToWorld(center.x, center.y);
    animate('fly', duration || FLY_MS, function (t) {
      var e = easeInOut(t);
      var p = { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e };
      if (z !== startZoom) showPreview(startZoom + (z - startZoom) * e, p, center.x, center.y);
      else placeWorld(p, center.x, center.y);
    }, function () {
      preview = null;
      world.style.transform = '';
      if (z !== startZoom) applyZoom(z, to, center.x, center.y);
      else placeWorld(to, center.x, center.y);
    });
  }

  // Inercia al soltar un arrastre: sigue con la velocidad del dedo y se frena poco a poco.
  function glide(velocity) {
    var vx = velocity.x;
    var vy = velocity.y;
    if (reducedMotion() || Math.abs(vx) + Math.abs(vy) < 0.05) return;
    var x = stage.scrollLeft;
    var y = stage.scrollTop;
    var last = null;
    camera = { kind: 'glide', raf: 0 };
    function tick(now) {
      var dt = last === null ? 16 : Math.min(48, now - last);
      last = now;
      var beforeX = stage.scrollLeft;
      var beforeY = stage.scrollTop;
      x -= vx * dt;
      y -= vy * dt;
      stage.scrollLeft = x;
      stage.scrollTop = y;
      // Contra un borde se frena en seco en ese eje.
      if (stage.scrollLeft === beforeX) { vx = 0; x = beforeX; }
      if (stage.scrollTop === beforeY) { vy = 0; y = beforeY; }
      var decay = Math.pow(0.94, dt / 16);
      vx *= decay;
      vy *= decay;
      if (Math.abs(vx) + Math.abs(vy) < 0.02) {
        camera = null;
        return;
      }
      camera.raf = window.requestAnimationFrame(tick);
    }
    camera.raf = window.requestAnimationFrame(tick);
  }

  function stationOf(projectId) {
    var found = null;
    allStations.forEach(function (station) { if (station.project.id === projectId) found = station; });
    return found;
  }

  // Encuadra un puesto; `readable` acerca lo justo para leerlo si la oficina está muy alejada.
  function focusStation(station, readable) {
    if (!station) return;
    if (station.folded) {
      closedOpen = true;
      relayoutRooms();
    }
    var z = readable ? Math.max(zoom, clampZoom(1.5 / layout.fitScale)) : zoom;
    if (station.closed) flyTo(station.x + (DOOR_W - 6) / 2, station.y + DOOR_H / 2, z);
    else flyTo(station.x + STATION_W / 2, station.y + STATION_H / 2, z);
  }

  function focusSession(sessionId, projectId) {
    var c = characters[sessionId];
    if (c && !c.leaving) {
      var spot = c.target || c;
      flyTo(spot.x, spot.y - 14);
      return;
    }
    focusStation(stationOf(projectId));
  }

  function focusSelection() {
    if (!layout) return;
    if (selected.sessionId) focusSession(selected.sessionId, selected.projectId);
    else if (selected.projectId) focusStation(stationOf(selected.projectId));
  }

  // Avisa a app.js y recalcula lo que tapa la ficha que se abre o se cierra.
  function emitSelect(value) {
    onSelect(value);
    applyInsets();
  }

  // Recorre una a una las sesiones que te esperan.
  function nextInQueue() {
    var item = nextWaiting(waitingQueue(allStations), selected.sessionId);
    if (!item) return;
    showFloorOf(item.project.id);
    selected = { sessionId: item.session.id, projectId: item.project.id };
    emitSelect({ session: item.session, project: item.project });
    renderLabels();
    draw();
    focusSession(item.session.id, item.project.id);
  }

  // ---- Plantas por zona (móvil en vertical)

  // Recoloca la planta actual: cada planta tiene su rejilla, su zona común y su puerta.
  function relayoutFloor() {
    stopCamera();
    commitPreview();
    closeMenu();
    applyFloor();
    resize();
    // Sin la oficina a la vista (se elige desde Misiones) no hay medidas: se recoloca al volver a ella.
    if (!layout) return;
    var targets = assignTargets(Date.now());
    syncCharacters(targets);
    snapCharacters(targets);
    stage.scrollTop = 0;
    stage.scrollLeft = 0;
    renderLabels();
    draw();
  }

  // El pasillo de salas sin uso cambia de alto: se recoloca sin mover la cámara.
  function relayoutRooms() {
    resize();
    if (!layout) return;
    var targets = assignTargets(Date.now());
    syncCharacters(targets);
    snapCharacters(targets);
    renderLabels();
    draw();
  }

  // Cambia de planta; la nueva entra deslizándose desde el lado hacia el que se va.
  function goToFloor(zone, direction) {
    if (!floorMode() || zone === floorZone) return;
    floorZone = zone;
    relayoutFloor();
    if (reducedMotion() || !direction || !stage.clientWidth) return;
    var distance = stage.clientWidth * 0.6 * direction;
    world.style.transformOrigin = '0 0';
    animate('flip', 260, function (t) {
      var e = 1 - easeInOut(t);
      world.style.transform = 'translateX(' + (distance * e).toFixed(1) + 'px)';
      world.style.opacity = String(1 - 0.6 * e);
    }, function () {
      world.style.transform = '';
      world.style.opacity = '';
    });
  }

  function stepFloor(direction) {
    var index = -1;
    floors.forEach(function (f, i) { if (f.zone === floorZone) index = i; });
    var next = floors[index + direction];
    if (next) goToFloor(next.zone, direction);
  }

  // Elegir un proyecto de otra planta (selector, cola, atrás del sistema) lleva a la suya.
  function showFloorOf(projectId) {
    if (!floorMode()) return;
    var station = stationOf(projectId);
    if (!station || zoneOf(station.project) === floorZone) return;
    var from = -1;
    var to = -1;
    floors.forEach(function (f, i) {
      if (f.zone === floorZone) from = i;
      if (f.zone === zoneOf(station.project)) to = i;
    });
    goToFloor(zoneOf(station.project), to > from ? 1 : -1);
  }

  function renderFloorNav() {
    if (!floorNav) return;
    var show = floorMode() && floors.length > 0;
    floorNav.hidden = !show;
    if (!show) return;
    var index = 0;
    floors.forEach(function (f, i) { if (f.zone === floorZone) index = i; });
    var key = floors.map(function (f) { return f.zone; }).join(',') + '|' + index;
    if (floorNav.getAttribute('data-key') === key) return;
    floorNav.setAttribute('data-key', key);
    var many = floors.length > 1;
    var title = FLOOR_TITLES[floorZone] || floorZone;
    floorNav.innerHTML = (many ? '<button type="button" data-floor="-1" aria-label="Planta anterior"' + (index ? '' : ' disabled') + '>‹</button>' : '') +
      '<span class="floor-name" aria-live="polite">' + escapeHtml(title) +
      '<span class="floor-dots" aria-hidden="true">' + floors.map(function (f, i) {
        return '<span class="floor-dot' + (i === index ? ' is-current' : '') + '"></span>';
      }).join('') + '</span></span>' +
      (many ? '<button type="button" data-floor="1" aria-label="Planta siguiente"' + (index < floors.length - 1 ? '' : ' disabled') + '>›</button>' : '');
    floorNav.setAttribute('aria-label', 'Planta ' + (index + 1) + ' de ' + floors.length + ': ' + title);
  }

  // ---- Menú circular: mantener pulsado (o clic derecho) sobre un personaje

  function cancelPress() {
    if (gesture && gesture.press) {
      window.clearTimeout(gesture.press);
      gesture.press = 0;
    }
  }

  function longPress(clientX, clientY) {
    if (!gesture || gesture.mode !== 'pan' || gesture.moved || !layout) return;
    gesture.press = 0;
    var p = eventToWorld({ clientX: clientX, clientY: clientY });
    var hit = hitCharacter(p.x, p.y);
    if (hit && hit.session.isHelper) hit = characters[hit.session.parentId] || null;
    if (!hit || !openMenu(hit)) return;
    gesture.mode = 'menu';
    lastTap = null;
    suppressUntil = Date.now() + 600;
  }

  function openMenu(c) {
    closeMenu();
    var actions = menuActions(c.session, Boolean(lastState && lastState.canOrder));
    if (!actions.length) return false;
    stopCamera();
    hoverId = null;
    var box = worldBox();
    var reach = MENU_RADIUS + 30;
    var cx = box.left + c.x * box.k;
    var cy = box.top + (c.y - 14) * box.k;
    cx = Math.max(reach + 4, Math.min(window.innerWidth - reach - 4, cx));
    cy = Math.max(reach + 4, Math.min(window.innerHeight - reach - 4, cy));
    var layer = document.createElement('div');
    layer.className = 'office-menu';
    layer.setAttribute('role', 'menu');
    layer.setAttribute('aria-label', 'Acciones de ' + (c.session.title || 'la sesión'));
    layer.innerHTML = '<span class="menu-center" style="left:' + cx + 'px;top:' + cy + 'px"></span>' +
      actions.map(function (id) {
        var angle = MENU_SLOTS[id] * Math.PI / 180;
        return '<button type="button" role="menuitem" class="menu-action is-' + id + '" data-menu-action="' + id + '" style="left:' +
          Math.round(cx + Math.cos(angle) * MENU_RADIUS) + 'px;top:' + Math.round(cy + Math.sin(angle) * MENU_RADIUS) + 'px">' +
          MENU_LABELS[id] + '</button>';
      }).join('');
    document.body.appendChild(layer);
    menu = { layer: layer, session: c.session, project: c.project, opened: Date.now() };
    layer.addEventListener('click', function (event) {
      if (!menu || Date.now() - menu.opened < 350) return;
      var button = event.target.closest ? event.target.closest('[data-menu-action]') : null;
      if (button) runMenuAction(button.getAttribute('data-menu-action'));
      else closeMenu();
    });
    layer.addEventListener('contextmenu', function (event) {
      event.preventDefault();
      closeMenu();
    });
    var first = layer.querySelector('button');
    if (first) first.focus({ preventScroll: true });
    return true;
  }

  function closeMenu() {
    if (!menu) return;
    var layer = menu.layer;
    menu = null;
    if (layer.parentNode) layer.parentNode.removeChild(layer);
  }

  // Abrir o preparar algo en la ficha: aprobar y parar nunca se hacen aquí, solo se dejan
  // preparados en la ficha para un segundo toque (las órdenes siempre pasan por confirmación).
  function runMenuAction(action) {
    var target = menu;
    closeMenu();
    if (!target) return;
    selected = { sessionId: target.session.id, projectId: target.project.id };
    emitSelect({ session: target.session, project: target.project });
    actionHandler(action, target.session.id);
    applyInsets();
    renderLabels();
    draw();
    focusSession(target.session.id, target.project.id);
  }

  // ---- Modo ambiente: la cámara pasea despacio entre los puestos con actividad

  function strollStep() {
    if (!stroll) return;
    var list = activeStations(stations);
    var index = -1;
    list.forEach(function (station, i) { if (station.project.id === stroll.id) index = i; });
    var station = list[(index + 1) % Math.max(1, list.length)];
    if (station && layout && stage.clientWidth) {
      stroll.id = station.project.id;
      flyTo(station.x + STATION_W / 2, station.y + STATION_H / 2, undefined, STROLL_MS);
    }
    stroll.timer = window.setTimeout(strollStep, STROLL_MS + STROLL_PAUSE_MS);
  }

  function startStroll() {
    if (stroll || reducedMotion()) return;
    stroll = { id: null, timer: 0 };
    stroll.timer = window.setTimeout(strollStep, 600);
  }

  function stopStroll() {
    if (!stroll) return;
    window.clearTimeout(stroll.timer);
    stroll = null;
    stopCamera();
  }

  // Zoom con los botones: alrededor del centro de lo que se ve.
  function setZoom(next) {
    if (!layout) return;
    var center = frameCenter();
    var p = viewToWorld(center.x, center.y);
    flyTo(p.x, p.y, next);
  }

  function stepZoom(direction) {
    var next = zoom;
    if (direction > 0) {
      for (var i = 0; i < ZOOM_LEVELS.length; i++) {
        if (ZOOM_LEVELS[i] > zoom + 0.01) { next = ZOOM_LEVELS[i]; break; }
      }
    } else {
      for (var j = ZOOM_LEVELS.length - 1; j >= 0; j--) {
        if (ZOOM_LEVELS[j] < zoom - 0.01) { next = ZOOM_LEVELS[j]; break; }
      }
    }
    setZoom(next);
  }

  // Vista general ↔ lectura: cambia la rejilla, así que se anima a partir del puesto que se
  // estaba mirando (o el seleccionado), que encoge o crece desde donde estaba.
  function toggleOverview() {
    stopCamera();
    commitPreview();
    var anchor = stationOf(selected.projectId);
    if (!anchor && layout && stage.clientWidth) {
      var center = frameCenter();
      var p = viewToWorld(center.x, center.y);
      var best = Infinity;
      stations.forEach(function (station) {
        var dx = station.x + STATION_W / 2 - p.x;
        var dy = station.y + STATION_H / 2 - p.y;
        if (dx * dx + dy * dy < best) { best = dx * dx + dy * dy; anchor = station; }
      });
    }
    var before = anchor ? {
      x: anchor.x * layout.cssScale + world.offsetLeft - stage.scrollLeft,
      y: anchor.y * layout.cssScale + world.offsetTop - stage.scrollTop,
      scale: layout.cssScale
    } : null;
    overview = !overview;
    zoom = 1;
    resize();
    var targets = assignTargets(Date.now());
    syncCharacters(targets);
    snapCharacters(targets);
    if (anchor) {
      var c = frameCenter();
      placeWorld(reachable({ x: anchor.x + STATION_W / 2, y: anchor.y + STATION_H / 2 }, zoom, c.x, c.y), c.x, c.y);
    } else {
      stage.scrollTop = 0;
      stage.scrollLeft = 0;
    }
    draw();
    if (!before || reducedMotion() || !stage.clientWidth) return;
    var k = before.scale / layout.cssScale;
    var tx = before.x - world.offsetLeft + stage.scrollLeft - anchor.x * before.scale;
    var ty = before.y - world.offsetTop + stage.scrollTop - anchor.y * before.scale;
    var paint = function (e) {
      world.style.transform = 'translate(' + (tx * e).toFixed(2) + 'px,' + (ty * e).toFixed(2) + 'px) scale(' + (1 + (k - 1) * e).toFixed(4) + ')';
    };
    world.style.transformOrigin = '0 0';
    paint(1);
    animate('flip', FLY_MS, function (t) { paint(1 - easeInOut(t)); }, function () { world.style.transform = ''; });
  }

  // Gestos con Pointer Events: un dedo (o el ratón) arrastra con inercia, dos pellizcan y
  // un toque sin moverse sigue siendo un clic. Dos toques seguidos acercan o vuelven.
  function pointerList() {
    return Object.keys(pointers).map(function (id) { return pointers[id]; });
  }

  function pinchState() {
    var list = pointerList();
    var a = list[0];
    var b = list[1];
    var mid = viewPoint((a.x + b.x) / 2, (a.y + b.y) / 2);
    var dx = a.x - b.x;
    var dy = a.y - b.y;
    return { mid: mid, distance: Math.sqrt(dx * dx + dy * dy) };
  }

  function onPointerDown(event) {
    if (!layout || (event.pointerType === 'mouse' && event.button !== 0)) return;
    closeMenu();
    pointers[event.pointerId] = { x: event.clientX, y: event.clientY };
    pointerCount = Object.keys(pointers).length;
    // Tocar mientras se desliza solo lo para; tocar durante un vuelo no cuenta como parar.
    var interrupted = Boolean(camera && camera.kind === 'glide');
    stopCamera();
    if (pointerCount === 1) {
      gesture = {
        mode: 'pan', x: event.clientX, y: event.clientY, left: stage.scrollLeft, top: stage.scrollTop,
        moved: false, interrupted: interrupted, type: event.pointerType,
        samples: [{ x: event.clientX, y: event.clientY, t: event.timeStamp }]
      };
      // Mantener pulsado sin moverse abre el menú del personaje.
      gesture.press = window.setTimeout(longPress, LONG_PRESS_MS, event.clientX, event.clientY);
    } else if (pointerCount === 2) {
      cancelPress();
      commitPreview();
      var pinch = pinchState();
      gesture = { mode: 'pinch', distance: Math.max(1, pinch.distance), zoom: zoom, p: viewToWorld(pinch.mid.x, pinch.mid.y) };
      lastTap = null;
    }
  }

  function onPointerMove(event) {
    var point = pointers[event.pointerId];
    if (!point) return;
    point.x = event.clientX;
    point.y = event.clientY;
    if (!gesture) return;
    if (gesture.mode === 'pinch') {
      if (pointerCount < 2) return;
      var pinch = pinchState();
      showPreview(pinchZoom(gesture.zoom, gesture.distance, pinch.distance), gesture.p, pinch.mid.x, pinch.mid.y);
      return;
    }
    if (gesture.mode !== 'pan') return;
    var dx = event.clientX - gesture.x;
    var dy = event.clientY - gesture.y;
    if (!gesture.moved && Math.abs(dx) + Math.abs(dy) > (gesture.type === 'mouse' ? 5 : 8)) {
      gesture.moved = true;
      hoverId = null;
      cancelPress();
    }
    if (!gesture.moved) return;
    stage.scrollLeft = gesture.left - dx;
    stage.scrollTop = gesture.top - dy;
    // En el móvil, lo que no se puede desplazar en horizontal mueve la planta como anticipo del cambio.
    if (floorMode() && floors.length > 1 && !preview) {
      var rest = gesture.left - dx - stage.scrollLeft;
      gesture.rubber = Math.abs(rest) > 2;
      world.style.transform = gesture.rubber ? 'translateX(' + (-rest * 0.35).toFixed(1) + 'px)' : '';
    }
    gesture.samples.push({ x: event.clientX, y: event.clientY, t: event.timeStamp });
    if (gesture.samples.length > 8) gesture.samples.shift();
  }

  function onPointerUp(event) {
    if (!pointers[event.pointerId]) return;
    delete pointers[event.pointerId];
    pointerCount = Object.keys(pointers).length;
    if (!gesture) return;
    cancelPress();
    if (gesture.mode === 'pinch') {
      if (pointerCount < 2) {
        commitPreview();
        suppressUntil = Date.now() + 400;
        // El dedo que queda no arrastra hasta que se levanten todos.
        gesture = pointerCount ? { mode: 'done' } : null;
      }
      return;
    }
    if (pointerCount) return;
    var g = gesture;
    gesture = null;
    if (g.rubber) world.style.transform = '';
    if (g.mode !== 'pan' || event.type === 'pointercancel') return;
    if (g.moved) {
      suppressUntil = Date.now() + 400;
      if (floorMode() && floors.length > 1) {
        var maxLeft = stage.scrollWidth - stage.clientWidth;
        var direction = swipeFloor(event.clientX - g.x, event.clientY - g.y, g.left <= 0, g.left >= maxLeft - 1);
        if (direction) {
          stepFloor(direction);
          return;
        }
      }
      glide(releaseVelocity(g.samples, event.timeStamp));
      return;
    }
    if (g.interrupted) {
      suppressUntil = Date.now() + 400;
      return;
    }
    handleTap(event);
  }

  // Doble toque (o doble clic): acerca al punto tocado o vuelve al zoom normal. El primer toque
  // ya ha hecho su clic; el segundo no lo hace para que no compita con el vuelo.
  function handleTap(event) {
    var now = Date.now();
    if (lastTap && now - lastTap.time < DOUBLE_TAP_MS &&
        Math.abs(event.clientX - lastTap.x) + Math.abs(event.clientY - lastTap.y) < 30) {
      var target = lastTap.world;
      lastTap = null;
      suppressUntil = now + 400;
      flyTo(target.x, target.y, zoom < 1.9 ? 2 : 1);
      return;
    }
    lastTap = { time: now, x: event.clientX, y: event.clientY, world: eventToWorld(event) };
  }

  // Ctrl o ⌘ + rueda (y el pellizco del trackpad): zoom continuo hacia el puntero.
  function handleWheel(event) {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    if (!layout) return;
    stopCamera();
    var view = viewPoint(event.clientX, event.clientY);
    var current = preview ? preview.zoom : zoom;
    var p = preview ? preview.p : viewToWorld(view.x, view.y);
    var delta = Math.max(-50, Math.min(50, event.deltaY));
    showPreview(clampZoom(current * Math.exp(-delta * 0.01)), p, view.x, view.y);
    window.clearTimeout(wheelTimer);
    wheelTimer = window.setTimeout(commitPreview, 160);
  }

  function suppressed() {
    if (Date.now() >= suppressUntil) return false;
    suppressUntil = 0;
    return true;
  }

  function setupStage() {
    world = document.createElement('div');
    world.className = 'office-world';
    canvas.parentNode.insertBefore(world, canvas);
    world.appendChild(canvas);
    labelsLayer = document.createElement('div');
    labelsLayer.className = 'office-labels';
    labelsLayer.addEventListener('click', function (event) {
      if (!event.target.closest || suppressed()) return;
      if (inboxHandler && event.target.closest('[data-mailbox]')) inboxHandler();
      if (event.target.closest('[data-reception]')) {
        nextInQueue();
        return;
      }
      if (event.target.closest('[data-closed-toggle]')) {
        closedOpen = !closedOpen;
        relayoutRooms();
        return;
      }
      var button = event.target.closest('[data-project]');
      if (!button) return;
      var station = stationOf(button.getAttribute('data-project'));
      if (!station) return;
      selected = { sessionId: null, projectId: station.project.id };
      emitSelect({ project: station.project });
      renderLabels();
      draw();
      focusStation(station, false);
    });
    world.appendChild(labelsLayer);
    card = document.createElement('div');
    card.className = 'office-card';
    card.hidden = true;
    world.appendChild(card);
    stage = world.parentNode;
    var toolbar = document.createElement('div');
    toolbar.className = 'office-toolbar';
    toolbar.innerHTML = '<label class="office-project-nav">Proyecto <select id="office-project-picker" aria-label="Ir a un proyecto"></select></label>' +
      '<button type="button" class="btn" id="office-overview" aria-pressed="false">Vista general</button>';
    stage.parentNode.insertBefore(toolbar, stage);
    projectPicker = toolbar.querySelector('select');
    overviewButton = toolbar.querySelector('button');
    overviewButton.addEventListener('click', toggleOverview);
    projectPicker.addEventListener('change', function () {
      var station = stationOf(projectPicker.value);
      if (!station) return;
      showFloorOf(station.project.id);
      selected = { sessionId: null, projectId: station.project.id };
      renderLabels();
      emitSelect({ project: station.project });
      draw();
      focusStation(station, true);
    });

    // Cola «te esperan»: flota arriba a la izquierda, por encima de la hoja inferior.
    var queue = document.createElement('div');
    queue.className = 'office-queue';
    queue.innerHTML = '<button type="button" class="queue-next" hidden></button>';
    stage.parentNode.insertBefore(queue, stage);
    queueButton = queue.querySelector('button');
    queueButton.addEventListener('click', nextInQueue);

    var controls = document.createElement('div');
    controls.className = 'office-zoom';
    controls.innerHTML = '<button type="button" data-zoom="-1" aria-label="Alejar">−</button>' +
      '<button type="button" data-zoom="0" aria-label="Ver toda la oficina">⤢</button>' +
      '<button type="button" data-zoom="1" aria-label="Acercar">+</button>';
    stage.parentNode.insertBefore(controls, stage.nextSibling);
    controls.addEventListener('click', function (event) {
      var value = event.target.getAttribute && event.target.getAttribute('data-zoom');
      if (value === null) return;
      if (value === '0') toggleOverview();
      else stepZoom(Number(value));
    });

    // Plantas del móvil: nombre de la zona, puntos y flechas, en la fila del zoom a la izquierda.
    floorNav = document.createElement('div');
    floorNav.className = 'office-floors';
    floorNav.setAttribute('role', 'group');
    floorNav.hidden = true;
    controls.insertBefore(floorNav, controls.firstChild);
    floorNav.addEventListener('click', function (event) {
      var button = event.target.closest ? event.target.closest('[data-floor]') : null;
      if (button && !button.disabled) stepFloor(Number(button.getAttribute('data-floor')));
    });

    // Clic derecho en escritorio: el mismo menú que mantener pulsado.
    stage.addEventListener('contextmenu', function (event) {
      if (!layout) return;
      var p = eventToWorld(event);
      var hit = hitCharacter(p.x, p.y);
      if (hit && hit.session.isHelper) hit = characters[hit.session.parentId] || null;
      if (!hit && !menu && !(gesture && gesture.mode === 'menu')) return;
      event.preventDefault();
      if (hit && !(gesture && gesture.mode === 'menu')) openMenu(hit);
    });
    // Escape cierra el menú antes de que llegue a la ficha (que también se cierra con Escape).
    window.addEventListener('keydown', function (event) {
      if (event.key !== 'Escape' || !menu) return;
      event.stopPropagation();
      closeMenu();
    }, true);
    window.addEventListener('resize', closeMenu);

    canvas.addEventListener('mousemove', handleHover);
    canvas.addEventListener('mouseleave', function () { hoverId = null; });
    stage.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    stage.addEventListener('wheel', handleWheel, { passive: false });
    // El canvas solo cubre lo que se ve: al desplazarse se repinta en el mismo fotograma.
    stage.addEventListener('scroll', function () { if (layout) draw(); }, { passive: true });
    // Safari: que el pellizco sobre la oficina no acerque la página entera.
    stage.addEventListener('gesturestart', function (event) { event.preventDefault(); });
  }

  // Interacción

  function handleClick(event) {
    if (!layout) return;
    if (suppressed()) return;
    var p = eventToWorld(event);
    var x = p.x;
    var y = p.y;
    if (hitMailbox(x, y)) {
      inboxHandler();
      return;
    }
    var hit = hitCharacter(x, y);
    if (hit && hit.session.isHelper) {
      window.Office.select(hit.session.parentId);
      return;
    }
    if (hit) {
      selected = { sessionId: hit.session.id, projectId: hit.project.id };
      emitSelect({ session: hit.session, project: hit.project });
      renderLabels();
      draw();
      focusSession(hit.session.id, hit.project.id);
      return;
    }

    var station = null;
    stations.forEach(function (s) {
      if (x >= s.x && x < s.x + STATION_W && y >= s.y && y < s.y + STATION_H) station = s;
    });
    selected = { sessionId: null, projectId: station ? station.project.id : null };
    emitSelect(station ? { project: station.project } : null);
    renderLabels();
    draw();
    if (station) focusStation(station, false);
  }

  function selectionFromState() {
    if (!selected.projectId && !selected.sessionId) return null;
    var result = null;
    allStations.forEach(function (station) {
      if (selected.sessionId) {
        station.project.sessions.forEach(function (s) {
          if (s.id === selected.sessionId) result = { session: s, project: station.project };
        });
      } else if (station.project.id === selected.projectId) {
        result = { project: station.project };
      }
    });
    return result;
  }

  window.Office = {
    mount: function (element, selectHandler) {
      canvas = element;
      ctx = canvas.getContext('2d');
      setupStage();
      onSelect = selectHandler || onSelect;
      canvas.addEventListener('click', handleClick);
      // Con la oficina escondida no hay medidas: se recoloca al volver a ella.
      window.addEventListener('resize', function () {
        if (lastState && stage.clientWidth) window.Office.update(lastState, true);
      });
      var fontsReady = document.fonts && document.fonts.load ? document.fonts.load('8px Silkscreen') : Promise.resolve();
      return Promise.all([loadSheets(), fontsReady.catch(function () {})]).then(function () {
        findEyes();
        draw();
      });
    },

    update: function (state, relayout) {
      lastState = state;
      applyZones(state);
      // Al pasar de toda la oficina a una planta (o cambiar de planta) los personajes aparecen en su sitio.
      var previousFloor = stations === allStations ? null : floorZone;
      allStations = buildStations(state);
      applyFloor();
      var layoutChanged = resize();
      if (!layout) return;
      var targets = assignTargets(Date.now());
      syncCharacters(targets);
      var currentFloor = stations === allStations ? null : floorZone;
      if (!initialized || layoutChanged || relayout || currentFloor !== previousFloor) snapCharacters(targets);
      initialized = true;

      var current = selectionFromState();
      if (!current && (selected.sessionId || selected.projectId)) selected = { sessionId: null, projectId: null };
      emitSelect(current);
      renderLabels();
      draw();
    },

    closeMenu: closeMenu,

    selectProject: function (projectId) {
      closeMenu();
      selected = { sessionId: null, projectId: projectId };
      var current = selectionFromState();
      if (!current) selected = { sessionId: null, projectId: null };
      else showFloorOf(projectId);
      emitSelect(current);
      renderLabels();
      draw();
      if (current) focusSelection();
    },

    select: function (sessionId) {
      closeMenu();
      selected = { sessionId: sessionId, projectId: null };
      var current = selectionFromState();
      if (current) {
        selected.projectId = current.project.id;
        showFloorOf(current.project.id);
      }
      emitSelect(current);
      draw();
      if (current) focusSelection();
    },

    // Qué tapa la oficina: app.js devuelve { right, bottom } en píxeles de la ventana, o null.
    onFrame: function (provider) {
      frameProvider = provider;
    },

    // La ficha cambió de altura: se recalcula el hueco y se vuelve a encuadrar lo seleccionado.
    reframe: function () {
      applyInsets();
      focusSelection();
    },

    start: function () {
      if (timer) return;
      var last = Date.now();
      timer = setInterval(function () {
        var now = Date.now();
        // Si el navegador frena los temporizadores (pestaña en segundo plano), se recupera el tiempo perdido.
        var dt = Math.min(now - last, 1000);
        last = now;
        clock += dt;
        step(dt);
        draw();
      }, STEP_MS);
    },

    stop: function () {
      clearInterval(timer);
      timer = null;
    },

    // Qué hacer al elegir Abrir, Contestar, Aprobar o Parar en el menú circular (ya con la sesión elegida).
    onAction: function (handler) {
      actionHandler = handler;
    },

    // Modo ambiente: la cámara pasea entre los puestos con actividad (nunca con «reducir movimiento»).
    ambient: function (on) {
      if (on) startStroll();
      else stopStroll();
    },

    // Destello del botón «te esperan» cuando aparece algo que te toca.
    flashQueue: function () {
      if (!queueButton) return;
      queueButton.classList.remove('is-flash');
      void queueButton.offsetWidth;
      queueButton.classList.add('is-flash');
      window.clearTimeout(queueButton.flashTimer);
      queueButton.flashTimer = window.setTimeout(function () { queueButton.classList.remove('is-flash'); }, 1600);
    },

    // Qué hacer al tocar el buzón (abrir la bandeja). Sin manejador, el buzón no cuenta.
    onInbox: function (handler) {
      inboxHandler = handler;
    },

    // El mismo personaje que tiene la sesión en la oficina, para otras vistas (Misiones). (x, y) es la
    // esquina de su fotograma de 32×32; `frame` 0 de frente, 6-11 andando a la derecha, 12 de espaldas.
    // Devuelve false mientras no hayan cargado los sprites.
    paintPerson: function (g, sessionId, x, y, frame, flip) {
      if (!sheets) return false;
      var look = lookFor(sessionId, false);
      var sx = (frame || 0) * FRAME;
      g.save();
      if (flip) {
        g.translate(x * 2 + FRAME, 0);
        g.scale(-1, 1);
      }
      g.drawImage(sheets.shadow, 0, 0, FRAME, FRAME, x, y, FRAME, FRAME);
      g.drawImage(sheets.body, sx, look.skin * FRAME, FRAME, FRAME, x, y, FRAME, FRAME);
      g.drawImage(sheets.outfits[look.outfit], sx, 0, FRAME, FRAME, x, y, FRAME, FRAME);
      g.drawImage(sheets.hair, sx, look.hair * FRAME, FRAME, FRAME, x, y, FRAME, FRAME);
      g.restore();
      return true;
    }
  };
})();
