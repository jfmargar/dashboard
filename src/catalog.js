import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { DATA_DIR } from './data-dir.js';
import { getConfig } from './config.js';
import { resolveRepoRoot } from './projects.js';

// Catálogo de proyectos para la bandeja: se genera en cada consulta a partir de lo que ya ve el panel
// (proyectos, carpetas guardadas en Codex y su `.git/config`). Solo se guarda lo que no se puede deducir:
// alias y destinos aprobados, en `data/catalog.json`.
const LEARNED_FILE = join(DATA_DIR, 'catalog.json');

let learned = loadLearned();

// `state` es lo que devuelve collectState(). Clave de cada proyecto: su carpeta principal.
export function buildCatalog(state) {
  const entries = new Map();
  // `group`: proyecto del panel al que pertenece la carpeta. Sus repos comparten destino de Datask.
  const add = (root, name, zone, group) => {
    const key = resolveRepoRoot(root);
    if (!key.startsWith('/') || entries.has(key)) return;
    const remote = readRemote(key);
    const saved = learned.projects[key] ?? {};
    const code = codeFrom(key) ?? codeFrom(remote?.path ?? '');
    // Carpetas contenedoras sin repo, código ni alias (p. ej. la carpeta de una zona): no son proyectos.
    if (!remote && !code && !saved.aliases?.length) return;
    const folder = basename(key);
    entries.set(key, {
      key,
      group: group ?? key,
      // Un proyecto de Codex puede agrupar varias carpetas: el nombre lleva la carpeta cuando no coincide.
      name: folder.toLowerCase() === name.toLowerCase() ? name : `${name} · ${folder}`,
      zone,
      code,
      repo: remote,
      aliases: saved.aliases ?? [],
      destinations: saved.destinations ?? {},
      // Pistas para reconocerlo en una nota: cómo se llama la app y de qué va.
      ...projectHints(key),
    });
  };
  for (const project of state.projects) {
    for (const root of project.roots) add(root, project.name, project.zone, project.id);
  }
  for (const root of state.launchRoots) add(root.cwd, root.label.split(' · ')[0], null);
  for (const key of Object.keys(learned.projects)) {
    if (existsSync(key)) add(key, learned.projects[key].name ?? basename(key), null);
  }
  return [...entries.values()];
}

export function findProject(catalog, key) {
  return catalog.find((entry) => entry.key === key) ?? null;
}

// Lo que se aprende al aprobar o corregir un plan.
export function rememberProject(entry, patch) {
  const saved = learned.projects[entry.key] ?? {};
  learned.projects[entry.key] = { ...saved, name: entry.name, ...patch };
  saveLearned();
}

export function addAlias(entry, alias) {
  const clean = alias.trim();
  if (!clean || entry.aliases.some((a) => a.toLowerCase() === clean.toLowerCase())) return;
  rememberProject(entry, { aliases: [...entry.aliases, clean] });
}

// Nombre visible de la app (iOS, Android) y la primera frase del README, leídos una vez por carpeta.
const hintCache = new Map();
const ANDROID_STRINGS = ['app', 'android/app', 'androidApp', 'composeApp'].flatMap((dir) =>
  ['main', 'androidMain'].map((set) => `${dir}/src/${set}/res/values/strings.xml`));
const SKIP_DIRS = new Set(['node_modules', '.git', 'build', 'Pods', 'DerivedData', '.gradle', 'dist', 'vendor']);

export function projectHints(root) {
  if (hintCache.has(root)) return hintCache.get(root);
  const appNames = new Set();
  walk(root, 3, (path) => {
    for (const m of readText(path).matchAll(/INFOPLIST_KEY_CFBundleDisplayName = "?([^";\n]+)"?;/g)) addAppName(appNames, m[1]);
  });
  // Android guarda el nombre en sus strings.xml, más hondo: se miran los sitios de siempre.
  for (const module of ANDROID_STRINGS) {
    const m = /<string name="app_name"[^>]*>([^<]+)<\/string>/.exec(readText(join(root, module)));
    if (m) addAppName(appNames, m[1]);
  }
  const hints = { appNames: [...appNames].slice(0, 4), summary: readmeSummary(root) };
  hintCache.set(root, hints);
  return hints;
}

function addAppName(names, raw) {
  const name = raw.replace(/\\(.)/g, '$1').trim();
  // Las extensiones, widgets y tests no son el nombre de la app.
  if (name && !/extension|widget|notification|tests?$|^\$\(/i.test(name)) names.add(name);
}

function walk(dir, depth, visit) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (depth > 0 && !SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
        // Los .xcodeproj guardan el project.pbxproj un nivel más abajo.
        walk(path, entry.name.endsWith('.xcodeproj') ? 1 : depth - 1, visit);
      }
    } else if (entry.name === 'project.pbxproj') {
      visit(path);
    }
  }
}

// Primera frase con contenido del README (sin títulos, insignias ni enlaces), hasta 160 caracteres.
function readmeSummary(root) {
  const text = readText(join(root, 'README.md'));
  for (const line of text.split('\n')) {
    const clean = line.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_`>#]/g, '').trim();
    if (!clean || line.trim().startsWith('#') || clean.length < 25) continue;
    const sentence = clean.split(/(?<=\.)\s/)[0];
    return sentence.length > 160 ? `${sentence.slice(0, 159)}…` : sentence;
  }
  return '';
}

function readText(path) {
  try { return readFileSync(path, 'utf8'); } catch { return ''; }
}

// Código de proyecto en la carpeta o el remoto, si `projectCodePattern` de data/config.json lo reconoce.
function codeFrom(text) {
  const pattern = getConfig().codePattern;
  const match = pattern ? pattern.exec(text) : null;
  return match ? (match[1] ?? match[0]).toUpperCase() : null;
}

// Primer remoto del repositorio. `kind` solo se rellena cuando se sabe con qué CLI crear issues.
function readRemote(repoRoot) {
  let config;
  try {
    config = readFileSync(join(repoRoot, '.git', 'config'), 'utf8');
  } catch {
    return null;
  }
  const origin = /\[remote "origin"\][^[]*?url\s*=\s*(\S+)/.exec(config) ?? /url\s*=\s*(\S+)/.exec(config);
  if (!origin) return null;
  const url = origin[1];
  const match = /^(?:[a-z+]+:\/\/)?(?:[^@/]+@)?([^/:]+)[:/](.+?)(?:\.git)?\/?$/i.exec(url);
  if (!match) return null;
  const [, host, path] = match;
  const kind = host === 'github.com' ? 'github' : /gitlab/i.test(host) ? 'gitlab' : null;
  return { host, path, kind, url: kind ? `https://${host}/${path}` : null };
}

function loadLearned() {
  try {
    const data = JSON.parse(readFileSync(LEARNED_FILE, 'utf8'));
    return { projects: data.projects ?? {} };
  } catch {
    return { projects: {} };
  }
}

function saveLearned(data = learned) {
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(LEARNED_FILE, `${JSON.stringify(data, null, 2)}\n`);
  } catch {
    // Sin poder guardar: lo aprendido sigue en memoria hasta reiniciar.
  }
}

