// Sin optional chaining ni `??`: la tablet puede llevar un Chrome antiguo.
(function () {
  'use strict';

  var REFRESH_MS = 5000;
  var NOW_RECENT_MS = 4 * 60 * 60 * 1000;
  var STALE_PROJECT_MS = 2 * 24 * 60 * 60 * 1000;
  var NOW_MAX_YOURS = 6;
  var SESSIONS_PER_PROJECT = 3;

  // Zonas por defecto; las de verdad llegan en `state.zones` (data/config.json).
  var ZONES = [
    { id: 'trabajo', title: 'Trabajo' },
    { id: 'personal', title: 'Personal' },
    { id: 'otros', title: 'Otros' }
  ];

  // Colores que Codex permite asignar a un proyecto.
  var PROJECT_COLORS = {
    yellow: '#f2c14e',
    red: '#ef6b6b',
    blue: '#5b9cf5',
    pink: '#f07fc0',
    green: '#5fd38d',
    orange: '#f2914e',
    purple: '#a98bf5',
    black: '#8a8f9c'
  };

  var STATUS_LABELS = { working: 'Trabajando', yours: 'Te toca', done: 'Terminada', idle: 'En pausa' };
  var AGENT_LABELS = { claude: 'Claude', codex: 'Codex' };
  // El panel continúa las sesiones de Claude con su CLI: en las de la app de escritorio el mensaje
  // quedaría en el registro sin que la app lo enseñe y sin sus herramientas, así que a esas no se les
  // escribe desde aquí (issue #3).
  var DESKTOP_APP_NOTE = 'Es una sesión de la app de Claude: háblale desde la app en el Mac o, desde el móvil, con Remote Control.';

  var SPRITES = {
    working:
      '<svg viewBox="0 0 8 8"><rect class="bar" x="0" y="4" width="2" height="3"/>' +
      '<rect class="bar" x="3" y="4" width="2" height="3"/><rect class="bar" x="6" y="4" width="2" height="3"/></svg>',
    yours:
      '<svg viewBox="0 0 8 8"><rect x="1" y="0" width="6" height="6"/><rect x="2" y="6" width="2" height="1"/>' +
      '<rect x="2" y="7" width="1" height="1"/><rect class="cut" x="3.5" y="1" width="1" height="2.5"/>' +
      '<rect class="cut" x="3.5" y="4" width="1" height="1"/></svg>',
    done:
      '<svg viewBox="0 0 8 8"><rect x="0" y="4" width="2" height="2"/><rect x="2" y="6" width="2" height="2"/>' +
      '<rect x="4" y="4" width="2" height="2"/><rect x="6" y="2" width="2" height="2"/></svg>',
    idle:
      '<svg viewBox="0 0 8 8"><rect x="1" y="1" width="4" height="1"/><rect x="3" y="2" width="1" height="1"/>' +
      '<rect x="2" y="3" width="1" height="1"/><rect x="1" y="4" width="4" height="1"/>' +
      '<rect x="5" y="5" width="2" height="1"/><rect x="6" y="6" width="1" height="1"/><rect x="5" y="7" width="2" height="1"/></svg>'
  };

  var lastState = null;

  function $(id) { return document.getElementById(id); }

  // Enlace a la misma sesión en claude.ai/code (Remote Control), si la app la ha enlazado.
  function remoteLink(s, className) {
    if (!s.remoteUrl) return '';
    return '<a class="' + className + '" href="' + escapeHtml(s.remoteUrl) + '" target="_blank" rel="noopener">Abrir con Remote Control</a>';
  }

  // Codex en su app: en el Mac, el hilo concreto (`codex://threads/<id>`); en el móvil o la tablet, Codex
  // en la app de ChatGPT (con el Mac emparejado se ven sus hilos), porque no hay enlace a un hilo.
  function codexAppLink(s) {
    if (s.agent !== 'codex' || s.isHelper || s.id.indexOf('codex:') !== 0) return '';
    var onMac = /Mac/.test(navigator.platform || '') && !navigator.maxTouchPoints && !/iPhone|iPad|Android/.test(navigator.userAgent);
    var href = onMac ? 'codex://threads/' + encodeURIComponent(s.id.slice(6)) : 'https://chatgpt.com/codex';
    return '<p class="order-app"><a class="link-btn" href="' + escapeHtml(href) + '" target="_blank" rel="noopener">' +
      (onMac ? 'Abrir en la app de Codex' : 'Abrir en ChatGPT') + '</a></p>';
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function sprite(status, large) {
    return '<span class="sprite sprite-' + status + (large ? ' sprite-lg' : '') +
      '" title="' + STATUS_LABELS[status] + '">' + SPRITES[status] + '</span>';
  }

  function agentTag(agent) {
    return '<span class="agent agent-' + agent + '">' + AGENT_LABELS[agent] + '</span>';
  }

  function relativeTime(timestamp, now) {
    var minutes = Math.floor((now - timestamp) / 60000);
    if (minutes < 1) return 'ahora';
    if (minutes < 60) return 'hace ' + minutes + ' min';
    var hours = Math.floor(minutes / 60);
    if (hours < 24) return 'hace ' + hours + ' h';
    var days = Math.floor(hours / 24);
    if (days === 1) return 'ayer';
    return 'hace ' + days + ' días';
  }

  function projectColor(project) {
    return PROJECT_COLORS[project.color] || 'var(--text-3)';
  }

  // Reloj

  function renderClock() {
    var now = new Date();
    var hh = String(now.getHours()).padStart(2, '0');
    var mm = String(now.getMinutes()).padStart(2, '0');
    $('clock-time').textContent = hh + ':' + mm;
    var date = now.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
    $('clock-date').textContent = date.charAt(0).toUpperCase() + date.slice(1);
  }

  // Panel

  function renderTotals(state) {
    var c = state.counts;
    var items = [
      { value: c.working, label: 'trabajando', status: 'working' },
      { value: c.yours, label: 'te toca', status: 'yours' },
      { value: c.projects, label: 'proyectos · ' + state.windowDays + ' días', status: null }
    ];
    $('totals').innerHTML = items.map(function (item) {
      return '<div class="total" title="' + item.value + ' ' + item.label + '"><div class="total-value">' +
        (item.status ? sprite(item.status, true) : '') + item.value +
        '</div><div class="total-label">' + item.label + '</div></div>';
    }).join('');
  }

  function renderNow(state, now) {
    var rows = [];
    state.projects.forEach(function (project) {
      project.sessions.forEach(function (session) {
        if (session.status === 'idle' || session.status === 'done' || now - session.lastActivity > NOW_RECENT_MS) return;
        rows.push({ project: project, session: session });
      });
    });
    rows.sort(function (a, b) {
      if (a.session.status !== b.session.status) return a.session.status === 'working' ? -1 : 1;
      return b.session.lastActivity - a.session.lastActivity;
    });

    if (rows.length === 0) {
      $('now-list').innerHTML = '<li class="empty">Ningún agente en marcha ni esperándote.</li>';
      return;
    }

    // Todo lo que está trabajando y solo los últimos turnos terminados, para que quepa de un vistazo.
    var working = rows.filter(function (row) { return row.session.status === 'working'; });
    var yours = rows.filter(function (row) { return row.session.status === 'yours'; });
    var shown = working.concat(yours.slice(0, NOW_MAX_YOURS));
    var hiddenYours = yours.length - Math.min(yours.length, NOW_MAX_YOURS);

    $('now-list').innerHTML = shown.map(function (row) {
      var s = row.session;
      var meta = escapeHtml(row.project.name) + (s.branch ? ' · ' + escapeHtml(s.branch) : '');
      return '<li class="now-item is-' + s.status + '">' +
        sprite(s.status, true) +
        '<div style="min-width:0"><div class="now-title">' + escapeHtml(s.title) + '</div>' +
        '<div class="now-meta">' + meta + '</div></div>' +
        '<div class="now-side">' + agentTag(s.agent) + relativeTime(s.lastActivity, now) + '</div>' +
        '</li>';
    }).join('') +
      (hiddenYours > 0 ? '<li class="now-more">+' + hiddenYours + (hiddenYours === 1 ? ' sesión más te espera' : ' sesiones más te esperan') + '</li>' : '');
  }

  function renderProject(project, now) {
    var visible = project.sessions.slice(0, SESSIONS_PER_PROJECT);
    var hidden = project.sessions.length - visible.length;
    var stale = now - project.lastActivity > STALE_PROJECT_MS;

    var sessions = visible.map(function (s) {
      return '<li class="session is-' + s.status + '">' +
        sprite(s.status) +
        '<div style="min-width:0"><div class="session-title">' + escapeHtml(s.title) + '</div>' +
        (s.branch ? '<div class="session-branch">' + escapeHtml(s.branch) + (s.worktree ? ' · worktree' : '') + '</div>' : '') +
        '</div>' +
        '<div class="session-when">' + agentTag(s.agent) + '<br>' + relativeTime(s.lastActivity, now) + '</div>' +
        '</li>';
    }).join('');

    return '<article class="project' + (stale ? ' is-stale' : '') + '">' +
      '<div class="project-head">' +
      '<span class="swatch" style="background:' + projectColor(project) + '"></span>' +
      '<h3 class="project-name">' + escapeHtml(project.name) + '</h3>' +
      '<span class="project-when">' + relativeTime(project.lastActivity, now) + '</span>' +
      '</div>' +
      '<ul class="sessions">' + sessions + '</ul>' +
      (hidden > 0 ? '<div class="more">+' + hidden + (hidden === 1 ? ' sesión más' : ' sesiones más') + '</div>' : '') +
      '</article>';
  }

  function renderZones(state, now) {
    $('zones').innerHTML = (state.zones && state.zones.length ? state.zones : ZONES).map(function (zone) {
      var projects = state.projects.filter(function (p) { return p.zone === zone.id; });
      if (projects.length === 0) return '';
      return '<section class="zone"><h2 class="section-title">' + escapeHtml(zone.title) + '</h2>' +
        '<div class="projects">' + projects.map(function (p) { return renderProject(p, now); }).join('') + '</div>' +
        '</section>';
    }).join('');
  }

  // Uso de los agentes

  function windowLabel(minutes) {
    if (minutes >= 7 * 24 * 60) return 'Semana';
    if (minutes >= 24 * 60) return Math.round(minutes / 1440) + ' días';
    return Math.round(minutes / 60) + ' h';
  }

  function resetLabel(resetsAt, now) {
    var date = new Date(resetsAt);
    var time = String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0');
    if (resetsAt - now < 24 * 60 * 60 * 1000 && date.getDate() === new Date(now).getDate()) return 'vuelve a las ' + time;
    return 'vuelve el ' + date.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric' }) + ' a las ' + time;
  }

  function renderUsageWindow(w, now) {
    // Si la ventana ya se reinició desde la última lectura, el uso real es 0.
    var used = w.resetsAt <= now ? 0 : Math.round(w.usedPercent);
    var level = used >= 90 ? 'is-full' : used >= 70 ? 'is-high' : '';
    return '<div class="usage-window ' + level + '">' +
      '<div class="usage-line"><span>' + windowLabel(w.windowMinutes) + '</span><span class="usage-pct">' + used + '%</span></div>' +
      '<div class="usage-bar"><span style="width:' + Math.min(used, 100) + '%"></span></div>' +
      '<div class="usage-reset">' + (w.resetsAt > now ? resetLabel(w.resetsAt, now) : 'reiniciado') + '</div>' +
      '</div>';
  }

  function renderUsage(state, now) {
    var usage = state.usage || {};
    var blocks = [
      { agent: 'claude', data: usage.claude, empty: 'Sin datos todavía' },
      { agent: 'codex', data: usage.codex, empty: 'Sin datos recientes' }
    ];
    $('usage').innerHTML = blocks.map(function (block) {
      var body = block.data && block.data.windows.length
        ? block.data.windows.map(function (w) { return renderUsageWindow(w, now); }).join('')
        : '<div class="usage-empty">' + block.empty + '</div>';
      return '<div class="usage-agent">' + agentTag(block.agent) + '<div class="usage-windows">' + body + '</div></div>';
    }).join('');

    // En pantallas pequeñas el uso se recoge en un botón con la ventana más gastada de cada agente.
    var full = false;
    var spoken = [];
    var html = blocks.map(function (block) {
      var used = null;
      (block.data ? block.data.windows : []).forEach(function (w) {
        var value = w.resetsAt <= now ? 0 : Math.round(w.usedPercent);
        if (used === null || value > used) used = value;
      });
      if (used !== null && used >= 90) full = true;
      spoken.push(AGENT_LABELS[block.agent] + ' ' + (used === null ? 'sin datos' : used + ' %'));
      return '<span class="usage-dot is-' + block.agent + '"></span>' + (used === null ? '–' : used + '%');
    }).join(' ');
    var toggle = $('usage-toggle');
    if (toggle.innerHTML !== html) toggle.innerHTML = html;
    toggle.className = 'usage-toggle' + (full ? ' is-full' : '');
    toggle.setAttribute('aria-label', 'Uso: ' + spoken.join(', '));
  }

  function toggleUsage() {
    var open = !document.body.classList.contains('usage-open');
    document.body.classList.toggle('usage-open', open);
    $('usage-toggle').setAttribute('aria-expanded', String(open));
    // La oficina empieza más arriba o más abajo: se recoloca.
    if (lastState && currentView === 'office') window.Office.update(lastState);
  }

  // Oficina

  // La ficha se compone de una cabecera que se repinta en cada refresco y una zona de órdenes
  // que solo se repinta cuando cambia su estado, para no borrar lo que se está escribiendo.
  var selection = null;
  var compose = { sessionId: null, mode: 'idle', draft: '', sending: false, error: null };
  var orderKey = null;
  var sessionDrafts = {};

  // Archivar en el panel (no en las apps): segundo toque para confirmar; vuelve si tiene actividad.
  var archiveAsk = null;
  var archiveAskTimer = null;

  function archiveButton(s) {
    if (!lastState || !lastState.canOrder || s.status === 'working' || s.isHelper) return '';
    var asking = archiveAsk === s.id;
    var team = (s.childIds || []).length;
    return '<button class="btn' + (asking ? ' is-asking' : '') + '" data-action="archive">' +
      (asking ? (team ? '¿Con sus ' + team + ' delegadas? Sí' : '¿Archivar? Sí') : 'Archivar') + '</button>';
  }

  function sessionActions(s) {
    var running = lastState && lastState.canOrder && s.order && s.order.status === 'running';
    return (running ? '<button class="btn" data-action="prepare-stop">Parar</button>' : '') + archiveButton(s);
  }

  function archiveSessions(ids) {
    postJson('/api/sessions/archive', { ids: ids })
      .then(function () {
        micToast(ids.length > 1 ? 'Equipo archivado. Vuelve si alguien retoma el trabajo.' : 'Sesión archivada. Vuelve si tiene actividad.');
        refresh();
      })
      .catch(function (error) { micToast(error.message); });
  }

  // Teclado en iPhone y iPad: Safari encoge la parte visible pero deja las cosas fijas abajo, detrás
  // del teclado. Se mide lo que tapa (`--kb`) y lo que queda (`--vvh`) para subir la hoja, el cuadro
  // de Misiones y esconder la barra de abajo mientras se escribe.
  function setupKeyboard() {
    var vv = window.visualViewport;
    if (!vv) return;
    var root = document.documentElement;
    function sync() {
      var covered = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
      var open = covered > 80;
      root.style.setProperty('--kb', (open ? covered : 0) + 'px');
      root.style.setProperty('--vvh', Math.round(vv.height) + 'px');
      document.body.classList.toggle('kb-open', open);
    }
    // Mientras se escribe en un cuadro de texto la barra de abajo sobra: se esconde al enfocarlo,
    // mida Safari lo que mida (según la versión, lo fijo sube con el teclado o se queda debajo).
    function typing(event) {
      var t = event.target;
      var on = event.type === 'focusin' && t && (t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && /^(text|search)$/.test(t.type)));
      document.body.classList.toggle('is-typing', Boolean(on));
    }
    document.addEventListener('focusin', typing);
    document.addEventListener('focusout', typing);
    vv.addEventListener('resize', sync);
    vv.addEventListener('scroll', sync);
    sync();
  }

  function detailTop(closeLabel) {
    return '<div class="detail-top"><button class="sheet-grab" data-action="sheet-cycle" aria-label="Cambiar la altura de la ficha"></button>' +
      '<span class="detail-archive" id="detail-archive"></span>' +
      '<button class="btn detail-close" data-action="close-detail" aria-label="' + closeLabel + '">Cerrar ×</button></div>';
  }

  // Atrás del sistema: abrir una ficha añade una entrada al historial, y abrir una sesión desde
  // la ficha de su puesto, otra más. Cerrar quita las que se añadieron.
  var historyKey = null;
  var historyDepth = 0;
  var applyingHistory = false;

  function selectionKey(value) {
    if (!value) return null;
    return value.session ? 's:' + value.session.id : 'p:' + value.project.id;
  }

  function syncHistory(next) {
    var key = selectionKey(next);
    if (key === historyKey) return;
    var previous = historyKey;
    historyKey = key;
    if (applyingHistory || !window.history.pushState) return;
    if (!key) {
      if (historyDepth) {
        applyingHistory = true;
        window.history.go(-historyDepth);
        historyDepth = 0;
      }
      return;
    }
    if (!previous || (previous.charAt(0) === 'p' && key.charAt(0) === 's')) {
      historyDepth += 1;
      window.history.pushState({ detail: key, depth: historyDepth }, '');
    } else {
      window.history.replaceState({ detail: key, depth: historyDepth }, '');
    }
  }

  function applyHistory(event) {
    var state = event.state || {};
    var target = state.detail || null;
    historyDepth = state.depth || 0;
    // Vuelta atrás que pidió el propio panel al cerrar: la ficha ya está cerrada.
    if (applyingHistory && !target) {
      applyingHistory = false;
      return;
    }
    applyingHistory = true;
    if (!target) window.Office.select(null);
    else if (target.charAt(0) === 's') window.Office.select(target.slice(2));
    else window.Office.selectProject(target.slice(2));
    applyingHistory = false;
  }

  // Hoja inferior (móvil y tablet en vertical): tres alturas; se arrastra por el asa.
  var SHEET_QUERY = '(max-width: 760px), (max-width: 1180px) and (orientation: portrait), (max-width: 1366px) and (orientation: portrait) and (any-pointer: coarse)';
  var DETENTS = ['peek', 'half', 'full'];

  function sheetMode() {
    return Boolean(window.matchMedia && window.matchMedia(SHEET_QUERY).matches);
  }

  // Las mismas alturas que la hoja de estilos
  function detentHeights() {
    var h = window.innerHeight;
    return { peek: 150, half: Math.round(h * 0.55), full: h - 16 };
  }

  function setDetent(name) {
    $('office-detail').setAttribute('data-detent', name);
  }

  function cycleDetent() {
    var current = $('office-detail').getAttribute('data-detent');
    setDetent(current === 'half' ? 'full' : 'half');
    window.Office.reframe();
  }

  // Lo que tapa la ficha abierta sobre la oficina, para que la cámara encuadre en lo que queda:
  // la hoja por abajo (con la altura a la que va, no la de su animación) o el panel por la derecha.
  function officeCover() {
    var detail = $('office-detail');
    if (currentView !== 'office' || !/\bis-(selected|project)\b/.test(detail.className)) return null;
    if (sheetMode()) {
      return { right: 0, bottom: detentHeights()[detail.getAttribute('data-detent') || 'half'] };
    }
    var box = detail.getBoundingClientRect();
    return { right: Math.max(0, window.innerWidth - box.left + 8), bottom: 0 };
  }

  function syncSheet(next) {
    var detail = $('office-detail');
    if (!next) detail.removeAttribute('data-detent');
    else if (!detail.getAttribute('data-detent') || (next.session && (!selection || !selection.session))) setDetent(next.session ? 'full' : 'half');
  }

  function setupSheet() {
    var detail = $('office-detail');
    var drag = null;

    function start(y, target) {
      if (!sheetMode() || !target.closest || !target.closest('.detail-top') || target.closest('button:not(.sheet-grab)')) return false;
      drag = { y: y, height: detail.getBoundingClientRect().height, moved: false };
      detail.classList.add('is-dragging');
      return true;
    }
    function move(y) {
      if (!drag) return;
      var dy = y - drag.y;
      if (Math.abs(dy) > 6) drag.moved = true;
      if (drag.moved) detail.style.height = Math.max(60, drag.height - dy) + 'px';
    }
    function end() {
      if (!drag) return;
      var moved = drag.moved;
      var height = detail.getBoundingClientRect().height;
      drag = null;
      detail.classList.remove('is-dragging');
      detail.style.height = '';
      if (!moved) {
        cycleDetent();
        return;
      }
      var heights = detentHeights();
      if (height < heights.peek * 0.7) {
        window.Office.select(null);
        return;
      }
      var nearest = DETENTS[0];
      DETENTS.forEach(function (name) {
        if (Math.abs(heights[name] - height) < Math.abs(heights[nearest] - height)) nearest = name;
      });
      setDetent(nearest);
      window.Office.reframe();
    }

    if (window.PointerEvent) {
      detail.addEventListener('pointerdown', function (event) {
        if (start(event.clientY, event.target)) event.preventDefault();
      });
      window.addEventListener('pointermove', function (event) { move(event.clientY); });
      window.addEventListener('pointerup', end);
      window.addEventListener('pointercancel', end);
    } else {
      detail.addEventListener('touchstart', function (event) {
        if (start(event.touches[0].clientY, event.target)) event.preventDefault();
      });
      window.addEventListener('touchmove', function (event) { if (drag) move(event.touches[0].clientY); });
      window.addEventListener('touchend', end);
      window.addEventListener('touchcancel', end);
    }
    // Al escribir, la hoja sube entera para que el teclado no tape el cuadro.
    detail.addEventListener('focusin', function (event) {
      if (sheetMode() && event.target.tagName === 'TEXTAREA') setDetent('full');
    });
  }

  // Una sola superficie interactiva: evita fichas y formularios superpuestos.
  function syncSurfaceBackdrop() {
    var visible = Boolean(selection || launch.open || talk);
    var backdrop = $('surface-backdrop');
    if (!backdrop) {
      backdrop = document.createElement('button');
      backdrop.id = 'surface-backdrop';
      backdrop.className = 'surface-backdrop';
      backdrop.setAttribute('aria-label', 'Cerrar la ventana abierta');
      backdrop.addEventListener('click', function () { prepareSurface('none'); });
      document.body.appendChild(backdrop);
    }
    backdrop.hidden = !visible;
    document.body.classList.toggle('has-surface', visible);
    if (!visible && document.activeElement === document.body) document.body.classList.remove('is-typing');
  }

  function prepareSurface(kind) {
    if (window.Office.closeMenu) window.Office.closeMenu();
    if (kind !== 'talk' && talk) closeTalk();
    if (kind !== 'launch' && launch.open) {
      launch.open = false;
      renderLaunch();
    }
    if (kind !== 'detail' && selection) window.Office.select(null);
  }

  function renderOfficeDetail(next) {
    queueMicrotask(syncSurfaceBackdrop);
    if (next) prepareSurface('detail');
    var previousId = selection && selection.session ? selection.session.id : null;
    var nextId = next && next.session ? next.session.id : null;
    syncSheet(next);
    syncHistory(next);
    if (previousId !== nextId && previousId) {
      sessionDrafts[previousId] = { compose: compose, steer: steer };
    }
    if (previousId !== nextId) {
      stopLive();
      prepared = null;
    }
    selection = next;
    var detail = $('office-detail');
    if (!selection) {
      detail.className = 'office-detail';
      detail.textContent = 'Toca un personaje para ver qué está haciendo.';
      orderKey = null;
      return;
    }
    if (!selection.session) {
      renderProjectDetail(selection.project);
      return;
    }
    var s = selection.session;
    if (previousId !== s.id) {
      var saved = sessionDrafts[s.id];
      compose = saved ? saved.compose : { sessionId: s.id, mode: 'idle', draft: '', sending: false, error: null };
      steer = saved ? saved.steer : { draft: '', sending: false, note: null };
      orderKey = null;
      steerKey = null;
    }
    if (detail.className !== 'office-detail is-selected') {
      detail.className = 'office-detail is-selected';
      detail.innerHTML = detailTop('Cerrar conversación') + '<div class="detail-head" id="detail-head"></div><div id="detail-live"></div><div id="detail-team"></div><div id="detail-chat"></div>' +
        '<div class="detail-order" id="detail-order"></div><div id="detail-steer"></div>';
      orderKey = null;
      steerKey = null;
      if (chat.id === s.id) renderChat();
    }
    $('detail-head').innerHTML = sprite(s.status, true) +
      '<div style="min-width:0"><div class="now-title">' + escapeHtml(s.title) + '</div>' +
      '<div class="now-meta">' + escapeHtml(selection.project.name) + (s.branch ? ' · ' + escapeHtml(s.branch) : '') +
      ' · ' + (s.waitingForTeam ? 'coordinando trabajo en curso' : s.completedForParent ? 'lista para la coordinadora' : STATUS_LABELS[s.status].toLowerCase()) +
      (s.managed ? ' · <span class="managed-tag">del panel' + (s.mode === 'plan' ? ', solo mirar' : '') + '</span>' : '') +
      '</div></div>' +
      '<div class="now-side">' + agentTag(s.agent) + relativeTime(s.lastActivity, Date.now()) + '</div>';
    var archiveSlot = $('detail-archive');
    if (archiveSlot) archiveSlot.innerHTML = sessionActions(s);
    var teamHtml = renderTeam(s);
    var teamBox = $('detail-team');
    var teamOpen = teamBox.querySelector('details[open]');
    teamBox.innerHTML = teamHtml ? '<details class="detail-team-fold"' + (teamOpen ? ' open' : '') + '><summary>Equipo y delegadas</summary>' + teamHtml + '</details>' : '';
    updateChat(s);
    renderOrder();
    renderSteer();
    startLive(s);
  }

  // EventSource reconecta solo. Al cerrar la ficha, cambiar de pestaña o esconder la página se cierra.
  var live = { source: null, id: null, connected: false, following: true, snapshot: null };

  function stopLive() {
    if (live.source) live.source.close();
    live.source = null;
    live.id = null;
    live.connected = false;
    live.following = true;
    live.snapshot = null;
  }

  function renderLive() {
    var box = $('detail-live');
    if (!box) return;
    var label = live.connected ? 'En vivo' : live.source ? 'Reconectando…' : 'Actualización cada 5 s';
    var html = '<div class="live-bar"><span class="live-state' + (live.connected ? ' is-connected' : '') + '" role="status">' + label + '</span>' +
      (!live.following ? '<button class="btn btn-small" data-action="live-follow">Seguir el final ↓</button><span class="live-reading">Leyendo mensajes anteriores</span>' : '') + '</div>';
    if (box.innerHTML !== html) box.innerHTML = html;
  }

  function startLive(s) {
    if (!window.EventSource || !lastState || !lastState.canOrder || !detailView() || document.hidden || s.isHelper) {
      if (live.source) stopLive();
      renderLive();
      return;
    }
    if (live.id === s.id && live.source) {
      // El estado general llega cada 5 s y puede ser anterior al último evento en vivo.
      if (live.snapshot) {
        s.order = live.snapshot.order;
        renderOrder();
        renderSteer();
      }
      renderLive();
      return;
    }
    stopLive();
    live.id = s.id;
    var source = new window.EventSource('/api/sessions/' + encodeURIComponent(s.id) + '/live');
    live.source = source;
    source.onmessage = function (event) {
      if (live.source !== source || !selection || !selection.session || selection.session.id !== s.id) return;
      var body;
      try { body = JSON.parse(event.data); } catch (error) { return; }
      live.connected = true;
      live.snapshot = body;
      if (live.following) applyLiveMessages(body);
      selection.session.order = body.order;
      if (body.order && body.order.status === 'running') selection.session.status = 'working';
      renderOrder();
      renderSteer();
      renderLive();
    };
    source.onerror = function () {
      if (live.source !== source) return;
      live.connected = false;
      renderLive();
    };
    renderLive();
  }

  function applyLiveMessages(body) {
    chat.messages = body.messages.slice();
    var order = body.order;
    if (order && order.status === 'running' && order.reply) {
      // El registro puede haber guardado el mensaje antes de la siguiente notificación.
      // Busca también antes de las herramientas, sin confundir otro turno con este.
      var recorded = chat.messages.some(function (m) {
        if (m.role !== 'agent') return false;
        if (order.replyId && m.id) return m.id === order.replyId;
        return m.at >= order.startedAt &&
          (m.text === order.reply.trim() || m.text.indexOf(order.reply.trim()) === 0);
      });
      if (!recorded) {
        chat.messages.push({ role: 'agent', text: order.reply, streaming: true });
      }
    }
    chat.error = null;
    renderChat();
  }

  // Conversación reciente: se pide al seleccionar y cada vez que la sesión tiene actividad nueva.
  // La vista principal sustituye la respuesta anterior; el historial es optativo.
  function currentMessages(messages) {
    var lastUser = -1;
    var lastAgent = -1;
    messages.forEach(function (m, i) {
      if (m.role === 'user') { lastUser = i; lastAgent = -1; }
      if (m.role === 'agent') lastAgent = i;
    });
    return messages.filter(function (m, i) {
      return i === lastUser || i === lastAgent || (m.role === 'tool' && i === messages.length - 1);
    });
  }

  var chat = { id: null, key: null, loading: false, messages: null, error: null, expanded: false, agent: null };

  function updateChat(s) {
    if (!$('detail-chat')) return;
    if (s.isHelper) {
      $('detail-chat').innerHTML = '';
      return;
    }
    if (chat.id !== s.id) {
      chat = { id: s.id, key: null, loading: false, messages: null, error: null, expanded: false, agent: s.agent };
      renderChat();
    }
    if (live.id === s.id && live.connected) return;
    var order = s.order;
    var key = s.id + '|' + s.lastActivity + '|' + (order ? order.status + (order.reply || '').length : '');
    if (key === chat.key || chat.loading) return;
    chat.key = key;
    chat.loading = true;
    var id = s.id;
    var requestChat = chat;
    fetch('/api/sessions/' + encodeURIComponent(id) + '/transcript', { cache: 'no-store' })
      .then(function (res) {
        return res.json().then(function (body) {
          if (!res.ok) throw new Error(body.error || 'HTTP ' + res.status);
          return body;
        });
      })
      .then(function (body) {
        if (chat !== requestChat || (live.id === id && live.connected)) return;
        applyLiveMessages({ messages: body.messages, order: selection && selection.session && selection.session.id === id ? selection.session.order : null });
        chat.error = null;
      })
      .catch(function (error) {
        if (chat === requestChat && !(live.id === id && live.connected)) { chat.error = error.message; chat.key = null; }
      })
      .then(function () {
        if (chat !== requestChat) return;
        chat.loading = false;
        renderChat();
      });
  }

  function renderChat(revealEarlier) {
    var box = $('detail-chat');
    if (!box) return;
    if (!chat.messages || chat.error) box.removeAttribute('data-chat-html');
    if (chat.error) {
      box.innerHTML = '<div class="chat"><p class="order-note">' + escapeHtml(chat.error) + '</p></div>';
      return;
    }
    if (!chat.messages) {
      box.innerHTML = '<div class="chat"><p class="order-note">Cargando la conversación…</p></div>';
      return;
    }
    if (!chat.messages.length) {
      box.removeAttribute('data-chat-html');
      box.innerHTML = '<p class="order-note">Todavía no hay mensajes recientes en el registro.</p>';
      return;
    }
    var oldList = $('chat-list');
    var oldTop = oldList ? oldList.scrollTop : 0;
    var follow = !oldList || oldList.scrollHeight - oldTop - oldList.clientHeight < 48;
    var shown = chat.expanded ? chat.messages : currentMessages(chat.messages);
    var hidden = chat.messages.length - shown.length;
    var agentName = AGENT_LABELS[chat.agent] || 'Agente';
    var html = '<div class="chat">' +
      '<div class="chat-head"><span class="team-label">' + (chat.expanded ? 'Historial reciente' : 'Ahora') + '</span>' +
      (chat.expanded || hidden > 0
        ? '<button class="btn btn-small" data-action="chat-toggle">' + (chat.expanded ? 'Volver a ahora' : 'Historial (' + hidden + ')') + '</button>'
        : '') + '</div>' +
      '<ol class="chat-list" id="chat-list">' + shown.map(function (m) {
        if (m.role === 'tool') {
          return '<li class="chat-tool"><details><summary>' + (m.count || 1) +
            ((m.count || 1) === 1 ? ' herramienta' : ' herramientas') +
            '</summary>' + escapeHtml(m.text) + '</details></li>';
        }
        return '<li class="chat-msg is-' + m.role + '">' +
          '<span class="chat-who">' + (m.role === 'user' ? 'Tú' : agentName) +
          (m.streaming ? ' · escribiendo…' : '') +
          (m.at ? ' · ' + relativeTime(m.at, Date.now()) : '') + '</span>' +
          '<p>' + escapeHtml(m.text) + '</p></li>';
      }).join('') + '</ol></div>';
    if (box.getAttribute('data-chat-html') === html) return;
    box.setAttribute('data-chat-html', html);
    box.innerHTML = html;
    var list = $('chat-list');
    if (list) list.scrollTop = revealEarlier ? 0 : follow ? list.scrollHeight : oldTop;
    if (list && live.id === chat.id) {
      live.following = list.scrollHeight - list.scrollTop - list.clientHeight < 48;
      renderLive();
    }
  }

  // Coordinadora y sesiones de issue

  function findSessionById(id) {
    var found = null;
    (lastState ? lastState.projects : []).forEach(function (project) {
      project.sessions.forEach(function (s) {
        if (s.id === id) found = { session: s, project: project };
      });
    });
    return found;
  }

  // Una sesión recién lanzada tarda unos segundos en salir en el estado: se espera antes de seleccionarla.
  function selectWhenReady(sessionId, tries) {
    if (findSessionById(sessionId)) {
      window.Office.select(sessionId);
      return;
    }
    if (tries <= 0) {
      micToast('Esa sesión ya no está en la oficina, o todavía no ha aparecido.');
      return;
    }
    setTimeout(function () {
      refresh();
      setTimeout(function () { selectWhenReady(sessionId, tries - 1); }, 600);
    }, 1400);
  }

  function sessionRow(s, extraClass) {
    return '<button class="team-row ' + (extraClass || '') + '" data-select="' + escapeHtml(s.id) + '">' +
      sprite(s.status) +
      '<span class="team-title">' + (s.issue && s.title.indexOf('#' + s.issue) === -1 ? '<span class="issue-tag">#' + escapeHtml(s.issue) + '</span> ' : '') +
      (s.role === 'coordinator' ? '<span class="coord-tag">coordinadora</span> ' : '') + escapeHtml(s.title) + '</span>' +
      '<span class="team-when">' + relativeTime(s.lastActivity, Date.now()) + '</span></button>';
  }

  function renderSubagents(s) {
    var subs = s.subagents || [];
    if (!subs.length) return '';
    var running = subs.filter(function (a) { return a.running; }).length;
    return '<div class="team"><span class="team-label">Subagentes' + (running ? ' · ' + running + ' trabajando' : '') + '</span>' +
      subs.slice(0, 6).map(function (a) {
        return '<div class="team-row is-static">' + sprite(a.running ? 'working' : 'idle') +
          '<span class="team-title"><span class="issue-tag">' + escapeHtml(a.kind) + '</span> ' + escapeHtml(a.description) + '</span>' +
          '<span class="team-when">' + (a.running ? 'trabajando' : relativeTime(a.lastActivity, Date.now())) + '</span></div>';
      }).join('') + '</div>';
  }

  function renderTeam(s) {
    return renderSubagents(s) + renderRelations(s);
  }

  function renderRelations(s) {
    if (s.role === 'coordinator') {
      var children = (s.childIds || []).map(findSessionById).filter(Boolean)
        .map(function (item) { return item.session; })
        .sort(function (a, b) { return b.lastActivity - a.lastActivity; });
      return '<div class="team"><span class="team-label">Coordina ' + children.length +
        (children.length === 1 ? ' sesión' : ' sesiones') + '</span>' +
        children.map(function (child) { return sessionRow(child); }).join('') + '</div>';
    }
    if (s.role === 'worker') {
      var parent = findSessionById(s.parentId);
      return '<div class="team"><span class="team-label">La coordina</span>' +
        (parent ? sessionRow(parent.session) : '<p class="order-note">Una sesión que ya no está en los últimos 7 días.</p>') + '</div>';
    }
    return '';
  }

  // Ficha de un puesto: sus sesiones agrupadas por coordinadora y el atajo para abrir otra.
  function renderProjectDetail(project) {
    var detail = $('office-detail');
    detail.className = 'office-detail is-project';
    orderKey = null;
    var sessions = project.sessions.slice().sort(function (a, b) { return b.lastActivity - a.lastActivity; });
    var shown = {};
    var rows = [];
    sessions.forEach(function (s) {
      if (shown[s.id] || rows.length >= 10) return;
      if (s.role === 'worker' && s.parentId && sessions.some(function (x) { return x.id === s.parentId; })) return;
      shown[s.id] = true;
      rows.push(sessionRow(s));
      if (s.role === 'coordinator') {
        sessions.forEach(function (child) {
          if (child.parentId === s.id && !shown[child.id]) {
            shown[child.id] = true;
            rows.push(sessionRow(child, 'is-child'));
          }
        });
      }
    });
    var c = project.counts;
    var canLaunch = lastState && lastState.canOrder && project.roots && project.roots.length;
    detail.innerHTML = detailTop('Cerrar sesiones') + '<div class="project-detail-head">' +
      '<span class="swatch" style="background:' + projectColor(project) + '"></span>' +
      '<div><div class="now-title">' + escapeHtml(project.name) + '</div>' +
      '<div class="now-meta">' + c.working + ' trabajando · ' + c.yours + ' te esperan · ' + project.sessions.length + ' sesiones en 7 días</div></div>' +
      (canLaunch ? '<button class="btn" data-action="launch-here">Nueva sesión aquí</button>' : '') +
      '</div><div class="team">' + rows.join('') + '</div>';
  }

  function renderOrder() {
    var s = selection.session;
    var actions = $('detail-archive');
    if (actions) actions.innerHTML = sessionActions(s);
    var order = s.order || null;
    var canOrder = lastState && lastState.canOrder;
    var key = [s.id, s.status, canOrder, canDictate(), compose.mode, compose.sending, compose.error, preparedFor(s.id),
      order ? order.status + order.startedAt + (order.reply || '').length + (order.error || '') +
        (order.activity ? order.activity.kind + order.activity.detail : '') +
        (order.approvals || []).map(function (a) { return a.id; }).join(',') + order.canSteer : ''].join('|');
    if (key === orderKey) return;
    orderKey = key;

    var html = '';
    if (order) html += renderOrderResult(order);
    if (compose.error && compose.mode !== 'confirm') html += '<p class="order-error" role="alert">' + escapeHtml(compose.error) + '</p>';

    if (!canOrder) {
      html += '<p class="order-note">' + escapeHtml((lastState && lastState.orderBlockedReason) || 'No se pueden mandar órdenes desde aquí.') + '</p>';
    } else if (s.desktopApp) {
      html += '<p class="order-note">' + DESKTOP_APP_NOTE + '</p>' + remoteLink(s, 'btn');
    } else if ((s.ownStatus || s.status) === 'working') {
      if (!order || order.status !== 'running') html += '<p class="order-note">Está trabajando; podrás escribirle cuando termine.</p>';
    } else if (compose.mode === 'confirm') {
      html += '<div class="order-confirm">' +
        '<p>Vas a enviar a <strong>' + AGENT_LABELS[s.agent] + '</strong> en <strong>' + escapeHtml(selection.project.name) + '</strong>:</p>' +
        '<blockquote>' + escapeHtml(compose.draft) + '</blockquote>' +
        '<p class="order-note">' + escapeHtml(lastState.orderModes[s.mode === 'plan' ? 'plan' : 'auto']) + ' Si la sesión está abierta en la app, recárgala después para ver la respuesta.</p>' +
        (compose.error ? '<p class="order-error">' + escapeHtml(compose.error) + '</p>' : '') +
        '<div class="order-actions">' +
        '<button class="btn btn-primary" data-action="send"' + (compose.sending ? ' disabled' : '') + '>' + (compose.sending ? 'Enviando…' : 'Enviar') + '</button>' +
        '<button class="btn" data-action="edit"' + (compose.sending ? ' disabled' : '') + '>Volver</button>' +
        '</div></div>';
    } else {
      html += '<div class="order-compose">' +
        '<textarea aria-label="Respuesta a la sesión" id="order-text" rows="2" maxlength="4000" placeholder="Escríbele algo a esta sesión…">' + escapeHtml(compose.draft) + '</textarea>' +
        micButton('order-text') +
        '<button class="btn btn-primary" data-action="review">Revisar</button>' +
        '</div>';
    }
    html += codexAppLink(s);
    var active = document.activeElement;
    var editing = active && active.id === 'order-text';
    var start = editing ? active.selectionStart : 0;
    var end = editing ? active.selectionEnd : 0;
    $('detail-order').innerHTML = html;
    if (editing && $('order-text')) {
      $('order-text').focus({ preventScroll: true });
      $('order-text').setSelectionRange(start, end);
    }
    paintMicButtons();
  }

  var ACTIVITY_LABELS = {
    thinking: 'Pensando',
    reading: 'Leyendo',
    editing: 'Editando',
    running: 'Ejecutando',
    delegating: 'Delegando',
    writing: 'Escribiendo la respuesta',
    approval: 'Esperando tu aprobación'
  };

  function renderOrderResult(order) {
    if (order.status === 'running') {
      var activity = order.activity;
      var doing = activity
        ? ACTIVITY_LABELS[activity.kind] + (activity.detail ? ' <code>' + escapeHtml(activity.detail) + '</code>' : '')
        : 'Trabajando';
      var kind = preparedFor(selection.session.id);
      // Parar desde el menú circular: queda preguntado, a un toque de confirmarlo.
      var stopping = kind === 'stop'
        ? '<div class="order-confirm is-prepared"><p>¿Parar la orden en marcha?</p><div class="order-actions">' +
          '<button class="btn btn-primary" data-action="stop" data-prepared>Sí, parar</button>' +
          '<button class="btn" data-action="stop-cancel">No</button></div></div>'
        : '';
      return '<div class="order-result"><div class="order-running">' +
        '<span class="order-label">' + doing + '</span>' +
        (stopping ? '' : '<button class="btn btn-small" data-action="stop">Parar</button>') + '</div>' +
        stopping + '</div>' + renderApprovals(order.approvals || [], kind === 'approve');
    }
    if (order.status === 'stopped') {
      return '<div class="order-result is-failed"><span class="order-label">' +
        (order.pauseReason ? 'En pausa' : 'Parada desde el panel') + '</span>' +
        (selection.session.agent === 'codex' ? '<p>' + escapeHtml(order.pauseReason || '') +
          ' Sesión liberada. Puedes continuar en Codex o enviar otra orden desde el panel. Si había una pregunta o aprobación, puede que Codex tenga que volver a pedirla.</p>' : '') +
        '</div>';
    }
    if (order.status === 'failed') {
      return '<div class="order-result is-failed"><span class="order-label">No se pudo completar</span>' +
        '<p>' + escapeHtml(order.error) + '</p></div>';
    }
    return ''; // La respuesta se muestra una sola vez, en la conversación.
  }

  var APPROVAL_TITLES = {
    command: 'Quiere ejecutar',
    file: 'Quiere cambiar ficheros',
    permissions: 'Pide más permisos'
  };

  // Peticiones de aprobación de Codex: el turno espera hasta que respondas.
  function renderApprovals(approvals, prepared) {
    return approvals.map(function (a, i) {
      return '<div class="approval' + (prepared && !i ? ' is-prepared' : '') + '">' +
        '<span class="order-label is-approval">' + (APPROVAL_TITLES[a.kind] || 'Pide aprobación') + '</span>' +
        '<code class="approval-summary">' + escapeHtml(a.summary) + '</code>' +
        (a.reason ? '<p class="order-note">' + escapeHtml(a.reason) + '</p>' : '') +
        '<div class="order-actions">' +
        '<button class="btn btn-primary" data-approval="accept" data-request="' + escapeHtml(a.id) + '"' + (prepared && !i ? ' data-prepared' : '') + '>Aprobar</button>' +
        '<button class="btn" data-approval="acceptForSession" data-request="' + escapeHtml(a.id) + '">Aprobar en esta sesión</button>' +
        '<button class="btn" data-approval="decline" data-request="' + escapeHtml(a.id) + '">Rechazar</button>' +
        '</div></div>';
    }).join('');
  }

  // Menú circular de la oficina (mantener pulsado o clic derecho). La sesión ya está elegida y su
  // ficha abierta: Contestar enfoca el cuadro; Aprobar y Parar solo dejan preparado el segundo toque.
  var prepared = null;

  function preparedFor(sessionId) {
    return prepared && prepared.sessionId === sessionId ? prepared.kind : '';
  }

  function handleMenuAction(action, sessionId) {
    if (!selection || !selection.session || selection.session.id !== sessionId) return;
    prepared = action === 'approve' || action === 'stop' ? { sessionId: sessionId, kind: action } : null;
    if (sheetMode() && action !== 'open') setDetent('full');
    orderKey = null;
    renderOrder();
    var target = action === 'reply' ? $('order-text') : prepared ? document.querySelector('#detail-order [data-prepared]') : null;
    if (!target) return;
    if (action !== 'reply') target.scrollIntoView({ block: 'nearest' });
    target.focus({ preventScroll: action !== 'reply' });
  }

  // Indicaciones sobre la marcha (solo Codex): su propio contenedor, para no borrar lo que escribes.
  var steerKey = null;
  var steer = { draft: '', sending: false, note: null };

  function renderSteer() {
    var box = $('detail-steer');
    if (!box) return;
    var s = selection.session;
    var order = s.order;
    var can = Boolean(order && order.canSteer && lastState && lastState.canOrder);
    var key = s.id + '|' + can + '|' + canDictate() + '|' + steer.sending + '|' + steer.note;
    if (key === steerKey) return;
    steerKey = key;
    if (!can) {
      box.innerHTML = '';
      return;
    }
    box.innerHTML = '<div class="order-compose steer">' +
      '<textarea aria-label="Indicación sobre la marcha" id="steer-text" rows="1" maxlength="4000" placeholder="Corrígele sobre la marcha…">' + escapeHtml(steer.draft) + '</textarea>' +
      micButton('steer-text') +
      '<button class="btn" data-action="steer"' + (steer.sending ? ' disabled' : '') + '>' + (steer.sending ? 'Enviando…' : 'Indicar') + '</button>' +
      '</div>' + (steer.note ? '<p class="order-note">' + escapeHtml(steer.note) + '</p>' : '');
    paintMicButtons();
  }

  function sendSteer() {
    var text = $('steer-text').value.trim();
    if (!text) return;
    var sendingSteer = steer;
    var sessionId = selection.session.id;
    steer.draft = text;
    steer.sending = true;
    steer.note = null;
    renderSteer();
    postJson('/api/sessions/' + encodeURIComponent(sessionId) + '/steer', { text: text })
      .then(function () {
        sendingSteer.draft = '';
        sendingSteer.sending = false;
        sendingSteer.note = 'Indicación enviada.';
        if (selection && selection.session && selection.session.id === sessionId) renderSteer();
      })
      .catch(function (error) {
        sendingSteer.sending = false;
        sendingSteer.note = error.message;
        if (selection && selection.session && selection.session.id === sessionId) renderSteer();
      });
  }

  function answerApproval(requestId, decision) {
    postJson('/api/sessions/' + encodeURIComponent(selection.session.id) + '/approval', { requestId: requestId, decision: decision })
      .then(refresh)
      .catch(function (error) {
        compose.error = error.message;
        orderKey = null;
        renderOrder();
      });
  }

  function postJson(url, data) {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data || {})
    }).then(function (res) {
      return res.json().then(function (body) {
        if (!res.ok) throw new Error(body.error || 'HTTP ' + res.status);
        return body;
      });
    });
  }

  function stopOrder() {
    postJson('/api/sessions/' + encodeURIComponent(selection.session.id) + '/stop')
      .then(refresh)
      .catch(function (error) {
        compose.error = error.message;
        orderKey = null;
        renderOrder();
      });
  }

  function sendOrder() {
    var s = selection.session;
    var sendingCompose = compose;
    compose.sending = true;
    compose.error = null;
    renderOrder();
    postJson('/api/sessions/' + encodeURIComponent(s.id) + '/order', { text: compose.draft })
      .then(function () {
        sendingCompose.mode = 'idle';
        sendingCompose.draft = '';
        sendingCompose.sending = false;
        refresh();
      })
      .catch(function (error) {
        sendingCompose.sending = false;
        sendingCompose.error = error.message;
        if (selection && selection.session && selection.session.id === s.id) renderOrder();
      });
  }

  function handleOrderClick(event) {
    var row = event.target.closest ? event.target.closest('[data-select]') : null;
    if (row) {
      window.Office.select(row.getAttribute('data-select'));
      return;
    }
    var approval = event.target.getAttribute && event.target.getAttribute('data-approval');
    if (approval && selection) {
      prepared = null;
      event.target.disabled = true;
      answerApproval(event.target.getAttribute('data-request'), approval);
      return;
    }
    var action = event.target.getAttribute && event.target.getAttribute('data-action');
    if (!action || !selection) return;
    if (action === 'close-detail') {
      window.Office.select(null);
      return;
    }
    if (action === 'archive' && selection.session) {
      var archiving = selection.session;
      if (archiveAsk !== archiving.id) {
        archiveAsk = archiving.id;
        clearTimeout(archiveAskTimer);
        archiveAskTimer = setTimeout(function () { archiveAsk = null; if (selection) renderOfficeDetail(selection); }, 4000);
        renderOfficeDetail(selection);
        return;
      }
      archiveAsk = null;
      window.Office.select(null);
      archiveSessions([archiving.id].concat(archiving.childIds || []));
      return;
    }
    // Con el teclado el asa cambia de altura; con el dedo lo hace setupSheet.
    if (action === 'sheet-cycle') {
      if (!event.detail) cycleDetent();
      return;
    }
    if (action === 'live-follow') {
      live.following = true;
      if (live.snapshot) applyLiveMessages(live.snapshot);
      var list = $('chat-list');
      if (list) list.scrollTop = list.scrollHeight;
      live.following = true;
      renderLive();
      return;
    }
    if (action === 'prepare-stop') {
      handleMenuAction('stop', selection.session.id);
      return;
    }
    if (action === 'steer') {
      sendSteer();
      return;
    }
    if (action === 'chat-toggle') {
      chat.expanded = !chat.expanded;
      live.following = true;
      if (live.snapshot) applyLiveMessages(live.snapshot);
      renderChat(chat.expanded);
      return;
    }
    if (action === 'launch-here') {
      prepareSurface('launch');
      launch.open = true;
      launch.mode = 'edit';
      launch.cwd = selection.project.roots[0];
      renderLaunch();
      $('new-session').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      return;
    }
    if (action === 'review') {
      var text = $('order-text').value.trim();
      if (!text) return;
      compose.draft = text;
      compose.mode = 'confirm';
      renderOrder();
    } else if (action === 'edit') {
      compose.mode = 'idle';
      compose.error = null;
      renderOrder();
    } else if (action === 'send') {
      sendOrder();
    } else if (action === 'stop') {
      prepared = null;
      stopOrder();
    } else if (action === 'stop-cancel') {
      prepared = null;
      renderOrder();
    }
  }

  function handleOrderInput(event) {
    if (event.target.id === 'order-text') compose.draft = event.target.value;
    if (event.target.id === 'steer-text') steer.draft = event.target.value;
  }

  // Nueva sesión (opción B): el panel abre una sesión propia en la carpeta de un proyecto.

  var launch = { open: false, mode: 'edit', agent: 'claude', perm: 'auto', cwd: '', draft: '', sending: false, error: null };

  // Carpetas para abrir una sesión: primero las de proyectos con actividad, después las guardadas en la app de Codex.
  function launchRoots() {
    return (lastState && lastState.launchRoots) || [];
  }

  function launchOptions(roots, recent, label) {
    var options = roots.filter(function (r) { return Boolean(r.recent) === recent; }).map(function (r) {
      return '<option value="' + escapeHtml(r.cwd) + '"' + (r.cwd === launch.cwd ? ' selected' : '') + '>' + escapeHtml(r.label) + '</option>';
    }).join('');
    return options ? '<optgroup label="' + label + '">' + options + '</optgroup>' : '';
  }

  function radio(name, value, current, label) {
    return '<label class="choice"><input type="radio" name="' + name + '" value="' + value + '"' +
      (value === current ? ' checked' : '') + '> ' + label + '</label>';
  }

  function renderLaunch() {
    queueMicrotask(syncSurfaceBackdrop);
    var box = $('new-session');
    box.hidden = !launch.open;
    if (!launch.open) return;
    var roots = launchRoots();
    if (!launch.cwd && roots.length) launch.cwd = roots[0].cwd;
    var chosen = roots.filter(function (r) { return r.cwd === launch.cwd; })[0];

    if (launch.mode === 'confirm') {
      box.innerHTML = '<div class="launch-head"><h2 class="section-title">Nueva sesión</h2><button class="btn" data-launch="cancel">Cerrar ×</button></div>' +
        '<p>Vas a abrir una sesión de <strong>' + AGENT_LABELS[launch.agent] + '</strong> en <strong>' +
        escapeHtml(chosen ? chosen.label : launch.cwd) + '</strong>:</p>' +
        '<blockquote>' + escapeHtml(launch.draft) + '</blockquote>' +
        '<p class="order-note">' + escapeHtml(lastState.orderModes[launch.perm]) + '</p>' +
        (launch.error ? '<p class="order-error">' + escapeHtml(launch.error) + '</p>' : '') +
        '<div class="order-actions">' +
        '<button class="btn btn-primary" data-launch="go"' + (launch.sending ? ' disabled' : '') + '>' + (launch.sending ? 'Lanzando…' : 'Lanzar') + '</button>' +
        '<button class="btn" data-launch="edit"' + (launch.sending ? ' disabled' : '') + '>Volver</button>' +
        '</div>';
      return;
    }

    box.innerHTML = '<div class="launch-head"><h2 class="section-title">Nueva sesión</h2><button class="btn" data-launch="cancel">Cerrar ×</button></div>' +
      '<div class="launch-grid">' +
      '<label class="field"><span>Proyecto</span><select id="launch-cwd">' +
      launchOptions(roots, true, 'Con actividad esta semana') +
      launchOptions(roots, false, 'Guardadas en la app de Codex') + '</select></label>' +
      '<div class="field"><span>Agente</span><div class="choices">' +
      radio('launch-agent', 'claude', launch.agent, 'Claude') + radio('launch-agent', 'codex', launch.agent, 'Codex') + '</div></div>' +
      '<div class="field"><span>Permisos</span><div class="choices">' +
      radio('launch-perm', 'auto', launch.perm, 'Auto') + radio('launch-perm', 'edit', launch.perm, 'Editar') + radio('launch-perm', 'plan', launch.perm, 'Solo mirar') + '</div></div>' +
      '</div>' +
      '<textarea id="launch-text" rows="3" maxlength="4000" placeholder="¿Qué tiene que hacer?">' + escapeHtml(launch.draft) + '</textarea>' +
      (launch.error ? '<p class="order-error">' + escapeHtml(launch.error) + '</p>' : '') +
      '<div class="order-actions">' +
      '<button class="btn btn-primary" data-launch="review">Revisar</button>' +
      '<button class="btn" data-launch="cancel">Cancelar</button>' +
      micButton('launch-text') +
      '</div>';
    paintMicButtons();
  }

  function handleLaunchChange(event) {
    var t = event.target;
    if (t.id === 'launch-cwd') launch.cwd = t.value;
    else if (t.name === 'launch-agent') launch.agent = t.value;
    else if (t.name === 'launch-perm') launch.perm = t.value;
    else if (t.id === 'launch-text') launch.draft = t.value;
  }

  function handleLaunchClick(event) {
    var action = event.target.getAttribute && event.target.getAttribute('data-launch');
    if (!action) return;
    if (action === 'cancel') {
      launch.open = false;
    } else if (action === 'review') {
      launch.draft = $('launch-text').value.trim();
      if (!launch.draft || !launch.cwd) return;
      launch.mode = 'confirm';
      launch.error = null;
    } else if (action === 'edit') {
      launch.mode = 'edit';
      launch.error = null;
    } else if (action === 'go') {
      launch.sending = true;
      launch.error = null;
      postJson('/api/sessions', { agent: launch.agent, cwd: launch.cwd, mode: launch.perm, text: launch.draft })
        .then(function (result) {
          launch = { open: false, mode: 'edit', agent: launch.agent, perm: launch.perm, cwd: launch.cwd, draft: '', sending: false, error: null };
          renderLaunch();
          window.Office.select(result.sessionId);
          refresh();
        })
        .catch(function (error) {
          launch.sending = false;
          launch.error = error.message;
          renderLaunch();
        });
    }
    renderLaunch();
  }

  // Dictado: el navegador graba y el servidor lo pasa a texto con mlx-whisper en este Mac.
  // El texto se añade al cuadro; las órdenes siguen pasando por "Revisar".

  var MIC_MAX_MS = 2 * 60 * 1000;
  var MIC_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];
  var MIC_ICON =
    '<svg viewBox="0 0 8 8" aria-hidden="true"><rect x="3" y="0" width="2" height="5"/><rect x="2" y="1" width="1" height="3"/>' +
    '<rect x="5" y="1" width="1" height="3"/><rect x="1" y="3" width="1" height="2"/><rect x="6" y="3" width="1" height="2"/>' +
    '<rect x="2" y="5" width="4" height="1"/><rect x="3.5" y="6" width="1" height="1"/><rect x="2" y="7" width="4" height="1"/></svg>';
  var MIC_LABELS = { idle: 'Dictar', recording: 'Parar y transcribir', transcribing: 'Transcribiendo…' };

  var mic = { target: null, sessionId: null, state: 'idle', recorder: null, stream: null, timer: null, since: null, tick: null };
  var MIC_PHASES = {
    opening: 'Abriendo el micrófono…',
    recording: 'Grabando · toca el micro para terminar',
    transcribing: 'Transcribiendo lo que has dicho…'
  };

  function canDictate() {
    return Boolean(lastState && lastState.canDictate && window.MediaRecorder &&
      navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  }

  function micButton(targetId) {
    if (!canDictate()) return '';
    return '<button type="button" class="btn mic" data-mic="' + targetId + '">' + MIC_ICON + '</button>';
  }

  // Los cuadros se repintan solos, así que el estado del micro se aplica después a cada botón.
  function paintMicButtons() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-mic]'), function (button) {
      var mine = mic.target === button.getAttribute('data-mic');
      var state = mine ? mic.state : 'idle';
      button.className = 'btn mic is-' + state;
      button.disabled = state === 'transcribing' || (!mine && mic.state !== 'idle');
      button.setAttribute('aria-label', MIC_LABELS[state]);
      button.title = MIC_LABELS[state];
    });
    paintMicStatus();
  }

  // Bajo el cuadro que dicta, en qué paso va y cuánto lleva: al pulsar parar, la transcripción
  // tarda unos segundos y sin esto no se veía nada hasta que llegaba el texto.
  function paintMicStatus() {
    var button = mic.state !== 'idle' ? document.querySelector('[data-mic="' + mic.target + '"]') : null;
    var row = button ? button.closest('.order-compose') || button.parentNode : null;
    Array.prototype.forEach.call(document.querySelectorAll('.mic-status'), function (el) {
      if (!row || el.previousElementSibling !== row) el.remove();
    });
    Array.prototype.forEach.call(document.querySelectorAll('textarea.is-transcribing'), function (el) {
      el.classList.remove('is-transcribing');
      el.removeAttribute('aria-busy');
    });
    if (!row) return;
    var box = $(mic.target);
    if (box && mic.state === 'transcribing') {
      box.classList.add('is-transcribing');
      box.setAttribute('aria-busy', 'true');
    }
    var phase = mic.state === 'recording' && !mic.since ? 'opening' : mic.state;
    var status = row.nextElementSibling && row.nextElementSibling.classList.contains('mic-status') ? row.nextElementSibling : null;
    if (!status) {
      status = document.createElement('p');
      status.className = 'mic-status';
      status.setAttribute('role', 'status');
      row.parentNode.insertBefore(status, row.nextSibling);
    }
    // Solo se reescribe la frase al cambiar de paso; el contador va aparte para no repetirla en voz.
    if (status.getAttribute('data-phase') !== phase) {
      status.setAttribute('data-phase', phase);
      status.innerHTML = '<span class="mic-status-mark" aria-hidden="true"></span><span>' + MIC_PHASES[phase] + '</span>' +
        '<span class="mic-status-time" aria-hidden="true"></span>';
    }
    var seconds = mic.since ? Math.floor((Date.now() - mic.since) / 1000) : 0;
    status.lastChild.textContent = mic.since ? Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0') : '';
  }

  function micPhase(state) {
    mic.state = state;
    mic.since = state === 'transcribing' ? Date.now() : null;
    clearInterval(mic.tick);
    mic.tick = state === 'idle' ? null : setInterval(paintMicStatus, 1000);
    paintMicButtons();
  }

  function micToast(message) {
    var toast = $('mic-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'mic-toast';
      toast.className = 'mic-toast';
      toast.setAttribute('role', 'status');
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.hidden = false;
    clearTimeout(micToast.timer);
    micToast.timer = setTimeout(function () { toast.hidden = true; }, 5000);
  }

  function micType() {
    if (!window.MediaRecorder.isTypeSupported) return '';
    return MIC_TYPES.filter(function (type) { return window.MediaRecorder.isTypeSupported(type); })[0] || '';
  }

  function toggleMic(targetId) {
    if (mic.state === 'recording' && mic.target === targetId) {
      stopMic();
      return;
    }
    if (mic.state !== 'idle') return;
    mic.target = targetId;
    mic.sessionId = targetId === 'mission-text' ? (talk && talk.sessionId) : selection && selection.session ? selection.session.id : null;
    micPhase('recording');
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
      var type = micType();
      var recorder = type ? new window.MediaRecorder(stream, { mimeType: type }) : new window.MediaRecorder(stream);
      var chunks = [];
      mic.stream = stream;
      mic.recorder = recorder;
      recorder.ondataavailable = function (event) {
        if (event.data && event.data.size) chunks.push(event.data);
      };
      recorder.onstop = function () {
        releaseMic();
        uploadAudio(new Blob(chunks, { type: recorder.mimeType || type || 'audio/webm' }));
      };
      recorder.start();
      mic.since = Date.now();
      paintMicStatus();
      mic.timer = setTimeout(stopMic, MIC_MAX_MS);
    }).catch(function (error) {
      releaseMic();
      finishMic(error && error.name === 'NotAllowedError'
        ? 'El navegador no deja usar el micrófono.'
        : 'No he podido abrir el micrófono.');
    });
  }

  function stopMic() {
    if (!mic.recorder || mic.recorder.state === 'inactive') return;
    micPhase('transcribing');
    mic.recorder.stop();
  }

  function releaseMic() {
    clearTimeout(mic.timer);
    if (mic.stream) mic.stream.getTracks().forEach(function (track) { track.stop(); });
    mic.stream = null;
    mic.recorder = null;
  }

  function finishMic(message) {
    mic.target = null;
    micPhase('idle');
    if (message) micToast(message);
  }

  function uploadAudio(blob) {
    if (!blob.size) {
      finishMic('No se ha grabado nada.');
      return;
    }
    fetch('/api/transcribe', { method: 'POST', headers: { 'Content-Type': blob.type }, body: blob })
      .then(function (res) {
        return res.json().then(function (body) {
          if (!res.ok) throw new Error(body.error || 'HTTP ' + res.status);
          return body.text;
        });
      })
      .then(function (text) {
        var target = mic.target;
        var stale = target === 'mission-text' ? !talk || talk.sessionId !== mic.sessionId
          : target !== 'launch-text' && target !== 'inbox-text' && (!selection || selection.session.id !== mic.sessionId);
        finishMic(!text ? 'No he entendido nada en la grabación.' : stale ? 'Has cambiado de sesión; descarto el dictado.' : null);
        if (text && !stale) appendDictation(target, text);
      })
      .catch(function (error) {
        finishMic(error.message);
      });
  }

  function appendDictation(targetId, text) {
    var box = $(targetId);
    var current = box ? box.value : '';
    var value = current ? current.replace(/\s+$/, '') + ' ' + text : text;
    if (targetId === 'order-text') {
      compose.draft = value;
      orderKey = null;
      renderOrder();
    } else if (targetId === 'steer-text') {
      steer.draft = value;
      steerKey = null;
      renderSteer();
    } else if (targetId === 'inbox-text') {
      if (box) box.value = value;
      window.Inbox.dictated();
    } else if (targetId === 'mission-text') {
      talk.draft = value;
      talk.mode = 'write';
      renderTalk();
    } else {
      launch.draft = value;
      renderLaunch();
    }
    paintMicButtons();
    box = $(targetId);
    if (box) box.focus();
  }

  document.addEventListener('click', function (event) {
    var button = event.target.closest ? event.target.closest('[data-mic]') : null;
    if (button && !button.disabled) toggleMic(button.getAttribute('data-mic'));
  });

  // Hablar con la coordinadora desde Misiones: el mismo envío que la ficha (revisar y confirmar
  // siempre), con el dictado de la Bandeja. `talk` es null con el cuadro cerrado.
  var talk = null;
  var talkDrafts = {};

  function openTalk(sessionId, mode) {
    var found = findSessionById(sessionId);
    if (!found || found.session.desktopApp) return;
    if (talk && talk.sessionId !== sessionId) closeTalk();
    prepareSurface('talk');
    if (!talk || talk.sessionId !== sessionId) talk = { sessionId: sessionId, draft: talkDrafts[sessionId] || '', mode: 'write', sending: false, error: null };
    talk.mode = 'write';
    renderTalk();
    if (mode === 'mic' && canDictate()) {
      if (mic.state === 'idle') toggleMic('mission-text');
    } else {
      var box = $('mission-text');
      if (box) box.focus();
    }
  }

  function closeTalk() {
    if (talk) talkDrafts[talk.sessionId] = talk.draft;
    if (mic.target === 'mission-text' && mic.state === 'recording') stopMic();
    talk = null;
    renderTalk();
  }

  function renderTalk() {
    queueMicrotask(syncSurfaceBackdrop);
    var box = $('mission-compose');
    var found = talk ? findSessionById(talk.sessionId) : null;
    if (!talk || !found) {
      box.hidden = true;
      box.innerHTML = '';
      return;
    }
    var s = found.session;
    var to = '<p class="talk-to">Para <strong>' + escapeHtml(s.role === 'coordinator' ? 'la coordinadora' : 'la sesión') + '</strong> · ' +
      escapeHtml(found.project.name) + ' · ' + AGENT_LABELS[s.agent] + '</p>';
    var html = '<div class="talk-head">' + to + '<button type="button" class="btn" data-talk-action="close" aria-label="Cerrar">×</button></div>';
    var busy = (s.ownStatus || s.status) === 'working' && !(s.order && s.order.status === 'running' && s.order.canSteer);
    var appNote = '';
    if (talk.mode === 'confirm') {
      html += '<blockquote>' + escapeHtml(talk.draft) + '</blockquote>' + appNote +
        (talk.error ? '<p class="order-error">' + escapeHtml(talk.error) + '</p>' : '') +
        '<div class="order-actions">' +
        '<button class="btn btn-primary" data-talk-action="send"' + (talk.sending ? ' disabled' : '') + '>' + (talk.sending ? 'Enviando…' : 'Enviar') + '</button>' +
        '<button class="btn" data-talk-action="edit"' + (talk.sending ? ' disabled' : '') + '>Volver</button></div>';
    } else {
      html += (busy ? '<p class="order-note">Está trabajando; puedes dejarlo escrito y enviarlo cuando termine.</p>' : '') + appNote +
        '<div class="order-compose">' +
        '<textarea id="mission-text" rows="2" maxlength="4000" aria-label="Mensaje a la coordinadora" placeholder="Dile algo…">' + escapeHtml(talk.draft) + '</textarea>' +
        micButton('mission-text') +
        '<button class="btn btn-primary" data-talk-action="review"' + (busy ? ' disabled' : '') + '>Revisar</button></div>';
    }
    box.innerHTML = html;
    box.hidden = false;
    paintMicButtons();
  }

  function handleTalkClick(event) {
    var button = event.target.closest ? event.target.closest('[data-talk-action]') : null;
    if (!button || !talk) return;
    var action = button.getAttribute('data-talk-action');
    if (action === 'close') {
      closeTalk();
    } else if (action === 'review') {
      var box = $('mission-text');
      talk.draft = (box ? box.value : talk.draft).trim();
      if (!talk.draft) return;
      talk.mode = 'confirm';
      talk.error = null;
      renderTalk();
    } else if (action === 'edit') {
      talk.mode = 'write';
      renderTalk();
    } else if (action === 'send') {
      sendTalk();
    }
  }

  function sendTalk() {
    var sending = talk;
    var found = findSessionById(sending.sessionId);
    var s = found && found.session;
    if (!s) return;
    sending.sending = true;
    renderTalk();
    // Con una orden del panel en marcha, el mensaje entra como indicación; si no, como orden nueva.
    var steering = s.order && s.order.status === 'running' && s.order.canSteer;
    var url = '/api/sessions/' + encodeURIComponent(s.id) + (steering ? '/steer' : '/order');
    postJson(url, { text: sending.draft })
      .then(function () {
        delete talkDrafts[sending.sessionId];
        if (talk === sending) talk = null;
        renderTalk();
        micToast('Enviado a ' + (s.role === 'coordinator' ? 'la coordinadora' : 'la sesión') + ' de ' + found.project.name + '.');
        refresh();
      })
      .catch(function (error) {
        sending.sending = false;
        sending.error = error.message;
        if (talk === sending) renderTalk();
      });
  }

  // Lleva a una nota de la Bandeja y la resalta (la lista puede tardar en cargar).
  function revealNote(noteId, tries) {
    if (window.Inbox.showAll) window.Inbox.showAll();
    var card = document.querySelector('[data-note="' + noteId.replace(/"/g, '') + '"]');
    if (!card) {
      if (tries > 0) setTimeout(function () { revealNote(noteId, tries - 1); }, 300);
      return;
    }
    card.scrollIntoView({ block: 'center' });
    card.classList.add('is-revealed');
    setTimeout(function () { card.classList.remove('is-revealed'); }, 1600);
  }

  // Vistas

  var currentView = null;

  function readStoredView() {
    try {
      return window.localStorage.getItem('dashboard.view');
    } catch (e) {
      return null;
    }
  }

  // Vistas en las que se abre la ficha de una sesión (la hoja inferior o el panel lateral).
  function detailView() {
    return currentView === 'office' || currentView === 'missions';
  }

  function showView(view) {
    var previous = currentView;
    currentView = view === 'panel' || view === 'inbox' || view === 'missions' ? view : 'office';
    ['office', 'missions', 'panel', 'inbox'].forEach(function (name) {
      $('view-' + name).hidden = name !== currentView;
    });
    // La lista (antes la pestaña Panel) es otra forma de ver Misiones: su pestaña sigue marcada.
    var tabView = currentView === 'panel' ? 'missions' : currentView;
    ['office', 'missions', 'inbox'].forEach(function (name) {
      $('tab-' + name).setAttribute('aria-selected', String(name === tabView));
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-switch]'), function (button) {
      button.setAttribute('aria-pressed', String(button.getAttribute('data-switch') === currentView));
    });
    try {
      window.localStorage.setItem('dashboard.view', currentView);
    } catch (e) {
      // Sin almacenamiento: la vista no se recuerda.
    }
    // La ficha va con la vista que la abre: en Misiones se mueve a su sección para que se vea.
    var detail = $('office-detail');
    var home = currentView === 'missions' ? $('view-missions') : $('view-office');
    if (detail.parentNode !== home) home.appendChild(detail);
    if (previous !== currentView) {
      prepareSurface('none');
      if (previous === 'inbox' && window.Inbox.suspend) window.Inbox.suspend();
      document.body.classList.remove('usage-open');
      $('usage-toggle').setAttribute('aria-expanded', 'false');
      var active = document.activeElement;
      if (active && active.blur) active.blur();
    }
    if (currentView === 'office') {
      window.Office.start();
      if (lastState) window.Office.update(lastState);
    } else {
      window.Office.stop();
      if (currentView !== 'missions') stopLive();
      if (ambient.on) exitAmbient();
    }
    if (currentView !== 'missions' && talk) closeTalk();
    if (currentView === 'missions') {
      window.Missions.start();
      if (lastState) window.Missions.update(lastState);
    } else {
      window.Missions.stop();
    }
    scheduleAmbient();
    if (currentView === 'inbox' && lastState) window.Inbox.render(lastState);
  }

  function render(state) {
    var now = Date.now();
    renderTotals(state);
    renderUsage(state, now);
    renderNow(state, now);
    renderZones(state, now);
    $('capture-btn').hidden = !state.canOrder;
    renderInboxTab(state);
    if (currentView === 'office') window.Office.update(state);
    if (currentView === 'missions') {
      window.Missions.update(state);
      // La ficha abierta se refresca con el estado nuevo.
      if (selection) window.Office.update(state);
      // El cuadro para hablar sigue el estado de la sesión (si termina de trabajar, ya se puede enviar).
      if (talk && talk.mode === 'write' && !(document.activeElement && document.activeElement.id === 'mission-text')) renderTalk();
    }
    if (currentView === 'inbox') window.Inbox.render(state);
    $('updated').textContent = 'Actualizado ' + new Date(state.generatedAt).toLocaleTimeString('es-ES');
    // Versión, rama y commit de la carpeta que sirve el panel
    var build = state.build || {};
    var parts = [];
    if (build.version) parts.push('v' + build.version);
    if (build.branch) parts.push(build.branch);
    if (build.commit) parts.push(build.commit);
    $('version').textContent = parts.length ? parts.join(' · ') + '  ·  ' : '';
  }

  // La bandeja solo aparece para quien puede mandar órdenes: las notas pueden nombrar clientes.
  function renderInboxTab(state) {
    var tab = $('tab-inbox');
    tab.hidden = !state.canOrder;
    if (tab.hidden && currentView === 'inbox') showView('office');
    var count = window.Inbox.count(state);
    $('inbox-badge').hidden = !count;
    $('inbox-badge').textContent = count;
  }

  // Aviso cuando aparece algo que te toca: más sesiones esperándote o más aprobaciones pendientes.
  function alertCounts(state) {
    var counts = { yours: 0, approvals: 0 };
    (state.projects || []).forEach(function (project) {
      project.sessions.forEach(function (s) {
        if (s.status === 'yours') counts.yours += 1;
        if (s.order && s.order.approvals) counts.approvals += s.order.approvals.length;
      });
    });
    return counts;
  }

  // Sin datos anteriores (primera carga) no se avisa.
  function alertIncreased(previous, next) {
    return Boolean(previous) && (next.yours > previous.yours || next.approvals > previous.approvals);
  }

  var lastAlert = null;

  // Vibración corta donde exista (Safari de iOS no la tiene) y destello del botón «te esperan».
  function notifyArrival() {
    try {
      if (navigator.vibrate) navigator.vibrate(60);
    } catch (e) {
      // Sin vibración: queda el destello.
    }
    window.Office.flashQueue();
  }

  // Modo ambiente (tablet apoyada): tras un rato sin tocar, solo la oficina y el reloj, la pantalla
  // encendida y la cámara paseando entre los puestos con actividad. Cualquier toque o tecla lo despierta.
  var AMBIENT_MS = 60000;
  var ambient = { on: false, enabled: readAmbientSetting(), timer: 0, lock: null, swallowUntil: 0, lastMove: 0 };

  function readAmbientSetting() {
    try {
      return window.localStorage.getItem('dashboard.ambient') !== 'off';
    } catch (e) {
      return true;
    }
  }

  function ambientAllowed() {
    return ambient.enabled && currentView === 'office' && window.innerWidth >= 761 && !document.hidden;
  }

  function scheduleAmbient() {
    window.clearTimeout(ambient.timer);
    if (!ambient.on && ambientAllowed()) ambient.timer = window.setTimeout(enterAmbient, AMBIENT_MS);
  }

  function requestWakeLock() {
    if (!navigator.wakeLock || !navigator.wakeLock.request) return;
    try {
      navigator.wakeLock.request('screen').then(function (lock) {
        if (ambient.on) ambient.lock = lock;
        else lock.release().catch(function () {});
      }).catch(function () {});
    } catch (e) {
      // Sin permiso o sin soporte: la pantalla se apagará cuando diga el sistema.
    }
  }

  function enterAmbient() {
    if (ambient.on || !ambientAllowed()) return;
    var active = document.activeElement;
    if (active && (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT' || active.tagName === 'SELECT')) {
      scheduleAmbient();
      return;
    }
    ambient.on = true;
    document.body.classList.add('is-ambient');
    if (lastState) window.Office.update(lastState);
    requestWakeLock();
    window.Office.ambient(true);
  }

  function exitAmbient() {
    if (!ambient.on) return;
    ambient.on = false;
    document.body.classList.remove('is-ambient');
    window.Office.ambient(false);
    if (ambient.lock) ambient.lock.release().catch(function () {});
    ambient.lock = null;
    if (lastState && currentView === 'office') window.Office.update(lastState);
  }

  // Despertar no selecciona nada: el toque que despierta (y su clic) no llega a la oficina.
  function handleActivity(event) {
    if (event.type === 'pointermove') {
      if (event.pointerType !== 'mouse' || event.timeStamp - ambient.lastMove < 500) return;
      ambient.lastMove = event.timeStamp;
    }
    if (ambient.on) {
      exitAmbient();
      if (event.type === 'pointerdown' || event.type === 'keydown') {
        event.preventDefault();
        event.stopPropagation();
        ambient.swallowUntil = Date.now() + 700;
      }
    }
    scheduleAmbient();
  }

  function setAmbientEnabled(enabled) {
    ambient.enabled = enabled;
    try {
      window.localStorage.setItem('dashboard.ambient', enabled ? 'on' : 'off');
    } catch (e) {
      // Sin almacenamiento: vale para esta visita.
    }
    renderAmbientToggle();
    scheduleAmbient();
  }

  function renderAmbientToggle() {
    var button = $('ambient-toggle');
    if (!button) return;
    button.textContent = 'Ambiente: ' + (ambient.enabled ? 'sí' : 'no');
    button.setAttribute('aria-pressed', String(ambient.enabled));
  }

  function setupAmbient() {
    var toolbar = document.querySelector('.office-toolbar');
    if (toolbar) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn ambient-toggle';
      button.id = 'ambient-toggle';
      button.title = 'Tras un minuto sin tocar, solo la oficina y el reloj, con la pantalla encendida';
      button.addEventListener('click', function () { setAmbientEnabled(!ambient.enabled); });
      toolbar.appendChild(button);
      renderAmbientToggle();
    }
    ['pointerdown', 'keydown', 'pointermove'].forEach(function (type) {
      window.addEventListener(type, handleActivity, true);
    });
    window.addEventListener('wheel', handleActivity, { capture: true, passive: true });
    window.addEventListener('click', function (event) {
      if (Date.now() >= ambient.swallowUntil) return;
      ambient.swallowUntil = 0;
      event.preventDefault();
      event.stopPropagation();
    }, true);
    window.addEventListener('resize', function () {
      if (ambient.on && !ambientAllowed()) exitAmbient();
      scheduleAmbient();
    });
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && ambient.on) requestWakeLock();
      scheduleAmbient();
    });
  }

  function refresh() {
    fetch('/api/state', { cache: 'no-store' })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (state) {
        var counts = alertCounts(state);
        if (alertIncreased(lastAlert, counts)) notifyArrival();
        lastAlert = counts;
        lastState = state;
        $('offline').hidden = true;
        render(state);
      })
      .catch(function () {
        $('offline').hidden = false;
        if (lastState) render(lastState);
      });
  }

  Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (tab) {
    tab.addEventListener('click', function () { showView(tab.getAttribute('data-view')); });
  });

  $('office-detail').addEventListener('click', handleOrderClick);
  $('usage-toggle').addEventListener('click', toggleUsage);
  setupSheet();
  setupKeyboard();
  // Una recarga conserva el estado del historial, pero la ficha empieza cerrada.
  if (window.history.replaceState && window.history.state && window.history.state.detail) window.history.replaceState(null, '');
  window.addEventListener('popstate', applyHistory);
  $('office-detail').addEventListener('scroll', function (event) {
    if (event.target.id !== 'chat-list') return;
    var list = event.target;
    live.following = list.scrollHeight - list.scrollTop - list.clientHeight < 48;
    renderLive();
  }, true);
  document.addEventListener('visibilitychange', function () {
    // En segundo plano la oficina no se anima: en el iPhone gasta batería sin que nadie la vea.
    if (document.hidden) {
      stopLive();
      window.Office.stop();
    } else {
      if (currentView === 'office') window.Office.start();
      if (selection && selection.session) startLive(selection.session);
    }
  });
  window.addEventListener('pagehide', stopLive);
  document.addEventListener('keydown', function (event) {
    if (event.key !== 'Escape') return;
    if (talk) closeTalk();
    else if (launch.open) { launch.open = false; renderLaunch(); }
    else if (selection) window.Office.select(null);
  });
  $('new-session').addEventListener('click', handleLaunchClick);
  $('new-session').addEventListener('change', handleLaunchChange);
  $('new-session').addEventListener('input', handleLaunchChange);
  // Nueva sesión ya no es una pestaña: se abre desde la Bandeja o desde la ficha de un proyecto.
  function openLaunch() {
    showView('office');
    prepareSurface('launch');
    launch.open = true;
    launch.mode = 'edit';
    renderLaunch();
  }
  // Apuntar: la Bandeja con el cuadro listo para escribir o dictar.
  $('capture-btn').addEventListener('click', function () {
    showView('inbox');
    var box = $('inbox-text');
    if (box) box.focus();
  });
  Array.prototype.forEach.call(document.querySelectorAll('[data-switch]'), function (button) {
    button.addEventListener('click', function () { showView(button.getAttribute('data-switch')); });
  });
  $('office-detail').addEventListener('input', handleOrderInput);

  window.Inbox.mount({
    $: $,
    newSession: openLaunch,
    escapeHtml: escapeHtml,
    postJson: postJson,
    micButton: micButton,
    paintMicButtons: paintMicButtons,
    canDictate: canDictate,
    relativeTime: relativeTime,
    sprite: sprite,
    toast: micToast,
    state: function () { return lastState; },
    openSession: function (sessionId) {
      showView('office');
      selectWhenReady(sessionId, 5);
    },
    refreshState: refresh
  });

  window.Office.onInbox(function () { showView('inbox'); });
  window.Office.onFrame(officeCover);
  window.Office.onAction(handleMenuAction);

  // Misiones abre la misma ficha: la oficina guarda qué sesión está elegida aunque no se vea.
  window.Missions.mount($('missions'), {
    select: function (sessionId) {
      closeTalk();
      if (lastState) window.Office.update(lastState);
      window.Office.select(sessionId);
    },
    talk: openTalk,
    // Archivar es solo del panel y se deshace solo: la sesión vuelve si tiene actividad.
    archive: archiveSessions,
    note: function (noteId) {
      showView('inbox');
      revealNote(noteId, 10);
    }
  });
  $('mission-compose').addEventListener('click', handleTalkClick);
  $('mission-compose').addEventListener('input', function (event) {
    if (event.target.id === 'mission-text' && talk) talk.draft = event.target.value;
  });

  window.Office.mount($('office-canvas'), renderOfficeDetail).then(function () {
    if (lastState && currentView === 'office') window.Office.update(lastState);
  });
  setupAmbient();
  showView(readStoredView());

  renderClock();
  refresh();
  setInterval(renderClock, 1000);
  setInterval(refresh, REFRESH_MS);
})();
