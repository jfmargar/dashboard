import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { DATA_DIR } from './data-dir.js';
import { binCandidates } from './bins.js';

// Uso de Claude (ventana de 5 h y semanal). Claude Code no lo guarda en el Mac: solo lo anuncia en directo,
// en el evento `rate_limit_event` de cada respuesta con `--output-format stream-json`. Se recoge de las
// órdenes del panel y, cada cierto tiempo, de una consulta mínima a Haiku que no deja sesión guardada.
const PROBE_MINUTES = Number(process.env.CLAUDE_USAGE_PROBE_MINUTES ?? 30);
const DATA_FILE = join(DATA_DIR, 'claude-usage.json');
const BINS = binCandidates('CLAUDE_BIN', [join(homedir(), '.local/bin/claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude']);
const WINDOW_MINUTES = { five_hour: 300, seven_day: 10080 };

let usage = load();
let probing = false;

export function getClaudeUsage() {
  return usage;
}

// Llamado con cada evento de las órdenes a Claude.
export function recordRateLimitEvent(event) {
  const windows = event?.rate_limit_info?.unifiedWindows;
  if (!windows) return;
  const list = Object.keys(WINDOW_MINUTES)
    .filter((key) => windows[key])
    .map((key) => ({
      usedPercent: Math.round((windows[key].utilization ?? 0) * 100),
      windowMinutes: WINDOW_MINUTES[key],
      resetsAt: (windows[key].resetsAt ?? 0) * 1000,
    }));
  if (!list.length) return;
  usage = { observedAt: Date.now(), windows: list };
  save();
}

export function startClaudeUsageProbe() {
  if (!(PROBE_MINUTES > 0)) return;
  const intervalMs = PROBE_MINUTES * 60 * 1000;
  const tick = () => {
    // Si una orden del panel ya trajo el dato hace poco, no hace falta preguntar
    if (usage && Date.now() - usage.observedAt < intervalMs) return;
    probe();
  };
  setTimeout(tick, 10 * 1000);
  setInterval(tick, intervalMs);
}

function probe() {
  const bin = BINS.find((path) => path && existsSync(path));
  if (!bin || probing) return;
  probing = true;
  const child = spawn(bin, ['-p', '--model', 'haiku', '--no-session-persistence', '--output-format', 'stream-json', '--verbose'], {
    cwd: tmpdir(),
    stdio: ['pipe', 'pipe', 'ignore'],
  });
  let buffer = '';
  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      try {
        const event = JSON.parse(line);
        if (event.type === 'rate_limit_event') recordRateLimitEvent(event);
      } catch {
        // Línea que no es JSON
      }
    }
  });
  const timer = setTimeout(() => child.kill('SIGTERM'), 60 * 1000);
  child.on('error', () => {});
  child.on('close', () => {
    clearTimeout(timer);
    probing = false;
  });
  child.stdin.end('Responde solo: ok');
}

function load() {
  try {
    return JSON.parse(readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function save() {
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(DATA_FILE, JSON.stringify(usage));
  } catch {
    // Sin poder guardar: el dato sigue en memoria
  }
}
