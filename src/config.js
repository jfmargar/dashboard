import { readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATA_DIR } from './data-dir.js';

// Ajustes propios de cada Mac en `data/config.json`, fuera de git: las zonas de la oficina, el logotipo
// de la planta destacada, cómo reconocer códigos de proyecto y las palabras que Datask debe ignorar.
// Sin el archivo se usan los valores por defecto. Se vuelve a leer cuando cambia, sin reiniciar.
//
// {
//   "zones": [{ "id": "trabajo", "title": "Trabajo", "path": "~/Workspace/Trabajo", "accent": true },
//             { "id": "personal", "title": "Personal", "path": "~/Workspace/Personal", "datask": false }],
//   "logo": "data/logo.svg",
//   "projectCodePattern": "\\b(PRJ\\d{3})\\b",
//   "datask": { "ignoredWords": ["mantenimiento"] }
// }
const CONFIG_FILE = join(DATA_DIR, 'config.json');
const REPO_DIR = fileURLToPath(new URL('../', import.meta.url));

// `otros` siempre existe y va la última: recoge lo que no cae en ninguna zona.
export const OTHER_ZONE = { id: 'otros', title: 'Otros' };

export const DEFAULTS = {
  zones: [
    { id: 'trabajo', title: 'Trabajo', path: '~/Workspace/Trabajo', accent: true },
    { id: 'personal', title: 'Personal', path: '~/Workspace/Personal', datask: false },
  ],
  logo: null,
  projectCodePattern: null,
  datask: { ignoredWords: [] },
};

let cached = { mtimeMs: null, config: normalizeConfig({}) };

export function getConfig() {
  let mtimeMs = null;
  try { mtimeMs = statSync(CONFIG_FILE).mtimeMs; } catch { /* sin archivo: valores por defecto */ }
  if (mtimeMs === cached.mtimeMs) return cached.config;
  let raw = {};
  if (mtimeMs !== null) {
    try {
      raw = JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));
    } catch (error) {
      console.error(`No se pudo leer ${CONFIG_FILE}: ${error.message}. Uso los valores por defecto.`);
    }
  }
  cached = { mtimeMs, config: normalizeConfig(raw) };
  return cached.config;
}

export function normalizeConfig(raw) {
  const zones = (Array.isArray(raw.zones) ? raw.zones : DEFAULTS.zones)
    .filter((zone) => zone && typeof zone.id === 'string' && zone.id && zone.id !== OTHER_ZONE.id && typeof zone.path === 'string')
    .map((zone) => ({
      id: zone.id,
      title: typeof zone.title === 'string' && zone.title ? zone.title : zone.id,
      path: zone.path,
      accent: zone.accent === true,
      datask: zone.datask !== false,
    }));
  let codePattern = null;
  const source = raw.projectCodePattern === undefined ? DEFAULTS.projectCodePattern : raw.projectCodePattern;
  if (typeof source === 'string' && source) {
    try {
      codePattern = new RegExp(source, 'i');
    } catch (error) {
      console.error(`projectCodePattern no es una expresión válida: ${error.message}`);
    }
  }
  const ignored = raw.datask && Array.isArray(raw.datask.ignoredWords) ? raw.datask.ignoredWords : DEFAULTS.datask.ignoredWords;
  return {
    zones,
    logo: typeof raw.logo === 'string' && raw.logo ? raw.logo : DEFAULTS.logo,
    codePattern,
    dataskIgnoredWords: ignored.filter((word) => typeof word === 'string').map((word) => word.toLowerCase()),
  };
}

// Ruta absoluta: `~/` es la carpeta de usuario y lo relativo cuelga del repositorio.
export function expandPath(path, home = homedir()) {
  if (path === '~') return home;
  if (path.startsWith('~/')) return join(home, path.slice(2));
  return isAbsolute(path) ? path : resolve(REPO_DIR, path);
}

export function zoneForPath(path, home = homedir(), config = getConfig()) {
  for (const zone of config.zones) {
    const base = expandPath(zone.path, home);
    if (path === base || path.startsWith(`${base}/`)) return zone.id;
  }
  return OTHER_ZONE.id;
}

export function zoneById(id, config = getConfig()) {
  return config.zones.find((zone) => zone.id === id) ?? null;
}

// Lo que necesita la interfaz: zonas en orden (con `otros` al final) y si hay logotipo.
export function publicConfig(config = getConfig()) {
  return {
    zones: [...config.zones.map(({ id, title, accent }) => ({ id, title, accent })), { ...OTHER_ZONE, accent: false }],
    logo: config.logo ? '/brand/logo' : null,
  };
}

export function logoPath(config = getConfig()) {
  return config.logo ? expandPath(config.logo) : null;
}
