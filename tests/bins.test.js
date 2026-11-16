import test from 'node:test';
import assert from 'node:assert/strict';

// Un CLI falso que ya no existe (p. ej. una carpeta temporal borrada) no debe caer en el CLI real.
const missing = '/ruta/que/no/existe/cli-falso';
process.env.GLAB_BIN = missing;
process.env.GH_BIN = missing;
process.env.DATASK_BIN = missing;

const { binCandidates } = await import('../src/bins.js');
const { binFor, destinationsFor } = await import('../src/destinations.js');
const { dataskBin } = await import('../src/datask.js');

test('con la variable puesta, solo se usa esa ruta', () => {
  assert.deepEqual(binCandidates('GLAB_BIN', ['/opt/homebrew/bin/glab']), [missing]);
});

test('sin la variable, se usan las rutas habituales', () => {
  assert.deepEqual(binCandidates('NO_EXISTE_ESTA_VARIABLE_BIN', ['/a', '/b']), ['/a', '/b']);
});

test('un CLI falso que no existe deja el destino sin CLI en lugar de usar el real', () => {
  assert.equal(binFor('glab'), null);
  assert.equal(binFor('gh'), null);
  assert.equal(dataskBin(), null);
  const entry = { repo: { kind: 'gitlab', host: 'gitlab.example', path: 'grupo/repo' } };
  assert.deepEqual(destinationsFor(entry), []);
});
