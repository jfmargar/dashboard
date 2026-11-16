import { execFile } from 'node:child_process';
import { isIP } from 'node:net';

// De dónde llega cada petición. El servidor escucha en 127.0.0.1, así que todo entra por el propio Mac,
// directamente o a través de un proxy local. Solo hay dos caminos buenos:
// - `local`: el navegador o la app de barra de menú de este Mac, sin proxy y con un Host de loopback
//   (un Host cualquiera sería una web que resuelve a 127.0.0.1 para colarse: DNS rebinding).
// - `tailnet`: `tailscale serve`, que pone en X-Forwarded-For la IP de la tailnet de quien pide y, si es
//   una persona, su cuenta en Tailscale-User-Login (y borra esas cabeceras si las manda el cliente).
// Todo lo demás se bloquea entero, también la página: Tailscale Funnel (marca Tailscale-Funnel-Request
// y no lleva identidad) y cualquier otro proxy, que podría estar abierto a internet.
// Quién puede mandar órdenes: `local`, o `tailnet` con la misma cuenta de Tailscale que este Mac.
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const PROXY_HEADERS = ['x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'x-real-ip', 'forwarded', 'via', 'tailscale-user-login'];
const OWNER_TTL_MS = 5 * 60 * 1000;
const TAILSCALE_BINS = ['/usr/local/bin/tailscale', '/opt/homebrew/bin/tailscale', '/Applications/Tailscale.app/Contents/MacOS/Tailscale'];

let ownerCache = { login: null, checkedAt: 0 };

export function requestReach(req) {
  if (!LOOPBACK.has(req.socket.remoteAddress)) {
    return { kind: 'blocked', reason: 'El panel solo atiende a este Mac y a tu tailnet.' };
  }
  const headers = req.headers;
  if (headers['tailscale-funnel-request']) {
    return { kind: 'blocked', reason: 'El panel no se abre desde internet (Tailscale Funnel).' };
  }
  if (!PROXY_HEADERS.some((name) => headers[name] !== undefined)) {
    if (isLoopbackHost(headers.host)) return { kind: 'local' };
    return { kind: 'blocked', reason: 'Dirección no reconocida: abre el panel en localhost.' };
  }
  if (isTailnetAddress(headers['x-forwarded-for'])) {
    return { kind: 'tailnet', login: headers['tailscale-user-login'] ?? null };
  }
  return { kind: 'blocked', reason: 'El panel solo se comparte con tailscale serve, nunca con otro proxy.' };
}

export async function orderAccess(req) {
  const reach = requestReach(req);
  if (reach.kind === 'blocked') return { allowed: false, reason: reach.reason };
  if (reach.kind === 'local') return { allowed: true, via: 'local' };
  if (!reach.login) return { allowed: false, reason: 'Solo se aceptan órdenes de tu cuenta de Tailscale, no de un dispositivo sin usuario.' };
  const owner = await tailscaleOwner();
  if (owner && owner === reach.login) return { allowed: true, via: 'tailscale' };
  return { allowed: false, reason: `La cuenta de Tailscale ${reach.login} no es la de este Mac.` };
}

// Evita que una web cualquiera abierta en el navegador mande órdenes a localhost.
export function isSameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return false;
  const host = req.headers['x-forwarded-host'] ?? req.headers.host;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

function isLoopbackHost(host) {
  if (!host) return false;
  const name = String(host).toLowerCase().replace(/:\d+$/, '');
  return LOOPBACK_HOSTS.has(name) || name.endsWith('.localhost');
}

// Una sola IP y de la tailnet: 100.64.0.0/10 (CGNAT) o fd7a:115c:a1e0::/48.
export function isTailnetAddress(value) {
  if (typeof value !== 'string') return false;
  const ip = value.trim();
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number);
    return a === 100 && b >= 64 && b <= 127;
  }
  if (isIP(ip) === 6) return /^fd7a:115c:a1e0:/i.test(ip);
  return false;
}

function tailscaleOwner() {
  if (Date.now() - ownerCache.checkedAt < OWNER_TTL_MS) return Promise.resolve(ownerCache.login);
  return new Promise((resolve) => {
    tryBin(0, resolve);
  });
}

function tryBin(index, resolve) {
  if (index >= TAILSCALE_BINS.length) {
    ownerCache = { login: null, checkedAt: Date.now() };
    resolve(null);
    return;
  }
  execFile(TAILSCALE_BINS[index], ['status', '--json'], { timeout: 3000 }, (error, stdout) => {
    if (error) {
      tryBin(index + 1, resolve);
      return;
    }
    let login = null;
    try {
      const status = JSON.parse(stdout);
      login = status.User?.[String(status.Self?.UserID)]?.LoginName ?? null;
    } catch {
      // Salida inesperada: nadie remoto puede mandar órdenes.
    }
    ownerCache = { login, checkedAt: Date.now() };
    resolve(login);
  });
}
