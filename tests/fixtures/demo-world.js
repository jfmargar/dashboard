import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// Un Mac de mentira para enseñar el panel y sacar capturas sin títulos de clientes: HOME con proyectos
// inventados, sesiones de Claude y de Codex en todos los estados (trabajando, te espera, terminada y
// parada), una coordinadora con delegadas, uso de las dos ventanas y notas en la Bandeja.
// Las fechas son relativas al momento en que se genera, así que hay que regenerarlo antes de cada demo:
//   node tests/fixtures/demo-world.js [carpeta]   (por defecto ~/Library/Caches/dashboard-demo)
// La configuración `dashboard-demo` de .claude/launch.json lo hace sola y arranca el panel en el 4320.
// La carpeta no puede estar en /tmp: el panel trata esas rutas como chats sueltos.
export function buildDemoWorld(root, now = Date.now()) {
  rmSync(root, { recursive: true, force: true });
  const home = join(root, 'home');
  const data = join(root, 'data');
  mkdirSync(data, { recursive: true });
  const ago = (min) => new Date(now - min * 60000).toISOString();
  let count = 0;
  const uuid = () => `aaaaaaaa-bbbb-4ccc-8ddd-${(++count).toString(16).padStart(12, '0')}`;

  function repo(rel, remote) {
    const dir = join(home, 'Workspace', rel);
    mkdirSync(join(dir, '.git'), { recursive: true });
    writeFileSync(join(dir, '.git/HEAD'), 'ref: refs/heads/develop\n');
    writeFileSync(join(dir, '.git/config'), remote ? `[remote "origin"]\n\turl = ${remote}\n` : '[core]\n');
    return dir;
  }

  const tool = (name, input) => ({ type: 'tool_use', id: `toolu_${uuid()}`, name, input });
  const todos = (list, current) => tool('TodoWrite', {
    todos: list.map((content, i) => ({ content, status: i < current ? 'completed' : i === current ? 'in_progress' : 'pending' })),
  });
  const say = (text) => [{ type: 'text', text }];

  // rows: [{ who: 'user' | 'assistant', min, content, stop }]. Sin `stop` el turno sigue abierto.
  function claude(dir, title, rows) {
    const id = uuid();
    const projectDir = join(home, '.claude/projects', dir.replace(/[/.]/g, '-'));
    mkdirSync(projectDir, { recursive: true });
    const lines = [{ type: 'custom-title', customTitle: title, sessionId: id }];
    for (const row of rows) {
      const base = { cwd: dir, timestamp: ago(row.min), sessionId: id, gitBranch: 'develop' };
      if (row.who === 'user') lines.push({ ...base, type: 'user', message: { role: 'user', content: row.content } });
      else lines.push({ ...base, type: 'assistant', message: { role: 'assistant', model: 'claude-opus-5-5', stop_reason: row.stop ?? null, content: row.content } });
    }
    writeFileSync(join(projectDir, `${id}.jsonl`), lines.map((line) => JSON.stringify(line)).join('\n') + '\n');
    return id;
  }

  // Ficha de la app de escritorio: así se enlazan coordinadora y delegadas (`spawnedFrom`).
  function desktop(cliId, title, parentLocal) {
    const dir = join(home, 'Library/Application Support/Claude/claude-code-sessions/cuenta/org');
    mkdirSync(dir, { recursive: true });
    const local = `local_${cliId.slice(-6)}`;
    writeFileSync(join(dir, `${local}.json`), JSON.stringify({
      sessionId: local, cliSessionId: cliId, title, ...(parentLocal ? { spawnedFrom: { sessionId: parentLocal } } : {}),
    }));
    return local;
  }

  const recetas = repo('Personal/Recetas', 'https://github.com/demo/recetas.git');
  const blog = repo('Personal/Blog', 'https://github.com/demo/blog.git');
  const huerto = repo('Personal/Huerto', 'https://github.com/demo/huerto.git');
  const parking = repo('Trabajo/Parking', 'git@gitlab.example.com:demo/parking.git');
  const reservas = repo('Trabajo/Reservas', 'git@gitlab.example.com:demo/reservas.git');
  const fichajes = repo('Trabajo/Fichajes', 'git@gitlab.example.com:demo/fichajes.git');
  const notas = repo('Personal/Notas', null);
  const fotos = repo('Personal/Fotos', null);

  // Recetas: una coordinadora trabajando con dos delegadas.
  const coordinator = claude(recetas, 'Épica: lista de la compra', [
    { who: 'user', min: 40, content: 'Coordina la épica de la lista de la compra con dos delegadas.' },
    { who: 'assistant', min: 30, content: [todos(['Revisar el modelo de recetas', 'Añadir búsqueda por ingrediente', 'Lista de la compra', 'Pruebas', 'Publicar en TestFlight'], 2)] },
    { who: 'assistant', min: 2, content: [tool('Agent', { description: 'Esperando a las delegadas' })] },
  ]);
  const coordinatorLocal = desktop(coordinator, 'Épica: lista de la compra');
  const search = claude(recetas, '#14 Búsqueda por ingrediente', [
    { who: 'user', min: 25, content: 'Trabaja en el issue #14.' },
    { who: 'assistant', min: 20, content: [todos(['Leer el issue', 'Índice de ingredientes', 'Filtro en la lista', 'Pruebas'], 2)] },
    { who: 'assistant', min: 1, content: [tool('Edit', { file_path: join(recetas, 'src/SearchView.swift') })] },
  ]);
  desktop(search, '#14 Búsqueda por ingrediente', coordinatorLocal);
  const share = claude(recetas, '#15 Compartir la lista', [
    { who: 'user', min: 25, content: 'Trabaja en el issue #15.' },
    { who: 'assistant', min: 15, content: [todos(['Leer el issue', 'Hoja de compartir', 'Formato de texto'], 1)] },
    { who: 'assistant', min: 6, content: say('Tengo dos opciones para compartir: texto plano o un enlace a la web. ¿Cuál prefieres?'), stop: 'end_turn' },
  ]);
  desktop(share, '#15 Compartir la lista', coordinatorLocal);

  claude(blog, 'Artículo sobre Tailscale', [
    { who: 'user', min: 50, content: 'Escribe un borrador sobre cómo uso Tailscale en casa.' },
    { who: 'assistant', min: 45, content: [todos(['Esquema', 'Borrador', 'Imágenes', 'Revisión'], 3)] },
    { who: 'assistant', min: 12, content: say('El borrador está en posts/tailscale.md. ¿Lo publico o prefieres revisarlo antes?'), stop: 'end_turn' },
  ]);
  claude(reservas, 'Pantalla de confirmación', [
    { who: 'user', min: 30, content: 'Rehaz la pantalla de confirmación de la reserva.' },
    { who: 'assistant', min: 20, content: [todos(['Diseño', 'Vista en Compose', 'Vista en SwiftUI', 'Pruebas', 'Capturas'], 3)] },
    { who: 'assistant', min: 1, content: [tool('Bash', { command: './gradlew test' })] },
  ]);
  claude(fichajes, 'Exportar a CSV', [
    { who: 'user', min: 90, content: 'Añade la exportación de fichajes a CSV.' },
    { who: 'assistant', min: 70, content: [todos(['Consulta', 'Formato CSV', 'Botón de exportar', 'Pruebas'], 4)] },
    { who: 'assistant', min: 35, content: say('Listo: la exportación funciona y los tests pasan.'), stop: 'end_turn' },
  ]);
  // Sesiones de hace días: sus proyectos van al pasillo «Salas sin uso».
  claude(notas, 'Ordenar notas', [
    { who: 'user', min: 60 * 30, content: 'Ordena las notas por tema.' },
    { who: 'assistant', min: 60 * 30, content: say('Hecho.'), stop: 'end_turn' },
  ]);
  claude(fotos, 'Renombrar fotos', [
    { who: 'user', min: 60 * 50, content: 'Renombra las fotos por fecha.' },
    { who: 'assistant', min: 60 * 50, content: say('Hecho.'), stop: 'end_turn' },
  ]);

  // Codex: solo las tablas y columnas que lee src/sources/codex.js.
  const codexHome = join(home, '.codex');
  mkdirSync(join(codexHome, 'sessions'), { recursive: true });
  const db = new DatabaseSync(join(codexHome, 'state_5.sqlite'));
  db.exec(`CREATE TABLE projects (id TEXT, name TEXT, metadata TEXT);
    CREATE TABLE project_roots (project_id TEXT, path TEXT, position INTEGER);
    CREATE TABLE threads (id TEXT, name TEXT, title TEXT, first_user_message TEXT, cwd TEXT, git_branch TEXT,
      rollout_path TEXT, tokens_used INTEGER, model TEXT, updated_at_ms INTEGER, thread_source TEXT,
      archived INTEGER DEFAULT 0, source TEXT, agent_nickname TEXT, agent_role TEXT);`);
  const insert = db.prepare(`INSERT INTO threads (id, name, cwd, git_branch, rollout_path, tokens_used, model, updated_at_ms, thread_source)
    VALUES (?, ?, ?, 'develop', ?, 120000, 'gpt-5.5-codex', ?, 'vscode')`);
  function codex(dir, title, rows, min) {
    const id = uuid();
    const path = join(codexHome, 'sessions', `rollout-${id}.jsonl`);
    writeFileSync(path, rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
    insert.run(id, title, dir, path, now - min * 60000);
  }
  const event = (min, payload, type = 'event_msg') => ({ timestamp: ago(min), type, payload });
  const plan = (min, steps) => event(min, { type: 'function_call', name: 'update_plan', arguments: JSON.stringify({ plan: steps.map(([step, status]) => ({ step, status })) }) }, 'response_item');
  const resets = (seconds) => Math.round(now / 1000) + seconds;
  codex(parking, 'Mapa de aparcamientos libres', [
    event(20, { type: 'task_started' }),
    plan(18, [['Leer la API', 'completed'], ['Capa del mapa', 'completed'], ['Filtro por plazas', 'in_progress'], ['Pruebas', 'pending']]),
    event(1, { type: 'item_completed', item: { type: 'FileChange', changes: { [join(parking, 'shared/MapViewModel.kt')]: {} } } }),
    event(1, { type: 'token_count', rate_limits: {
      primary: { used_percent: 38, window_minutes: 300, resets_at: resets(2 * 3600) },
      secondary: { used_percent: 61, window_minutes: 10080, resets_at: resets(3 * 86400) },
    } }),
  ], 1);
  codex(huerto, 'Calendario de riego', [
    event(40, { type: 'task_started' }),
    plan(38, [['Modelo de plantas', 'completed'], ['Calendario', 'completed'], ['Avisos', 'pending']]),
    event(25, { type: 'item_completed', item: { type: 'AgentMessage', text: 'El calendario ya calcula los riegos. ¿Quieres avisos por la mañana o por la tarde?' } }),
    event(25, { type: 'task_complete' }),
  ], 25);
  db.close();

  // Uso de Claude (en local no existe: lo guarda src/claude-usage.js) y notas de la Bandeja.
  writeFileSync(join(data, 'claude-usage.json'), JSON.stringify({ observedAt: now - 5 * 60000, windows: [
    { key: 'five_hour', usedPercent: 46, windowMinutes: 300, resetsAt: now + 2.5 * 3600000 },
    { key: 'seven_day', usedPercent: 27, windowMinutes: 10080, resetsAt: now + 4 * 86400000 },
  ] }));
  const note = (min, text, project, title, description, extra = {}) => ({
    id: uuid(), text, source: extra.source ?? 'voice', createdAt: now - min * 60000, status: extra.status ?? 'open',
    plan: { state: 'ready', project, title, description, reason: 'La nota lo nombra.' }, sentTo: extra.sentTo ?? [],
  });
  writeFileSync(join(data, 'inbox.json'), `${JSON.stringify({ notes: [
    note(8, 'En el blog añadir un feed RSS para los artículos', blog, 'Añadir feed RSS', 'Generar /feed.xml con los últimos artículos y enlazarlo desde la cabecera.'),
    note(55, 'En reservas, el botón de cancelar no se ve bien en modo oscuro', reservas, 'Botón de cancelar ilegible en modo oscuro', 'En la pantalla de detalle de la reserva el botón Cancelar tiene poco contraste con el tema oscuro.', { source: 'text' }),
    note(140, 'Recetas: poder marcar recetas favoritas', recetas, 'Recetas favoritas', 'Marcar recetas como favoritas y filtrarlas desde la lista.'),
    note(300, 'Recetas lista de la compra compartida', recetas, 'Compartir la lista de la compra', 'Permitir compartir la lista generada.', {
      status: 'sent', sentTo: [{ kind: 'github', ref: '#15', url: 'https://github.com/demo/recetas/issues/15', sentAt: now - 280 * 60000 }],
    }),
  ] }, null, 2)}\n`);

  return { home, data };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const root = process.argv[2] ?? join(homedir(), 'Library/Caches/dashboard-demo');
  if (/^\/(private\/)?tmp\//.test(root)) {
    console.error('La carpeta de la demo no puede estar en /tmp: el panel trata esas rutas como chats sueltos.');
    process.exit(1);
  }
  const { home, data } = buildDemoWorld(root);
  console.log(`HOME=${home} DASHBOARD_DATA_DIR=${data}`);
}
