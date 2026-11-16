// Bandeja de entrada. Sin optional chaining ni `??`: la tablet puede llevar un Chrome antiguo.
(function () {
  'use strict';

  var h = null; // utilidades de app.js: $, escapeHtml, postJson, micButton, paintMicButtons, relativeTime
  var data = { notes: [], projects: [] };
  var loaded = false;
  var inboxFilter = 'open';
  var noteOpen = {};
  var listKey = null;
  var editDrafts = {};
  var editing = null; // { id, project, title, description }
  var capture = { source: 'text', sending: false, error: null };
  var captureKey = null;
  var busy = {};
  var confirming = null; // { id, kind, sending, error }

  var KIND_LABELS = { gitlab: 'GitLab', github: 'GitHub', datask: 'Datask', session: 'una sesión' };
  // El buscador de Datask va aparte de `confirming` para que escribir no repinte la tarjeta.
  var dataskSearch = { q: '', results: [], timer: null };

  function mount(helpers) {
    h = helpers;
    var view = h.$('view-inbox');
    view.addEventListener('click', handleClick);
    view.addEventListener('input', handleInput);
    view.addEventListener('change', handleInput);
    view.addEventListener('toggle', function (event) {
      var target = event.target;
      if (!target.classList || !target.classList.contains('note-options')) return;
      var card = target.closest('[data-note]');
      if (card) noteOpen[card.getAttribute('data-note')] = target.open;
    }, true);
    view.addEventListener('keydown', function (event) {
      // Cmd/Ctrl + Enter apunta, como en cualquier cuadro de mensaje.
      if (event.target.id === 'inbox-text' && event.key === 'Enter' && (event.metaKey || event.ctrlKey)) submit();
    });
  }

  function load() {
    return fetch('/api/inbox', { cache: 'no-store' })
      .then(function (res) {
        return res.json().then(function (body) {
          if (!res.ok) throw new Error(body.error || 'HTTP ' + res.status);
          return body;
        });
      })
      .then(function (body) {
        data = body;
        loaded = true;
        renderList();
      })
      .catch(function (error) {
        h.$('inbox-list').innerHTML = '<p class="order-note">' + h.escapeHtml(error.message) + '</p>';
      });
  }

  function render(state) {
    var canOrder = Boolean(state && state.canOrder);
    var key = canOrder + '|' + h.canDictate() + '|' + capture.sending + '|' + capture.error;
    if (key !== captureKey) {
      captureKey = key;
      var box = h.$('inbox-capture');
      var draft = h.$('inbox-text') ? h.$('inbox-text').value : '';
      box.innerHTML = !canOrder
        ? '<p class="order-note">' + h.escapeHtml((state && state.orderBlockedReason) || 'La bandeja solo se abre desde este Mac o tu cuenta de Tailscale.') + '</p>'
        : '<div class="inbox-capture-head"><h2>¿Qué tienes en mente?</h2><p>Apúntalo por texto o voz. Después eliges dónde enviarlo.</p></div><div class="order-compose">' +
          '<textarea id="inbox-text" aria-label="Nueva nota para la bandeja" rows="2" maxlength="4000" placeholder="Apunta algo: una idea, un fallo, un encargo…">' + h.escapeHtml(draft) + '</textarea>' +
          h.micButton('inbox-text') +
          '<button class="btn btn-primary" data-inbox="add"' + (capture.sending ? ' disabled' : '') + '>' + (capture.sending ? 'Apuntando…' : 'Apuntar') + '</button>' +
          '</div>' +
          (capture.error ? '<p class="order-error">' + h.escapeHtml(capture.error) + '</p>' : '') +
          '<p class="inbox-capture-alt">¿Mejor encargarlo ya? <button type="button" class="link-btn" data-inbox="new-session">Abrir una sesión nueva</button></p>';
      h.paintMicButtons();
    }
    if (canOrder) load();
  }

  function projectByKey(key) {
    for (var i = 0; i < data.projects.length; i++) {
      if (data.projects[i].key === key) return data.projects[i];
    }
    return null;
  }

  function renderList() {
    // No se repinta mientras corriges una nota: perderías lo que estás escribiendo.
    if (editing) return;
    var key = JSON.stringify(data.notes) + JSON.stringify(busy) + JSON.stringify(confirming) + inboxFilter;
    if (key === listKey) return;
    listKey = key;
    var box = h.$('inbox-list');
    if (!data.notes.length) {
      box.innerHTML = '<div class="inbox-empty"><p><strong>Nada pendiente.</strong></p>' +
        '<p class="order-note">Apunta arriba lo que se te ocurra, por voz o por escrito. Al momento tendrás un plan con el proyecto y el título, listo para revisar.</p></div>';
      return;
    }
    var active = document.activeElement;
    var focusedId = active && box.contains(active) ? active.id : null;
    var start = focusedId && active.selectionStart;
    var end = focusedId && active.selectionEnd;
    var now = Date.now();
    var counts = { open: 0, sent: 0 };
    data.notes.forEach(function (note) { counts[note.status === 'sent' ? 'sent' : 'open']++; });
    var filters = [{ id: 'all', label: 'Todas', count: data.notes.length }, { id: 'open', label: 'Pendientes', count: counts.open }, { id: 'sent', label: 'Enviadas', count: counts.sent }];
    var shown = filterNotes(data.notes, inboxFilter);
    box.innerHTML = '<div class="inbox-filters" role="group" aria-label="Filtrar notas">' + filters.map(function (f) {
      return '<button class="btn" data-inbox="filter" data-filter="' + f.id + '" aria-pressed="' + (inboxFilter === f.id) + '">' + f.label + ' <span>' + f.count + '</span></button>';
    }).join('') + '</div><p class="inbox-list-label">' + (inboxFilter === 'sent' ? 'Enviadas · seguimiento' : inboxFilter === 'open' ? 'Pendientes de decidir' : 'Tus notas') + '</p>' +
      (shown.length ? shown.map(function (note) { return renderNote(note, now); }).join('') : '<div class="inbox-empty">' + (inboxFilter === 'sent' ? 'Todavía no has enviado ninguna nota.' : 'No quedan notas pendientes.') + '</div>');
    var restored = focusedId && h.$(focusedId);
    if (restored) {
      restored.focus({ preventScroll: true });
      if (typeof start === 'number' && restored.setSelectionRange) restored.setSelectionRange(start, end);
    }
  }

  function filterNotes(notes, filter) {
    return notes.filter(function (note) { return filter === 'all' || (filter === 'sent' ? note.status === 'sent' : note.status !== 'sent'); });
  }

  function renderNote(note, now) {
    var plan = note.plan || {};
    var pending = plan.state === 'pending';
    var project = plan.project ? projectByKey(plan.project) : null;
    var title = pending ? note.text : (plan.title || note.text);
    var html = '<article class="note' + (pending ? ' is-pending' : '') + '" data-note="' + h.escapeHtml(note.id) + '">' +
      '<div class="note-head">' +
      '<h3 class="note-title">' + h.escapeHtml(title) + '</h3>' +
      '<span class="note-meta">' + h.relativeTime(note.createdAt, now) + ' · ' + (note.source === 'voice' ? 'voz' : 'texto') + '</span>' +
      '</div>';

    if (pending) {
      html += '<p class="note-planning">' + h.sprite('working') + ' Preparando el plan…</p>';
    } else {
      html += '<div class="note-plan">' +
        '<div class="note-project">' + projectChip(project, plan.project) +
        '<span class="note-state' + (!project ? ' needs-project' : '') + '">' +
        (note.status === 'sent' ? 'Enviada' : !project ? 'Elige proyecto' : 'Por enviar') + '</span></div>' +
        renderCandidates(plan) +
        (plan.error ? '<p class="note-reason is-warn">' + h.escapeHtml(plan.error) + '</p>' : '') +
        (plan.description && !sameText(plan.description, title) ? '<p class="note-preview">' + h.escapeHtml(plan.description.slice(0, 180)) + (plan.description.length > 180 ? '…' : '') + '</p>' : '') +
        '</div>' + renderSent(note) + renderDestinations(note, project);
    }

    if (confirming && confirming.id === note.id) return html + '</article>';
    html += '<details class="note-options"' + (noteOpen[note.id] ? ' open' : '') + '><summary>Detalles y opciones</summary><div class="note-options-body">' +
      (plan.description && !sameText(plan.description, title) ? '<p class="note-desc">' + h.escapeHtml(plan.description) + '</p>' : '') +
      '<div class="note-original"><span>Lo que apuntaste</span><p>' + h.escapeHtml(note.text) + '</p></div>' +
      (plan.reason ? '<p class="note-reason">' + h.escapeHtml(plan.reason) + '</p>' : '') +
      '<div class="order-actions">' +
      (pending ? '' : '<button class="btn btn-small" data-inbox="edit">Corregir nota</button>') +
      '<button class="btn btn-small" data-inbox="replan"' + (pending || busy[note.id] ? ' disabled' : '') + '>Volver a proponer</button>' +
      '<button class="btn btn-small" data-inbox="archive"' + (busy[note.id] ? ' disabled' : '') + '>Archivar</button>' +
      '</div></div></details></article>';
    return html;
  }

  // Sin proyecto claro, los candidatos que propone Haiku se eligen con un toque.
  function renderCandidates(plan) {
    if (plan.project || !plan.candidates || !plan.candidates.length) return '';
    return '<div class="note-candidates"><span>¿Es…?</span>' + plan.candidates.map(function (key) {
      var p = projectByKey(key);
      if (!p) return '';
      return '<button class="btn btn-small note-candidate" data-inbox="choose" data-project="' + h.escapeHtml(key) + '">' +
        h.escapeHtml(p.name) + '</button>';
    }).join('') + '</div>';
  }

  function renderSent(note) {
    if (!note.sentTo || !note.sentTo.length) return '';
    return '<ul class="note-sent">' + note.sentTo.map(function (sent) {
      if (sent.kind === 'session') {
        return '<li>Sesión lanzada · <button class="note-link" data-inbox="open-session" data-session="' + h.escapeHtml(sent.sessionId) + '">' +
          h.escapeHtml(sent.ref) + '</button></li>';
      }
      return '<li>' + (sent.closed ? 'Cerrada en ' : 'Enviada a ') + (KIND_LABELS[sent.kind] || sent.kind) + ' · ' +
        (sent.url ? '<a href="' + h.escapeHtml(sent.url) + '" target="_blank" rel="noopener">' + h.escapeHtml(sent.ref) + '</a>' : h.escapeHtml(sent.ref)) +
        '</li>';
    }).join('') + '</ul>';
  }

  function renderDestinations(note, project) {
    if (confirming && confirming.id === note.id) return renderConfirm(note, project);
    var sentKinds = (note.sentTo || []).map(function (sent) { return sent.kind; });
    // Sin proyecto del panel solo queda Datask, que no necesita repo.
    var available = project ? project.destinations || [] : (data.projects.length && data.projects[0].destinations.indexOf('datask') !== -1 ? ['datask'] : []);
    var kinds = available.filter(function (kind) { return sentKinds.indexOf(kind) === -1; });
    if (!project && !kinds.length) return '<button class="btn" data-inbox="edit">Elegir proyecto</button>';
    if (!kinds.length) {
      return sentKinds.length ? '' : '<p class="note-reason">Este proyecto no tiene un repo de GitLab o GitHub al que mandar issues.</p>';
    }
    return (!project ? '<button class="btn" data-inbox="edit">Elegir proyecto</button>' : '') + '<div class="note-destinations" aria-label="Enviar nota">' + kinds.map(function (kind) {
      return '<button class="btn btn-small" data-inbox="confirm" data-kind="' + kind + '">' +
        (kind === 'datask' ? 'Tarea en Datask' : kind === 'session' ? 'Lanzar sesión' : 'Issue en ' + KIND_LABELS[kind]) + '</button>';
    }).join('') + '</div>';
  }

  // Lo mismo que se va a crear, sin resumir: destino, título y descripción.
  function renderConfirm(note, project) {
    var plan = note.plan || {};
    var description = plan.description || note.text;
    var isDatask = confirming.kind === 'datask';
    if (confirming.kind === 'session') return renderSessionConfirm(project);
    return '<div class="note-confirm">' +
      (isDatask ? renderDataskChoice()
        : '<p>Vas a crear un <strong>issue en ' + KIND_LABELS[confirming.kind] + '</strong> en <strong>' +
          h.escapeHtml(project.repo ? project.repo.path : project.name) + '</strong>, asignado a ti:</p>') +
      '<p class="note-confirm-title">' + h.escapeHtml(plan.title) + '</p>' +
      '<blockquote>' + h.escapeHtml(description) + '</blockquote>' +
      (confirming.error ? '<p class="order-error">' + h.escapeHtml(confirming.error) + '</p>' : '') +
      '<div class="order-actions">' +
      '<button class="btn btn-primary btn-small" data-inbox="send"' + (confirming.sending || (isDatask && !confirming.projectId) ? ' disabled' : '') + '>' +
      (confirming.sending ? 'Creando…' : isDatask ? 'Crear tarea' : 'Crear issue') + '</button>' +
      '<button class="btn btn-small" data-inbox="unconfirm"' + (confirming.sending ? ' disabled' : '') + '>Volver</button>' +
      '</div></div>';
  }

  // El encargo lo escribe el servidor (cita el issue si lo hay); aquí se enseña tal cual se mandará.
  function renderSessionConfirm(project) {
    var agent = confirming.agent || 'claude';
    var mode = confirming.mode || 'auto';
    var radio = function (name, value, label, current) {
      return '<label class="choice"><input type="radio" name="' + name + '" value="' + value + '"' +
        (value === current ? ' checked' : '') + '> ' + label + '</label>';
    };
    // Los mismos niveles que «Nueva sesión»: Auto (por defecto, como las apps), Editar o Solo mirar.
    var modes = (h.state() && h.state().orderModes) || {};
    return '<div class="note-confirm">' +
      '<p>Vas a abrir una <strong>sesión nueva</strong> en <strong>' + h.escapeHtml(project.name) + '</strong> con este encargo:</p>' +
      '<div class="choices">' + radio('session-agent', 'claude', 'Claude', agent) + radio('session-agent', 'codex', 'Codex', agent) + '</div>' +
      '<div class="choices">' + radio('session-mode', 'auto', 'Auto', mode) + radio('session-mode', 'edit', 'Editar', mode) + radio('session-mode', 'plan', 'Solo mirar', mode) + '</div>' +
      (modes[mode] ? '<p class="order-note">' + h.escapeHtml(modes[mode]) + '</p>' : '') +
      '<blockquote>' + (confirming.preview === undefined ? 'Preparando el encargo…' : h.escapeHtml(confirming.preview)) + '</blockquote>' +
      (confirming.error ? '<p class="order-error">' + h.escapeHtml(confirming.error) + '</p>' : '') +
      '<div class="order-actions">' +
      '<button class="btn btn-primary btn-small" data-inbox="send"' + (confirming.sending || confirming.preview === undefined ? ' disabled' : '') + '>' +
      (confirming.sending ? 'Lanzando…' : 'Lanzar') + '</button>' +
      '<button class="btn btn-small" data-inbox="unconfirm"' + (confirming.sending ? ' disabled' : '') + '>Volver</button>' +
      '</div></div>';
  }

  function loadSessionPreview(id) {
    var request = confirming;
    h.postJson('/api/inbox/' + encodeURIComponent(id) + '/send', { kind: 'session', preview: true })
      .then(function (body) {
        if (!confirming || confirming !== request) return;
        confirming.preview = body.preview;
        renderList();
      })
      .catch(function (error) {
        if (!confirming || confirming !== request) return;
        confirming.error = error.message;
        renderList();
      });
  }

  function renderDataskChoice() {
    if (!confirming.options) return '<p>Buscando el proyecto de Datask…</p>';
    var options = confirming.options.candidates;
    var picked = confirming.picked;
    var all = picked && !options.some(function (o) { return o.id === picked.id; }) ? [picked].concat(options) : options;
    return '<p>Vas a crear una <strong>tarea en Datask</strong>, en la lista TODO del proyecto y asignada a ti:</p>' +
      (confirming.options.rememberedClosed ? '<p class="note-reason is-warn">El proyecto que usaste la última vez está cerrado. Elige otro.</p>' : '') +
      (all.length
        ? '<label class="field"><span>Proyecto de Datask</span><select id="datask-project">' + all.map(function (o) {
          return '<option value="' + o.id + '"' + (o.id === confirming.projectId ? ' selected' : '') + '>' +
            h.escapeHtml(o.code + ' · ' + o.name + (o.reason ? ' — ' + o.reason : '') + (o.tasks ? ' (' + o.tasks + ' tareas tuyas)' : '') + (o.closed ? ' · cerrado' : '')) +
            '</option>';
        }).join('') + '</select></label>'
        : '<p class="note-reason is-warn">No encuentro ningún proyecto de Datask para esta nota. Búscalo:</p>') +
      '<label class="field"><span>Buscar otro proyecto</span><input id="datask-search" placeholder="Código, nombre o cliente" value="' + h.escapeHtml(dataskSearch.q) + '"></label>' +
      '<div class="datask-results" id="datask-results">' + renderSearchResults() + '</div>';
  }

  function renderSearchResults() {
    return dataskSearch.results.map(function (p) {
      return '<button class="btn btn-small" data-inbox="pick" data-project="' + p.id + '">' +
        h.escapeHtml(p.code + ' · ' + p.name + (p.closed ? ' · cerrado' : '')) + '</button>';
    }).join('');
  }

  function loadDataskOptions(id) {
    var request = confirming;
    fetch('/api/inbox/' + encodeURIComponent(id) + '/datask', { cache: 'no-store' })
      .then(function (res) {
        return res.json().then(function (body) {
          if (!res.ok) throw new Error(body.error || 'HTTP ' + res.status);
          return body;
        });
      })
      .then(function (options) {
        if (!confirming || confirming !== request) return;
        confirming.options = options;
        var first = options.candidates[0];
        confirming.projectId = first && !(options.rememberedClosed && first.reason === 'recordado') ? first.id : null;
        renderList();
      })
      .catch(function (error) {
        if (!confirming || confirming !== request) return;
        confirming.options = { candidates: [], rememberedClosed: false };
        confirming.error = error.message;
        renderList();
      });
  }

  function searchDatask(q) {
    var search = dataskSearch;
    dataskSearch.q = q;
    clearTimeout(dataskSearch.timer);
    dataskSearch.timer = setTimeout(function () {
      if (q.trim().length < 2) {
        dataskSearch.results = [];
        paintResults();
        return;
      }
      fetch('/api/datask/search?q=' + encodeURIComponent(q.trim()), { cache: 'no-store' })
        .then(function (res) { return res.json(); })
        .then(function (body) {
          if (dataskSearch !== search || dataskSearch.q !== q) return;
          dataskSearch.results = body.projects || [];
          paintResults();
        });
    }, 300);
  }

  function paintResults() {
    var box = h.$('datask-results');
    if (box) box.innerHTML = renderSearchResults();
  }

  // Una descripción que solo repite el título no aporta nada.
  function sameText(a, b) {
    var clean = function (value) { return String(value || '').toLowerCase().replace(/[.\s]+$/, '').trim(); };
    return clean(a) === clean(b);
  }

  function projectChip(project, key) {
    if (project) {
      return '<span class="note-chip">' + h.escapeHtml(project.name) +
        (project.code ? ' · ' + h.escapeHtml(project.code) : '') + '</span>';
    }
    return '<span class="note-chip is-empty">' + (key ? 'Proyecto que ya no está' : 'Sin proyecto') + '</span>';
  }

  function renderEditor(note) {
    var plan = note.plan || {};
    var options = '<option value="">Sin proyecto</option>' + data.projects.slice().sort(function (a, b) {
      return a.name.localeCompare(b.name, 'es');
    }).map(function (p) {
      return '<option value="' + h.escapeHtml(p.key) + '"' + (p.key === editing.project ? ' selected' : '') + '>' +
        h.escapeHtml(p.name + (p.code ? ' · ' + p.code : '')) + '</option>';
    }).join('');
    return '<article class="note is-editing" data-note="' + h.escapeHtml(note.id) + '">' +
      '<label class="field"><span>Proyecto</span><select id="note-project">' + options + '</select></label>' +
      '<label class="field"><span>Título</span><input id="note-title" maxlength="200" value="' + h.escapeHtml(editing.title) + '"></label>' +
      '<label class="field"><span>Descripción</span><textarea id="note-description" rows="4" maxlength="4000">' + h.escapeHtml(editing.description) + '</textarea></label>' +
      '<details class="note-original"><summary>Lo que apuntaste</summary><p>' + h.escapeHtml(note.text) + '</p></details>' +
      '<div class="order-actions">' +
      '<button class="btn btn-primary btn-small" data-inbox="save">Guardar</button>' +
      '<button class="btn btn-small" data-inbox="cancel">Cancelar</button>' +
      '</div></article>';
  }

  function findNote(id) {
    for (var i = 0; i < data.notes.length; i++) {
      if (data.notes[i].id === id) return data.notes[i];
    }
    return null;
  }

  function replaceCard(id, html) {
    var card = document.querySelector('[data-note="' + id + '"]');
    if (card) card.outerHTML = html;
  }

  function submit() {
    var text = h.$('inbox-text').value.trim();
    if (!text || capture.sending) return;
    capture.sending = true;
    capture.error = null;
    captureKey = null;
    render(h.state());
    h.postJson('/api/inbox', { text: text, source: capture.source })
      .then(function () {
        h.$('inbox-text').value = '';
        capture = { source: 'text', sending: false, error: null };
      })
      .catch(function (error) {
        capture.sending = false;
        capture.error = error.message;
      })
      .then(function () {
        captureKey = null;
        render(h.state());
        h.refreshState();
      });
  }

  function act(id, url, body) {
    busy[id] = true;
    renderList();
    return h.postJson(url, body)
      .catch(function (error) { h.toast(error.message); })
      .then(function () {
        delete busy[id];
        listKey = null;
        return load();
      })
      .then(h.refreshState);
  }

  function send(id, base) {
    if (!confirming || confirming.sending) return;
    var sending = confirming;
    confirming.sending = true;
    confirming.error = null;
    renderList();
    h.postJson(base + '/send', { kind: confirming.kind, projectId: confirming.projectId, agent: confirming.agent, mode: confirming.mode || 'auto' })
      .then(function () {
        if (confirming === sending) confirming = null;
        listKey = null;
        return load();
      })
      .catch(function (error) {
        if (confirming !== sending) { h.toast(error.message); return; }
        confirming.sending = false;
        confirming.error = error.message;
        renderList();
      })
      .then(h.refreshState);
  }

  function handleClick(event) {
    var button = event.target.closest ? event.target.closest('[data-inbox]') : null;
    var action = button && button.getAttribute('data-inbox');
    if (!action) return;
    if (action === 'filter') {
      suspend();
      inboxFilter = button.getAttribute('data-filter') || 'all';
      renderList();
      return;
    }
    if (action === 'add') {
      submit();
      return;
    }
    if (action === 'new-session') {
      h.newSession();
      return;
    }
    var card = event.target.closest('[data-note]');
    var id = card && card.getAttribute('data-note');
    var note = id && findNote(id);
    if (!note) return;
    var base = '/api/inbox/' + encodeURIComponent(id);
    if (action === 'edit') {
      var plan = note.plan || {};
      suspend();
      editing = editDrafts[id] || { id: id, project: plan.project || '', title: plan.title || note.text, description: plan.description || note.text };
      replaceCard(id, renderEditor(note));
    } else if (action === 'cancel') {
      if (editing) delete editDrafts[editing.id];
      editing = null;
      listKey = null;
      renderList();
    } else if (action === 'choose') {
      // Lo que dijiste en la nota («la app de sofá») queda como alias del proyecto para la próxima vez.
      var chosenPlan = note.plan || {};
      act(id, base, { project: event.target.getAttribute('data-project'), alias: chosenPlan.mention || undefined });
    } else if (action === 'save') {
      var before = note.plan || {};
      var patch = { project: editing.project || null, title: editing.title, description: editing.description };
      if (patch.project && !before.project && before.mention) patch.alias = before.mention;
      delete editDrafts[id];
      editing = null;
      act(id, base, patch);
    } else if (action === 'confirm') {
      suspend();
      var kind = event.target.getAttribute('data-kind');
      confirming = { id: id, kind: kind, sending: false, error: null, options: null, projectId: null, picked: null, agent: 'claude' };
      dataskSearch = { q: '', results: [], timer: null };
      renderList();
      if (kind === 'datask') loadDataskOptions(id);
      if (kind === 'session') loadSessionPreview(id);
    } else if (action === 'open-session') {
      h.openSession(event.target.getAttribute('data-session'));
    } else if (action === 'pick') {
      var pickedId = Number(event.target.getAttribute('data-project'));
      var picked = dataskSearch.results.filter(function (p) { return p.id === pickedId; })[0];
      confirming.picked = picked ? { id: picked.id, code: picked.code, name: picked.name, closed: picked.closed, reason: 'elegido en el buscador' } : null;
      confirming.projectId = pickedId;
      dataskSearch = { q: '', results: [], timer: null };
      renderList();
    } else if (action === 'unconfirm') {
      confirming = null;
      renderList();
    } else if (action === 'send') {
      send(id, base);
    } else if (action === 'replan') {
      act(id, base + '/plan');
    } else if (action === 'archive') {
      act(id, base, { status: 'archived' });
    }
  }

  function handleInput(event) {
    var t = event.target;
    if (t.id === 'datask-search' && event.type === 'input') searchDatask(t.value);
    if (t.id === 'datask-project' && confirming) confirming.projectId = Number(t.value);
    if (t.name === 'session-agent' && confirming) confirming.agent = t.value;
    if (t.name === 'session-mode' && confirming) {
      confirming.mode = t.value;
      renderList();
    }
    if (t.id === 'inbox-text' && event.type === 'input' && !t.value.trim()) capture.source = 'text';
    if (!editing) return;
    if (t.id === 'note-project') editing.project = t.value;
    else if (t.id === 'note-title') editing.title = t.value;
    else if (t.id === 'note-description') editing.description = t.value;
  }

  // Al cambiar de nota o pestaña se recoge el editor, sin perder su borrador.
  function suspend() {
    if (editing) editDrafts[editing.id] = editing;
    editing = null;
    confirming = null;
    clearTimeout(dataskSearch.timer);
    dataskSearch = { q: '', results: [], timer: null };
    listKey = null;
    renderList();
  }

  // El dictado añade texto al cuadro de apuntar: la nota queda marcada como de voz.
  function dictated() {
    capture.source = 'voice';
  }

  function count(state) {
    return (state && state.inboxOpen) || 0;
  }

  window.Inbox = { mount: mount, render: render, showAll: function () { if (inboxFilter !== 'all') { inboxFilter = 'all'; renderList(); } }, suspend: suspend, dictated: dictated, count: count, isLoaded: function () { return loaded; } };
})();
