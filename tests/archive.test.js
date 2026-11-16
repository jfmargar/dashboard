import test from 'node:test';
import assert from 'node:assert/strict';
import { withoutArchived } from '../src/archive.js';

test('lo archivado no sale hasta que vuelve a tener actividad', () => {
  const list = { a: 1000, b: 1000 };
  const sessions = [
    { id: 'a', lastActivity: 900 },
    { id: 'b', lastActivity: 1500 },
    { id: 'c', lastActivity: 100 }
  ];
  assert.deepEqual(withoutArchived(sessions, list).map((s) => s.id), ['b', 'c']);
});
