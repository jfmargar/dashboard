import test from 'node:test';
import assert from 'node:assert/strict';
import { replanText } from '../src/inbox.js';

test('volver a proponer usa tus correcciones y el proyecto que elegiste', () => {
  const catalog = [{ key: '/repo/showtime', name: 'ShowTimeTracker' }];
  const note = {
    text: 'En la app de sofá quiero revisar las fechas de estreno',
    plan: { state: 'pending', fixed: { project: '/repo/showtime', title: 'Fechas de estreno', description: 'Revisar la zona horaria' } }
  };
  const text = replanText(note, catalog);
  assert.match(text, /^En la app de sofá/);
  assert.match(text, /Proyecto: ShowTimeTracker/);
  assert.match(text, /Título: Fechas de estreno/);
  assert.match(text, /Descripción: Revisar la zona horaria/);
  assert.equal(replanText({ text: 'Solo la nota', plan: { state: 'pending' } }, catalog), 'Solo la nota');
});

test('Datask solo se ofrece donde puede estar el proyecto', async () => {
  const { mayBeInDatask } = await import('../src/inbox.js');
  assert.equal(mayBeInDatask({ zone: 'personal', code: null, destinations: {} }), false);
  assert.equal(mayBeInDatask({ zone: 'trabajo', code: null, destinations: {} }), true);
  assert.equal(mayBeInDatask({ zone: null, code: null, destinations: {} }), true);
  assert.equal(mayBeInDatask({ zone: 'personal', code: null, destinations: { datask: { projectId: 1 } } }), true);
});
