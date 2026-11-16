import test from 'node:test';
import assert from 'node:assert/strict';
import { expandPath, normalizeConfig, publicConfig, zoneForPath } from '../src/config.js';

const home = '/Users/alguien';

test('sin configuración hay zonas Trabajo y Personal, sin logotipo ni códigos', () => {
  const config = normalizeConfig({});
  assert.deepEqual(config.zones.map((z) => z.id), ['trabajo', 'personal']);
  assert.equal(config.logo, null);
  assert.equal(config.codePattern, null);
  assert.equal(zoneForPath('/Users/alguien/Workspace/Trabajo/app', home, config), 'trabajo');
  assert.equal(zoneForPath('/Users/alguien/Workspace/Personal/blog', home, config), 'personal');
  assert.equal(zoneForPath('/Users/alguien/Proyectos/x', home, config), 'otros');
  assert.deepEqual(publicConfig(config), {
    zones: [
      { id: 'trabajo', title: 'Trabajo', accent: true },
      { id: 'personal', title: 'Personal', accent: false },
      { id: 'otros', title: 'Otros', accent: false },
    ],
    logo: null,
  });
});

test('las zonas, el logotipo y los códigos salen de data/config.json', () => {
  const config = normalizeConfig({
    zones: [
      { id: 'cliente', title: 'Cliente', path: '~/Work/Cliente', accent: true },
      { id: 'casa', path: '/Volumes/Casa', datask: false },
      { id: 'otros', title: 'No se puede redefinir', path: '~/x' },
      { title: 'Sin id', path: '~/y' },
    ],
    logo: 'data/logo.svg',
    projectCodePattern: '\\b(PRJ\\d{3})\\b',
    datask: { ignoredWords: ['Mantenimiento'] },
  });
  assert.deepEqual(config.zones.map((z) => [z.id, z.title, z.accent, z.datask]), [
    ['cliente', 'Cliente', true, true],
    ['casa', 'casa', false, false],
  ]);
  assert.equal(zoneForPath('/Users/alguien/Work/Cliente/app', home, config), 'cliente');
  // Una carpeta que solo empieza igual no es de la zona.
  assert.equal(zoneForPath('/Users/alguien/Work/ClienteViejo', home, config), 'otros');
  assert.equal(zoneForPath('/Volumes/Casa', home, config), 'casa');
  assert.equal(publicConfig(config).logo, '/brand/logo');
  assert.equal(config.codePattern.exec('prj123-parking')[1], 'prj123');
  assert.deepEqual(config.dataskIgnoredWords, ['mantenimiento']);
});

test('un patrón de código inválido se ignora sin romper el panel', () => {
  const config = normalizeConfig({ projectCodePattern: '([' });
  assert.equal(config.codePattern, null);
});

test('las rutas con ~ cuelgan de la carpeta de usuario y las relativas del repositorio', () => {
  assert.equal(expandPath('~/Workspace', home), '/Users/alguien/Workspace');
  assert.equal(expandPath('/tmp/logo.svg', home), '/tmp/logo.svg');
  assert.ok(expandPath('data/logo.svg', home).endsWith('/data/logo.svg'));
});
