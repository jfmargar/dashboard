import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readClaudeDesktop } from '../src/sources/claude-desktop.js';
import { startOrder } from '../src/orders.js';

test('la ficha de la app da el enlace de Remote Control de la sesión vigente', () => {
  const home = mkdtempSync(join(tmpdir(), 'dashboard-desktop-'));
  try {
    const dir = join(home, 'Library/Application Support/Claude/claude-code-sessions/cuenta/org');
    mkdirSync(dir, { recursive: true });
    const write = (name, data) => writeFileSync(join(dir, `${name}.json`), JSON.stringify(data));
    write('local_a', { sessionId: 'local_a', cliSessionId: 'cli-a', title: 'Con Remote Control', bridgeSessionIds: ['session_01Viejo', 'session_01Nuevo'] });
    write('local_b', { sessionId: 'local_b', cliSessionId: 'cli-b', title: 'Sin enlace' });
    // Un id con otra forma no se convierte en dirección.
    write('local_c', { sessionId: 'local_c', cliSessionId: 'cli-c', bridgeSessionIds: ['cse_01Otro', 'session_01/../x'] });
    const sessions = readClaudeDesktop({ home });
    assert.equal(sessions.get('cli-a').remoteUrl, 'https://claude.ai/code/session_01Nuevo');
    assert.equal(sessions.get('cli-b').remoteUrl, null);
    assert.equal(sessions.get('cli-c').remoteUrl, null);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('el servidor no manda órdenes a sesiones de la app de Claude', () => {
  assert.throws(
    () => startOrder({ id: 'claude:cli-a', agent: 'claude', cwd: tmpdir(), status: 'yours', desktopApp: true }, 'Hola'),
    (error) => error.status === 409 && /app de Claude/.test(error.message),
  );
});

test('el letrero usa el nombre de la app solo si es distinto y no se repite', async () => {
  const { withLabels } = await import('../src/state.js');
  const hints = { '/a': ['El Molino'], '/b': ['Presencia'], '/c': ['Presencia'], '/d': ['FARO-SIM'], '/e': [] };
  const projects = [
    { name: 'PuntosClub-Molino', roots: ['/a'] }, { name: 'FichajesKMP', roots: ['/b'] },
    { name: 'Fichajes-android', roots: ['/c'] }, { name: 'Faro SIM', roots: ['/d'] }, { name: 'Dashboard', roots: ['/e'] },
  ];
  withLabels(projects, (root) => ({ appNames: hints[root] }));
  assert.deepEqual(projects.map((p) => p.label ?? null), ['El Molino', null, null, null, null]);
});
