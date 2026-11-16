import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { OrderError } from './orders.js';

// Dictado: el audio se transcribe en este Mac con mlx-whisper (`pipx install mlx-whisper`), nunca sale de él.
const MODEL = process.env.TRANSCRIBE_MODEL ?? 'mlx-community/whisper-large-v3-turbo';
const LANGUAGE = process.env.TRANSCRIBE_LANGUAGE ?? 'es';
const TIMEOUT_MS = 2 * 60 * 1000;
const CANDIDATES = [
  join(homedir(), '.local/bin/mlx_whisper'),
  '/opt/homebrew/bin/mlx_whisper',
  '/usr/local/bin/mlx_whisper',
];
// mlx-whisper necesita ffmpeg, y el servidor puede arrancar sin Homebrew en el PATH.
const PATH = [process.env.PATH, '/opt/homebrew/bin', '/usr/local/bin'].filter(Boolean).join(':');
// Palabras que whisper suele escribir mal; los nombres de proyecto se añaden en cada petición.
const BASE_VOCABULARY = ['develop', 'main', 'feature', 'issue', 'merge', 'pull request', 'commit', 'push', 'Claude', 'Codex', 'GitLab'];

const AUDIO_EXTENSIONS = { 'audio/webm': '.webm', 'audio/ogg': '.ogg', 'audio/mp4': '.m4a', 'audio/mpeg': '.mp3', 'audio/wav': '.wav' };

// Una transcripción cada vez: el modelo ocupa memoria y la segunda esperaría igualmente.
let queue = Promise.resolve();

export function transcribeCommand() {
  if (process.env.TRANSCRIBE_CMD) return process.env.TRANSCRIBE_CMD;
  return CANDIDATES.find((bin) => existsSync(bin)) ?? null;
}

export function transcribe(audio, contentType, vocabulary = []) {
  const run = queue.then(() => runWhisper(audio, contentType, vocabulary));
  queue = run.catch(() => {});
  return run;
}

async function runWhisper(audio, contentType, vocabulary) {
  const bin = transcribeCommand();
  if (!bin) throw new OrderError(503, 'No encuentro mlx_whisper. Instálalo con `pipx install mlx-whisper` o indica TRANSCRIBE_CMD.');
  const type = String(contentType).split(';')[0].trim();
  const dir = join(tmpdir(), `dashboard-dictado-${randomUUID()}`);
  await mkdir(dir, { recursive: true });
  try {
    const audioPath = join(dir, `audio${AUDIO_EXTENSIONS[type] ?? '.webm'}`);
    await writeFile(audioPath, audio);
    const prompt = [...new Set([...vocabulary, ...BASE_VOCABULARY])].join(', ');
    await execWhisper(bin, [
      audioPath,
      '--model', MODEL,
      '--language', LANGUAGE,
      '--initial-prompt', prompt,
      '--condition-on-previous-text', 'False',
      '--hallucination-silence-threshold', '2',
      '--word-timestamps', 'True',
      '--output-dir', dir,
      '--output-name', 'texto',
      '--output-format', 'txt',
      '--verbose', 'False',
    ]);
    return (await readFile(join(dir, 'texto.txt'), 'utf8')).trim();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function execWhisper(bin, args) {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout: TIMEOUT_MS, env: { ...process.env, PATH } }, (error, _stdout, stderr) => {
      if (!error) {
        resolve();
        return;
      }
      console.error(`Error al transcribir: ${String(stderr || error.message).slice(-500)}`);
      reject(new OrderError(500, error.killed ? 'La transcripción ha tardado demasiado.' : 'No he podido transcribir el audio.'));
    });
  });
}
