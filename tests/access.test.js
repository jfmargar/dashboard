import test from 'node:test';
import assert from 'node:assert/strict';
import { isTailnetAddress, orderAccess, requestReach } from '../src/access.js';

const req = (headers, remoteAddress = '127.0.0.1') => ({ socket: { remoteAddress }, headers });

test('el navegador de este Mac entra sin proxy y con un Host de loopback', () => {
  for (const host of ['localhost:4317', '127.0.0.1:4317', '[::1]:4317', 'panel.localhost:4317']) {
    assert.equal(requestReach(req({ host })).kind, 'local', host);
  }
  assert.equal(requestReach(req({ host: 'localhost:4317' }, '::1')).kind, 'local');
});

test('una web que resuelve a 127.0.0.1 con otro Host no entra (DNS rebinding)', () => {
  assert.equal(requestReach(req({ host: 'malo.example:4317' })).kind, 'blocked');
  assert.equal(requestReach(req({})).kind, 'blocked');
});

test('tailscale serve entra como tailnet, con o sin cuenta', () => {
  const reach = requestReach(req({ host: 'mi-mac.tailnet.ts.net', 'x-forwarded-for': '100.101.102.103', 'tailscale-user-login': 'yo@example.com' }));
  assert.deepEqual(reach, { kind: 'tailnet', login: 'yo@example.com' });
  assert.deepEqual(requestReach(req({ 'x-forwarded-for': 'fd7a:115c:a1e0::1234' })), { kind: 'tailnet', login: null });
});

test('Funnel y cualquier otro proxy se bloquean enteros', () => {
  assert.equal(requestReach(req({ 'tailscale-funnel-request': '?1', 'x-forwarded-for': '100.101.102.103' })).kind, 'blocked');
  assert.equal(requestReach(req({ host: 'localhost', 'x-forwarded-for': '203.0.113.5' })).kind, 'blocked');
  assert.equal(requestReach(req({ host: 'localhost', 'x-forwarded-for': '100.101.102.103, 203.0.113.5' })).kind, 'blocked');
  assert.equal(requestReach(req({ host: 'localhost', 'x-real-ip': '203.0.113.5' })).kind, 'blocked');
  // Una cuenta falsa sin la IP de la tailnet no basta.
  assert.equal(requestReach(req({ host: 'localhost', 'tailscale-user-login': 'yo@example.com' })).kind, 'blocked');
  // Con HOST=0.0.0.0 llegaría gente de la red local: tampoco.
  assert.equal(requestReach(req({ host: '192.168.1.20:4317' }, '192.168.1.30')).kind, 'blocked');
});

test('las órdenes: este Mac sí; la tailnet solo con cuenta; lo bloqueado nunca', async () => {
  assert.deepEqual(await orderAccess(req({ host: 'localhost:4317' })), { allowed: true, via: 'local' });
  assert.equal((await orderAccess(req({ 'x-forwarded-for': '100.101.102.103' }))).allowed, false);
  const funnel = await orderAccess(req({ 'tailscale-funnel-request': '?1' }));
  assert.equal(funnel.allowed, false);
  assert.match(funnel.reason, /Funnel/);
});

test('direcciones de la tailnet', () => {
  assert.equal(isTailnetAddress('100.64.0.1'), true);
  assert.equal(isTailnetAddress('100.127.255.254'), true);
  assert.equal(isTailnetAddress('100.128.0.1'), false);
  assert.equal(isTailnetAddress('10.0.0.1'), false);
  assert.equal(isTailnetAddress('fd7a:115c:a1e0:ab12::1'), true);
  assert.equal(isTailnetAddress('fd00::1'), false);
  assert.equal(isTailnetAddress(undefined), false);
});
