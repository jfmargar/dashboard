import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { projectHints } from '../src/catalog.js';
import { simplePlan } from '../src/planner.js';

test('las pistas de un proyecto: nombre de la app (sin extensiones) y de qué va según el README', () => {
  const root = mkdtempSync(join(tmpdir(), 'dashboard-hints-'));
  try {
    mkdirSync(join(root, 'App.xcodeproj'));
    writeFileSync(join(root, 'App.xcodeproj', 'project.pbxproj'),
      'INFOPLIST_KEY_CFBundleDisplayName = "¿Sofá y peli?";\nINFOPLIST_KEY_CFBundleDisplayName = AppNotificationExtension;\n');
    mkdirSync(join(root, 'android', 'app', 'src', 'main', 'res', 'values'), { recursive: true });
    writeFileSync(join(root, 'android', 'app', 'src', 'main', 'res', 'values', 'strings.xml'),
      '<resources><string name="app_name">Sofá</string></resources>');
    writeFileSync(join(root, 'README.md'), '# ShowTime\n\n![badge](x.svg)\n\nApp iOS para seguir series y películas. Más detalles abajo.\n');
    const hints = projectHints(root);
    assert.deepEqual(hints.appNames.sort(), ['Sofá', '¿Sofá y peli?']);
    assert.equal(hints.summary, 'App iOS para seguir series y películas.');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('sin modelo, la nota también encuentra el proyecto por el nombre de su app', () => {
  const catalog = [
    { key: '/a', name: 'PuntosClub-Ultramarinos', aliases: [], appNames: ['Ultramarinos y tú'], code: null, repo: null },
    { key: '/b', name: 'ShowTimeTracker', aliases: [], appNames: ['¿Sofá y peli?'], code: null, repo: null }
  ];
  assert.equal(simplePlan('En Sofá y peli quiero avisos de estreno', catalog).project, '/b');
  assert.equal(simplePlan('Ultramarinos y tú: revisar el login', catalog).project, '/a');
});
