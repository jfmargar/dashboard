import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Un Mac de mentira para probar la Bandeja: HOME con repos de prueba (GitLab, GitHub y uno sin remoto),
// una sesión reciente de Claude en cada uno y CLI falsos de claude, glab, gh, datask y mlx_whisper que
// apuntan cada llamada en `calls.jsonl`. Cerrar un issue o tarea es crear su fichero en `state/`.
// Lo usan tests/inbox-e2e.test.js y, para probar la interfaz a mano, una instancia aparte del servidor:
//   node -e "import('./tests/fixtures/inbox-world.js').then((m) => m.printEnv('<carpeta>'))"
export function buildWorld(root) {
  const home = join(root, 'home');
  const binDir = join(root, 'bin');
  const stateDir = join(root, 'state');
  const LOG = join(root, 'calls.jsonl');
  const projects = {
    parking: join(home, 'Workspace/Trabajo/PRJ123-Parking'),
    recetas: join(home, 'Workspace/Personal/Recetas'),
    sueltos: join(home, 'Workspace/Personal/Notas'),
  };
  mkdirSync(binDir, { recursive: true });
  mkdirSync(stateDir, { recursive: true });

  // Cabecera común de los CLI falsos: apuntan argumentos, entrada, carpeta y entorno útil.
  const PRELUDE = `#!/usr/bin/env node
  const fs = require('fs');
  const path = require('path');
  const LOG = ${JSON.stringify(LOG)};
  const STATE = ${JSON.stringify(stateDir)};
  const args = process.argv.slice(2);
  const log = (bin, extra) => fs.appendFileSync(LOG, JSON.stringify({ bin, args, cwd: process.cwd(), gitlabHost: process.env.GITLAB_HOST, ...extra }) + '\\n');
  const closed = (name) => fs.existsSync(path.join(STATE, name));
  `;

  const FAKE_CLAUDE = `${PRELUDE}
  let stdin = '';
  process.stdin.on('data', (chunk) => { stdin += chunk; });
  process.stdin.on('end', () => {
    log('claude', { stdin });
    if (args.includes('--json-schema')) return plan();
    // Sesión nueva lanzada desde una nota: responde como stream-json.
    const send = (event) => process.stdout.write(JSON.stringify(event) + '\\n');
    send({ type: 'system', subtype: 'init', session_id: args[args.indexOf('--session-id') + 1] });
    send({ type: 'result', result: 'Hecho desde la nota' });
  });
  function plan() {
    const note = /<nota>\\n([\\s\\S]*)\\n<\\/nota>/.exec(stdin)[1];
    if (note.includes('FALLA')) {
      process.stderr.write('sin conexión');
      process.exit(1);
    }
    const ids = {};
    for (const m of stdin.matchAll(/^- (p\\d+) (.+)$/gm)) ids[/parking/i.test(m[2]) ? 'parking' : /recetas/i.test(m[2]) ? 'recetas' : m[1]] = m[1];
    let project = null;
    let candidates = [];
    let mention = null;
    if (note.includes('INVENTADO')) project = 'p99';
    else if (note.includes('DUDA')) candidates = [ids.parking, ids.recetas];
    else if (/parking/i.test(note)) { project = ids.parking; mention = 'el parking'; }
    else if (/recetas/i.test(note)) { project = ids.recetas; mention = 'recetas'; }
    const result = { is_error: false, structured_output: {
      project, candidates, mention,
      title: 'Plan: ' + note.split('\\n')[0].slice(0, 60),
      description: note,
      reason: project ? 'La nota lo nombra.' : 'No está claro.',
    } };
    setTimeout(() => process.stdout.write(JSON.stringify(result)), note.includes('LENTO') ? 2500 : 0);
  }
  `;

  const FAKE_GLAB = `${PRELUDE}
  log('glab');
  if (args[0] === 'issue' && args[1] === 'create') {
    const title = args[args.indexOf('--title') + 1];
    if (title.includes('ROMPE')) { process.stderr.write('error de red'); process.exit(1); }
    setTimeout(() => console.log('Creating issue in grupo/parking\\nhttps://gitlab.example.com/grupo/parking/-/issues/42'), title.includes('DESPACIO') ? 800 : 0);
  } else if (args[0] === 'issue' && args[1] === 'view') {
    // El hito cerrado no debe confundirse con el issue cerrado.
    console.log(JSON.stringify({ iid: Number(args[2]), state: closed('glab-' + args[2]) ? 'closed' : 'opened', milestone: { state: 'closed' } }));
  }
  `;

  const FAKE_GH = `${PRELUDE}
  log('gh');
  if (args[0] === 'issue' && args[1] === 'create') console.log('https://github.com/yo/recetas/issues/7');
  else if (args[0] === 'issue' && args[1] === 'view') console.log(JSON.stringify({ state: closed('gh-' + args[2]) ? 'CLOSED' : 'OPEN' }));
  `;

  const FAKE_DATASK = `${PRELUDE}
  log('datask');
  const out = (value) => console.log(JSON.stringify(value));
  const [cmd, sub, id] = args;
  if (cmd === 'projects') out([
    { id: 10, code: 'PRJ123', name: 'Parking bicis', companyName: 'Ayuntamiento', status: 1 },
    { id: 11, code: 'PRJ123', name: 'Parking antiguo', companyName: 'Ayuntamiento', status: 2 },
    { id: 20, code: 'PRJ900', name: 'Otro cliente', companyName: 'Intermediaria', status: 1 },
  ]);
  else if (cmd === 'tasks') out([{ id: 500, projectId: 10, name: 'Tarea mía' }]);
  else if (cmd === 'boards') out([{ id: 3, name: 'Tablero' }]);
  else if (cmd === 'lists') out([{ id: 30, name: 'Backlog' }, { id: 31, name: 'TODO' }]);
  else if (cmd === 'task' && sub === 'create') out({ id: 900 });
  else if (cmd === 'task' && sub === 'show') out({ task: { id: Number(id), userDataId: 77, status: closed('datask-' + id) ? 2 : 1 } });
  else { process.stderr.write('orden desconocida'); process.exit(1); }
  `;

  const FAKE_WHISPER = `${PRELUDE}
  log('whisper');
  const dir = args[args.indexOf('--output-dir') + 1];
  fs.writeFileSync(path.join(dir, 'texto.txt'), 'Nota dictada para el parking\\n');
  `;

  function writeBin(name, body) {
    const path = join(binDir, name);
    writeFileSync(path, body, { mode: 0o755 });
    return path;
  }

  // Un repo con su remoto y una sesión reciente de Claude, para que el panel lo vea como proyecto.
  function makeProject(dir, remote, sessionId) {
    mkdirSync(join(dir, '.git'), { recursive: true });
    writeFileSync(join(dir, '.git/HEAD'), 'ref: refs/heads/develop\n');
    writeFileSync(join(dir, '.git/config'), remote ? `[remote "origin"]\n\turl = ${remote}\n` : '[core]\n\tbare = false\n');
    const projectDir = join(home, '.claude/projects', dir.replace(/[/.]/g, '-'));
    mkdirSync(projectDir, { recursive: true });
    const at = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const rows = [
      { type: 'user', cwd: dir, timestamp: at, sessionId, message: { role: 'user', content: 'Hola' } },
      { type: 'assistant', cwd: dir, timestamp: at, sessionId, message: { role: 'assistant', model: 'claude-test', stop_reason: 'end_turn', content: [{ type: 'text', text: 'Listo.' }] } },
    ];
    writeFileSync(join(projectDir, `${sessionId}.jsonl`), rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
  }


  // Zonas por defecto (Trabajo y Personal) y códigos de proyecto PRJ123 (src/config.js).
  mkdirSync(join(root, 'data'), { recursive: true });
  writeFileSync(join(root, 'data/config.json'), JSON.stringify({ projectCodePattern: '\\b(PRJ\\d{3})\\b' }));

  writeBin('claude', FAKE_CLAUDE);
  writeBin('glab', FAKE_GLAB);
  writeBin('gh', FAKE_GH);
  writeBin('datask', FAKE_DATASK);
  writeBin('mlx_whisper', FAKE_WHISPER);
  makeProject(projects.parking, 'git@gitlab.example.com:grupo/parking.git', '11111111-1111-4111-8111-111111111111');
  makeProject(projects.recetas, 'https://github.com/yo/recetas.git', '22222222-2222-4222-8222-222222222222');
  makeProject(projects.sueltos, null, '33333333-3333-4333-8333-333333333333');

  return {
    home, binDir, stateDir, log: LOG, projects,
    env: {
      HOME: home,
      DASHBOARD_DATA_DIR: join(root, 'data'),
      CLAUDE_BIN: join(binDir, 'claude'),
      CODEX_BIN: join(binDir, 'codex-que-no-existe'),
      GLAB_BIN: join(binDir, 'glab'),
      GH_BIN: join(binDir, 'gh'),
      DATASK_BIN: join(binDir, 'datask'),
      TRANSCRIBE_CMD: join(binDir, 'mlx_whisper'),
      CLAUDE_USAGE_PROBE_MINUTES: '0',
    },
  };
}

// Variables para lanzar el servidor contra este mundo, en formato `env`.
export function printEnv(root) {
  const { env } = buildWorld(root);
  console.log(Object.entries(env).map(([key, value]) => `${key}=${value}`).join(' '));
}
