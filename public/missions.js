// Vista Misiones: un kanban con aspecto de juego. Cada proyecto activo es un equipo (la sesión
// coordinadora y sus delegadas, o una sesión suelta) y se coloca en la sala del miembro que más
// urge. Los personajes son los de la oficina; cuando el equipo cambia de sala, camina hasta ella.
(function () {
  var K = 2;
  var WALL_H = 18;
  var SCENE_H = 40;
  var MEMBER_GAP = 22;
  var MAX_DRAWN = 5;
  var MAX_ROWS = 3;
  var WALK_MS = 1400;
  var DAY_MS = 24 * 60 * 60 * 1000;
  // `optional`: en el móvil la sala no aparece si está vacía.
  var ROOMS = [
    { key: 'wait', label: 'Te esperan', wall: '#4a3a1c', floor: ['#3a301c', '#342b19'] },
    { key: 'work', label: 'Trabajando', wall: '#26304a', floor: ['#262c3c', '#222838'] },
    { key: 'launch', label: 'Por lanzar', wall: '#3a2a20', floor: ['#30241c', '#2b2019'], optional: true },
    { key: 'review', label: 'Revisión', wall: '#2c2a44', floor: ['#26253a', '#222134'], optional: true },
    { key: 'done', label: 'Hechas', wall: '#24382a', floor: ['#203024', '#1c2b20'], optional: true },
    { key: 'rest', label: 'En pausa · hoy', wall: '#2a2d36', floor: ['#23262e', '#20232a'] }
  ];
  // En columnas se lee como el flujo de trabajo; apiladas, por lo que te toca antes.
  var COLUMN_ORDER = ['launch', 'work', 'wait', 'review', 'done', 'rest'];
  var COLUMNS_FROM = 1000;
  var NOTE_H = 34;
  var NOTES_EVERY_MS = 15000;
  var STATE_TEXT = { approval: 'Pide aprobación', yours: 'Te espera', working: 'Trabajando', idle: 'En pausa', done: 'Hecha' };
  var MIC_SAFE = /[&<>"]/g;
  var MIC_ICON = '<svg viewBox="0 0 8 8" aria-hidden="true"><rect x="3" y="0" width="2" height="5"/><rect x="2" y="1" width="1" height="3"/><rect x="5" y="1" width="1" height="3"/><rect x="1" y="3" width="1" height="2"/><rect x="6" y="3" width="1" height="2"/><rect x="2" y="5" width="4" height="1"/><rect x="3" y="6" width="2" height="1"/><rect x="2" y="7" width="4" height="1"/></svg>';
  var BOX_ICON = '<svg viewBox="0 0 8 8" aria-hidden="true"><rect x="0" y="1" width="8" height="2"/><rect x="1" y="3" width="1" height="4"/><rect x="6" y="3" width="1" height="4"/><rect x="1" y="7" width="6" height="1"/><rect x="3" y="4" width="2" height="1"/></svg>';
  var PEN_ICON = '<svg viewBox="0 0 8 8" aria-hidden="true"><rect x="6" y="0" width="2" height="2"/><rect x="5" y="1" width="2" height="2"/><rect x="4" y="2" width="2" height="2"/><rect x="3" y="3" width="2" height="2"/><rect x="2" y="4" width="2" height="2"/><rect x="1" y="5" width="2" height="2"/><rect x="0" y="7" width="2" height="1"/></svg>';

  var root = null;
  var canvas = null;
  var g = null;
  var overlay = null;
  var lastState = null;

  // Zona destacada de data/config.json (`accent`): sus equipos llevan placa roja, como en la oficina.
  function isAccentZone(zone) {
    var zones = (lastState && lastState.zones) || [];
    for (var i = 0; i < zones.length; i++) if (zones[i].id === zone) return Boolean(zones[i].accent);
    return false;
  }
  var teams = [];
  var layout = null;
  var slots = {};
  var walkers = {};
  var timer = null;
  var frame = 0;
  var handlers = { select: function () {}, talk: null, note: null, archive: null };
  // Equipo cuyo «Archivar» espera el segundo toque (se olvida a los 4 s).
  var confirmArchive = null;
  var confirmTimer = null;
  var notes = [];
  var notesAt = 0;

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(MIC_SAFE, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  // Estado de cada miembro con lo que urge: aprobación > te espera > trabajando > en pausa. Es el
  // mismo estado que cuenta el resto del panel: una coordinadora que espera a sus delegadas está
  // trabajando, no esperándote, y una delegada que acabó devuelve el control a su coordinadora.
  function memberState(s) {
    if (s.order && s.order.approvals && s.order.approvals.length) return 'approval';
    if (s.completedForParent) return 'done';
    if (s.status === 'yours') return 'yours';
    if (s.status === 'working') return 'working';
    if (s.status === 'done') return 'done';
    return 'idle';
  }

  var URGENCY = ['approval', 'yours', 'working', 'idle', 'done'];

  function teamState(members) {
    var best = URGENCY.length - 1;
    members.forEach(function (m) { best = Math.min(best, URGENCY.indexOf(memberState(m))); });
    return URGENCY[best];
  }

  function roomOf(state, link) {
    if (state === 'approval' || state === 'yours') return 'wait';
    if (state === 'working') return 'work';
    if (link && link.issues.length) return link.issues.every(function (i) { return i.closed; }) ? 'done' : 'review';
    // Terminó sin preguntarte nada: a «Hechas».
    if (state === 'done') return 'done';
    return 'rest';
  }

  // La nota de la Bandeja de la que salió un equipo: por la sesión que se lanzó desde ella o, si se
  // abrió a mano, por el número de issue en el mismo repo. Devuelve sus issues y tareas.
  function issueNumber(ref) {
    var m = /#(\d+)$/.exec(String(ref || ''));
    return m ? m[1] : null;
  }

  function linkNote(members, list) {
    var ids = members.map(function (m) { return m.id; });
    for (var i = 0; i < list.length; i++) {
      var note = list[i];
      var sent = note.sentTo || [];
      var issues = sent.filter(function (x) { return x.kind !== 'session'; });
      var bySession = sent.some(function (x) { return x.kind === 'session' && ids.indexOf(x.sessionId) >= 0; });
      var root = note.plan && note.plan.project;
      var byIssue = !bySession && root && issues.some(function (x) {
        var n = issueNumber(x.ref);
        return n && members.some(function (m) { return m.issue === n && m.cwd && m.cwd.indexOf(root) === 0; });
      });
      if (bySession || byIssue) return { note: note, issues: issues };
    }
    return null;
  }

  // Notas con plan y proyecto que aún no se han mandado a ninguna parte: van al tablón.
  function launchable(list) {
    return list.filter(function (note) {
      return note.status === 'open' && note.plan && note.plan.state === 'ready' && note.plan.project && !(note.sentTo || []).length;
    });
  }

  // Equipos: cada coordinadora con sus delegadas; las sesiones sueltas van solas. Solo entra lo que
  // se mueve (trabaja, espera o ha tenido actividad en las últimas 24 h).
  function buildTeams(state, now, list) {
    list = list || [];
    var byId = {};
    var projectOf = {};
    state.projects.forEach(function (project) {
      project.sessions.forEach(function (s) {
        byId[s.id] = s;
        projectOf[s.id] = project;
      });
    });
    var result = [];
    Object.keys(byId).forEach(function (id) {
      var s = byId[id];
      if (s.parentId && byId[s.parentId]) return;
      var children = (s.childIds || []).map(function (childId) { return byId[childId]; }).filter(Boolean);
      // Primero las delegadas que se mueven: aprobación, te espera, trabajando; luego por actividad.
      children.sort(function (a, b) {
        return URGENCY.indexOf(memberState(a)) - URGENCY.indexOf(memberState(b)) || b.lastActivity - a.lastActivity;
      });
      var members = [s].concat(children);
      var alive = members.some(function (m) {
        return m.status === 'working' || m.status === 'yours' || now - m.lastActivity < DAY_MS;
      });
      if (!alive) return;
      var project = projectOf[id];
      var status = teamState(members);
      var link = linkNote(members, list);
      result.push({
        id: id,
        lead: s,
        workers: members.slice(1),
        project: { id: project.id, name: project.name, zone: project.zone },
        status: status,
        link: link,
        room: roomOf(status, link),
        lastActivity: Math.max.apply(null, members.map(function (m) { return m.lastActivity || 0; }))
      });
    });
    result.sort(function (a, b) { return b.lastActivity - a.lastActivity; });
    return result;
  }

  // Alto de cada ficha en píxeles lógicos: se mide del HTML ya pintado (ver measureTickets).
  var ticketHeights = {};
  function ticketHeight(team) {
    return ticketHeights[team.id] || 46 + Math.min(team.workers.length, MAX_ROWS + 1) * 14;
  }

  // Dónde va cada sala y cada equipo, en píxeles lógicos (K píxeles de pantalla cada uno).
  function slotHeight(item) {
    return item.note ? NOTE_H + 6 : SCENE_H + ticketHeight(item) + 4;
  }

  function computeLayout(width, columns, list, pinned) {
    pinned = pinned || [];
    var rooms = [];
    if (columns) {
      var colW = Math.floor(width / COLUMN_ORDER.length);
      var maxH = 0;
      COLUMN_ORDER.forEach(function (key, i) {
        var room = ROOMS.filter(function (r) { return r.key === key; })[0];
        var r = { room: room, x: i * colW, y: 0, w: colW, slots: [] };
        var y = WALL_H;
        list.filter(function (t) { return t.room === key; }).forEach(function (item) {
          r.slots.push({ team: item, x: r.x, y: y, w: colW });
          y += slotHeight(item);
        });
        r.h = Math.max(y, WALL_H + 36) + 4;
        maxH = Math.max(maxH, r.h);
        rooms.push(r);
      });
      rooms.forEach(function (r) { r.h = maxH; });
      return { rooms: rooms, w: width, h: maxH };
    }
    var top = 0;
    ROOMS.forEach(function (room) {
      var items = list.filter(function (t) { return t.room === room.key; });
      if (room.optional && !items.length && pinned.indexOf(room.key) < 0) return;
      var r = { room: room, x: 0, y: top, w: width, slots: [] };
      var y = top + WALL_H;
      items.forEach(function (item) {
        r.slots.push({ team: item, x: 0, y: y, w: width });
        y += slotHeight(item);
      });
      r.h = (r.slots.length ? y - top : WALL_H + 30) + 4;
      top += r.h;
      rooms.push(r);
    });
    return { rooms: rooms, w: width, h: top };
  }

  // ---- Dibujo

  function rect(x, y, w, h, color) {
    g.fillStyle = color;
    g.fillRect(Math.round(x), Math.round(y), w, h);
  }

  function drawRoom(r) {
    var room = r.room;
    for (var ty = r.y + WALL_H; ty < r.y + r.h; ty += 8) {
      for (var tx = r.x; tx < r.x + r.w; tx += 8) {
        rect(tx, ty, 8, Math.min(8, r.y + r.h - ty), room.floor[((tx - r.x) / 8 + (ty - r.y) / 8) % 2 ? 1 : 0]);
      }
    }
    rect(r.x, r.y, r.w, WALL_H, room.wall);
    rect(r.x, r.y + WALL_H, r.w, 3, 'rgba(0,0,0,0.35)');
    rect(r.x, r.y, r.w, 1, '#0c0d11');
    rect(r.x + r.w - 1, r.y, 1, r.h, '#0c0d11');
  }

  // Parche con el emblema del agente en el pecho: asterisco de Claude, «>_» de Codex.
  var EMBLEMS = {
    claude: { bg: '#d9714a', fg: '#fff3db', pts: [[0, 0], [2, 0], [4, 0], [1, 1], [2, 1], [3, 1], [0, 2], [1, 2], [2, 2], [3, 2], [4, 2], [1, 3], [2, 3], [3, 3], [0, 4], [2, 4], [4, 4]] },
    codex: { bg: '#4f5bd5', fg: '#ffffff', pts: [[0, 0], [1, 1], [2, 2], [1, 3], [0, 4], [3, 4], [4, 4]] }
  };

  function drawEmblem(agent, x, y) {
    var e = EMBLEMS[agent];
    if (!e) return;
    rect(x - 1, y - 1, 7, 7, e.bg);
    e.pts.forEach(function (p) { rect(x + p[0], y + p[1], 1, 1, e.fg); });
  }

  function drawHeadIcon(state, x, y) {
    if (state === 'yours') {
      rect(x, y, 7, 9, '#f4f1e8');
      rect(x + 3, y + 2, 2, 4, '#d99a1e');
      rect(x + 3, y + 7, 2, 1, '#d99a1e');
    } else if (state === 'approval') {
      rect(x + 1, y - 3, 1, 3, '#f08a4b');
      rect(x + 6, y - 3, 1, 3, '#f08a4b');
      rect(x + 1, y - 4, 6, 1, '#f08a4b');
      rect(x, y, 8, 6, '#f08a4b');
      rect(x + 3, y + 2, 2, 2, '#2b2f3a');
    } else if (state === 'done') {
      rect(x + 1, y + 4, 2, 2, '#5fd38d');
      rect(x + 3, y + 6, 2, 2, '#5fd38d');
      rect(x + 5, y + 4, 2, 2, '#5fd38d');
      rect(x + 7, y + 2, 2, 2, '#5fd38d');
    } else if (state === 'idle' && frame % 3 === 0) {
      rect(x + 2, y + 2, 3, 1, '#c9c2b8');
      rect(x + 4, y + 3, 1, 1, '#c9c2b8');
      rect(x + 2, y + 4, 3, 1, '#c9c2b8');
    }
  }

  // Un equipo: alfombra, la coordinadora delante con su portapapeles y las delegadas detrás.
  function drawTeam(slot, at, walking) {
    var team = slot.team;
    var all = [team.lead].concat(team.workers);
    var members = all.slice(0, MAX_DRAWN);
    var gap = Math.min(MEMBER_GAP, Math.floor((slot.w - 40) / Math.max(1, members.length - 1 || 1)));
    var baseY = at.y + SCENE_H - 4;
    var accent = isAccentZone(team.project.zone);
    rect(at.x + 4, baseY - 4, Math.min(slot.w - 8, members.length * gap + 22), 6, accent ? 'rgba(196,63,60,0.3)' : 'rgba(120,130,150,0.2)');
    members.forEach(function (m, i) {
      var px = at.x + 2 + i * gap;
      var py = baseY - 32;
      var state = memberState(m);
      var pose = walking ? 6 + (frame % 6) : state === 'working' ? (frame % 2 ? 0 : 0) : 0;
      var bob = !walking && state === 'working' && frame % 2 ? 1 : 0;
      window.Office.paintPerson(g, m.id, px, py - bob, pose, false);
      drawEmblem(m.agent, px + 14, py + 20 - bob);
      if (i === 0 && team.workers.length) {
        rect(px + 23, py + 19, 5, 7, '#7d8cf0');
        rect(px + 24, py + 20, 3, 5, '#e8e2d2');
      }
      if (!walking) drawHeadIcon(state, px + 20, py + 2);
    });
    if (all.length > members.length) {
      g.font = '8px Silkscreen, monospace';
      g.textBaseline = 'top';
      g.fillStyle = '#c9c2b8';
      g.fillText('+' + (all.length - members.length), at.x + 6 + members.length * gap, baseY - 14);
    }
  }

  // Nota de la Bandeja clavada en el tablón: un papel con chincheta.
  function drawNote(slot) {
    var x = slot.x + 6;
    var y = slot.y + 3;
    var w = Math.min(slot.w - 12, 220);
    rect(x + 2, y + 2, w, NOTE_H - 4, 'rgba(0,0,0,0.3)');
    rect(x, y, w, NOTE_H - 4, '#ead9b0');
    rect(x, y + NOTE_H - 6, w, 2, '#d8c393');
    rect(x + Math.floor(w / 2) - 1, y - 1, 3, 3, '#c43f3c');
  }

  function draw() {
    if (!g || !layout) return;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.imageSmoothingEnabled = false;
    rect(0, 0, layout.w, layout.h, '#101218');
    layout.rooms.forEach(function (r) {
      drawRoom(r);
      r.slots.forEach(function (slot) {
        if (slot.team.note) drawNote(slot);
        else if (!walkers[slot.team.id]) drawTeam(slot, slot, false);
      });
    });
    var now = performance.now();
    Object.keys(walkers).forEach(function (id) {
      var w = walkers[id];
      var t = Math.min(1, (now - w.start) / WALK_MS);
      // Primero por el pasillo en vertical, luego en horizontal hasta su sitio.
      var p = t < 0.6
        ? { x: w.from.x, y: w.from.y + (w.to.y - w.from.y) * (t / 0.6) }
        : { x: w.from.x + (w.to.x - w.from.x) * ((t - 0.6) / 0.4), y: w.to.y };
      drawTeam(w.slot, p, true);
      if (t >= 1) {
        delete walkers[id];
        renderOverlay();
      }
    });
  }

  // ---- Fichas (HTML encima del canvas)

  function blocks(task, done) {
    var plan = task && task.plan ? task.plan : [];
    if (!plan.length) return '';
    return '<span class="mis-blocks" aria-label="' + plan.filter(function (s) { return s.status === 'completed'; }).length + ' de ' + plan.length + ' pasos">' +
      plan.map(function (step) {
        var cls = done || step.status === 'completed' ? 'd' : step.status === 'in_progress' ? 'n' : '';
        return '<i class="' + cls + '"></i>';
      }).join('') + '</span>';
  }

  function stepText(s) {
    var task = s.task || {};
    var current = task.current;
    if (current && current.text) return (current.done + '/' + current.total) + ' · ' + current.text;
    return task.lastAction || task.goal || '';
  }

  function ticketHtml(slot) {
    var team = slot.team;
    var lead = team.lead;
    var leadState = memberState(lead);
    var box = 'left:' + (slot.x + 4) * K + 'px;width:' + (slot.w - 8) * K + 'px;top:' + (slot.y + SCENE_H + 1) * K + 'px';
    return '<div class="mis-ticket" data-team="' + escapeHtml(team.id) + '" style="' + box + '">' + ticketBody(team, lead, leadState) + '</div>';
  }

  function ticketBody(team, lead, leadState) {
    var shown = team.workers.slice(0, MAX_ROWS);
    var hidden = team.workers.slice(MAX_ROWS);
    var rows = shown.map(function (w) {
      var state = memberState(w);
      return '<button type="button" class="mis-worker" data-select="' + escapeHtml(w.id) + '" aria-label="' + escapeHtml((w.issue ? '#' + w.issue + ' ' : '') + w.title + ': ' + STATE_TEXT[state]) + '">' +
        '<b>' + (w.issue ? '#' + escapeHtml(w.issue) : '·') + '</b>' + blocks(w.task, state === 'done') +
        '<em class="mis-' + state + '">' + STATE_TEXT[state] + '</em>' +
        (w.task && w.task.lastAction && state !== 'idle' && state !== 'done' ? '<span class="mis-now">' + escapeHtml(w.task.lastAction) + '</span>' : '') + '</button>';
    }).join('');
    if (hidden.length) {
      rows += '<button type="button" class="mis-worker mis-more" data-select="' + escapeHtml(lead.id) + '">y ' + hidden.length +
        (hidden.length === 1 ? ' delegada más' : ' delegadas más') + '</button>';
    }
    var now = lead.waitingForTeam && leadState === 'idle' ? 'Coordinando' : stepText(lead);
    if (team.link && team.link.issues.length) {
      rows += '<span class="mis-link">' + team.link.issues.map(function (i) {
        return escapeHtml(i.ref) + (i.closed ? ' cerrado' : ' abierto');
      }).join(' · ') + '</span>';
    }
    return '<button type="button" class="mis-lead" data-select="' + escapeHtml(lead.id) + '" aria-label="Abrir ' + escapeHtml(team.project.name + ': ' + lead.title) + '">' +
      '<span class="mis-plate' + (isAccentZone(team.project.zone) ? ' is-accent' : '') + '">' + escapeHtml(team.project.name) + '</span>' +
      '<span class="mis-title">' + escapeHtml(lead.title) + '</span>' +
      '<span class="mis-line">' + blocks(lead.task, false) + '<em class="mis-' + leadState + '">' + (lead.waitingForTeam && leadState === 'idle' ? 'Coordinando' : STATE_TEXT[leadState]) + '</em></span>' +
      '<span class="mis-now">' + escapeHtml(now) + '</span></button>' + actionsHtml(team, lead, leadState) + rows;
  }

  // Una sola barra bajo la coordinadora: Hablar y Escribir a la izquierda; Archivar, discreto, a la
  // derecha y lejos del pulgar. Al tocar Archivar la barra entera pasa a pedir confirmación.
  function actionsHtml(team, lead, leadState) {
    if (!lastState || !lastState.canOrder) return '';
    var ids = [lead.id].concat(team.workers.map(function (w) { return w.id; }));
    if (confirmArchive === team.id) {
      return '<span class="mis-actions is-confirm"><span class="mis-ask">¿Archivar ' + (ids.length > 1 ? 'el equipo' : 'la sesión') + '?</span>' +
        '<button type="button" class="mis-action" data-archive-cancel>No</button>' +
        '<button type="button" class="mis-action is-danger" data-archive="' + escapeHtml(team.id) + '" data-ids="' + escapeHtml(ids.join(' ')) + '">Sí, archivar</button></span>';
    }
    var html = '<span class="mis-actions">';
    if (handlers.talk && !lead.desktopApp) {
      var hot = team.status === 'yours' || team.status === 'approval';
      var whom = lead.role === 'coordinator' ? 'la coordinadora' : 'la sesión';
      html += '<button type="button" class="mis-action' + (hot ? ' is-hot' : '') + '" data-talk="' + escapeHtml(lead.id) + '" data-mode="mic" aria-label="Hablar con ' + whom + ' de ' + escapeHtml(team.project.name) + '">' + MIC_ICON + '<span>Hablar</span></button>' +
        '<button type="button" class="mis-action" data-talk="' + escapeHtml(lead.id) + '" data-mode="write" aria-label="Escribir a ' + whom + ' de ' + escapeHtml(team.project.name) + '">' + PEN_ICON + '<span>Escribir</span></button>';
    }
    if (handlers.talk && lead.desktopApp) {
      // A las sesiones de la app de Claude no se les escribe desde el panel: no lo verían en la app.
      html += lead.remoteUrl
        ? '<a class="mis-action" href="' + escapeHtml(lead.remoteUrl) + '" target="_blank" rel="noopener" aria-label="Seguir ' + escapeHtml(team.project.name) + ' con Remote Control">' + PEN_ICON + '<span>Remote Control</span></a>'
        : '<span class="mis-app-note">Háblale en la app de Claude o con Remote Control</span>';
    }
    if (handlers.archive && team.room !== 'work') {
      html += '<button type="button" class="mis-action is-quiet" data-archive="' + escapeHtml(team.id) + '" data-ids="' + escapeHtml(ids.join(' ')) +
        '" aria-label="Archivar ' + (ids.length > 1 ? 'el equipo' : 'la sesión') + '" title="Archivar">' + BOX_ICON + '</button>';
    }
    return html + '</span>';
  }

  function noteHtml(slot) {
    var note = slot.team.note;
    var w = Math.min(slot.w - 12, 220);
    return '<button type="button" class="mis-note" data-note="' + escapeHtml(note.id) + '" style="left:' + (slot.x + 9) * K + 'px;top:' + (slot.y + 5) * K +
      'px;width:' + (w - 6) * K + 'px;height:' + (NOTE_H - 9) * K + 'px" aria-label="Lanzar: ' + escapeHtml(note.plan.title) + '">' +
      '<b>' + escapeHtml(slot.team.projectName) + '</b>' + escapeHtml(note.plan.title) + '</button>';
  }

  // Mide las fichas con su ancho real antes de colocar las salas, para que nunca se pisen.
  function measureTickets(list, slotWidth) {
    var probe = document.createElement('div');
    probe.className = 'mis-measure';
    probe.innerHTML = list.map(function (team) {
      return '<div class="mis-ticket" data-team="' + escapeHtml(team.id) + '" style="width:' + (slotWidth - 8) * K + 'px">' +
        ticketBody(team, team.lead, memberState(team.lead)) + '</div>';
    }).join('');
    root.appendChild(probe);
    ticketHeights = {};
    Array.prototype.forEach.call(probe.children, function (el) {
      ticketHeights[el.getAttribute('data-team')] = Math.ceil(el.offsetHeight / K) + 2;
    });
    root.removeChild(probe);
  }

  function renderOverlay() {
    if (!overlay || !layout) return;
    var html = '';
    layout.rooms.forEach(function (r) {
      html += '<div class="mis-room-sign" style="left:' + (r.x + 4) * K + 'px;top:' + (r.y + 3) * K + 'px;max-width:' + (r.w - 8) * K + 'px">' +
        escapeHtml(r.room.label) + ' · ' + r.slots.length + '</div>';
      if (!r.slots.length) {
        html += '<div class="mis-empty" style="left:' + (r.x + 6) * K + 'px;top:' + (r.y + WALL_H + 8) * K + 'px">Nada por aquí</div>';
      }
      r.slots.forEach(function (slot) {
        if (slot.team.note) html += noteHtml(slot);
        else if (!walkers[slot.team.id]) html += ticketHtml(slot);
      });
    });
    if (overlay.innerHTML !== html) overlay.innerHTML = html;
  }

  // ---- Ciclo

  function relayout() {
    if (!root || !lastState) return;
    var cssW = root.clientWidth;
    if (!cssW) return;
    var width = Math.floor(cssW / K);
    var columns = cssW >= COLUMNS_FROM;
    teams = buildTeams(lastState, Date.now(), notes);
    measureTickets(teams, columns ? Math.floor(width / COLUMN_ORDER.length) : width);
    var projects = {};
    lastState.projects.forEach(function (p) { p.roots.forEach(function (root) { projects[root] = p.name; }); });
    var pinnedNotes = launchable(notes).map(function (note) {
      return { id: 'note:' + note.id, note: note, room: 'launch', projectName: projects[note.plan.project] || note.plan.project.split('/').pop() };
    });
    var next = computeLayout(width, columns, teams.concat(pinnedNotes));
    var nextSlots = {};
    next.rooms.forEach(function (r) { r.slots.forEach(function (slot) { if (!slot.team.note) nextSlots[slot.team.id] = slot; }); });
    // El equipo que cambia de sala camina desde donde estaba.
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    Object.keys(nextSlots).forEach(function (id) {
      var before = slots[id];
      var after = nextSlots[id];
      if (!reduce && before && !after.team.note && before.team.room !== after.team.room) {
        walkers[id] = { from: { x: before.x, y: before.y }, to: { x: after.x, y: after.y }, slot: after, start: performance.now() };
      }
    });
    slots = nextSlots;
    layout = next;
    canvas.width = layout.w;
    canvas.height = layout.h;
    canvas.style.width = layout.w * K + 'px';
    canvas.style.height = layout.h * K + 'px';
    g = canvas.getContext('2d');
    renderOverlay();
    draw();
  }

  // Las notas de la Bandeja (tablón, revisión y hechas) se piden cada 15 s mientras se ve la vista.
  function loadNotes(force) {
    if (!lastState || !lastState.canOrder || (!force && Date.now() - notesAt < NOTES_EVERY_MS)) return;
    notesAt = Date.now();
    fetch('/api/inbox', { cache: 'no-store' })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (body) {
        if (!body || !Array.isArray(body.notes)) return;
        notes = body.notes;
        if (timer) relayout();
      })
      .catch(function () {});
  }

  window.Missions = {
    // `select(sessionId)` abre la ficha de esa sesión; `talk(sessionId, 'mic' | 'write')` abre el
    // cuadro para hablarle; `note(noteId)` lleva a esa nota de la Bandeja.
    mount: function (element, options) {
      root = element;
      handlers.select = options.select || handlers.select;
      handlers.talk = options.talk || null;
      handlers.note = options.note || null;
      handlers.archive = options.archive || null;
      root.innerHTML = '<div class="mis-scene"><canvas class="mis-canvas"></canvas><div class="mis-overlay"></div></div>' +
        '<p class="mis-hint" hidden>No hay nada en marcha ahora mismo.</p>';
      canvas = root.querySelector('canvas');
      overlay = root.querySelector('.mis-overlay');
      overlay.addEventListener('click', function (event) {
        if (!event.target.closest) return;
        var talk = event.target.closest('[data-talk]');
        if (talk && handlers.talk) {
          handlers.talk(talk.getAttribute('data-talk'), talk.getAttribute('data-mode'));
          return;
        }
        var archive = event.target.closest('[data-archive]');
        if (archive && handlers.archive) {
          var teamId = archive.getAttribute('data-archive');
          clearTimeout(confirmTimer);
          if (confirmArchive === teamId && archive.classList.contains('is-danger')) {
            confirmArchive = null;
            handlers.archive(archive.getAttribute('data-ids').split(' '));
          } else {
            confirmArchive = teamId;
            confirmTimer = setTimeout(function () { confirmArchive = null; relayout(); }, 4000);
          }
          relayout();
          return;
        }
        if (event.target.closest('[data-archive-cancel]')) {
          clearTimeout(confirmTimer);
          confirmArchive = null;
          relayout();
          return;
        }
        var note = event.target.closest('[data-note]');
        if (note && handlers.note) {
          handlers.note(note.getAttribute('data-note'));
          return;
        }
        var button = event.target.closest('[data-select]');
        if (button) handlers.select(button.getAttribute('data-select'));
      });
      window.addEventListener('resize', function () { if (timer) relayout(); });
    },

    update: function (state) {
      lastState = state;
      if (!timer) return;
      loadNotes(false);
      relayout();
      root.querySelector('.mis-hint').hidden = teams.length > 0;
    },

    start: function () {
      if (timer) return;
      timer = setInterval(function () {
        frame += 1;
        draw();
      }, 140);
      relayout();
      loadNotes(true);
    },

    stop: function () {
      clearInterval(timer);
      timer = null;
      walkers = {};
    }
  };
})();
