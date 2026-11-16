import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { OrderError } from './orders.js';
import { binCandidates } from './bins.js';

// Destinos de la bandeja. Cada uno se lanza con execFile y argumentos separados, nunca por shell,
// así que el texto dictado no puede colarse como comando. Solo se crea: nada se cierra ni se borra.
const BINS = {
  glab: binCandidates('GLAB_BIN', ['/opt/homebrew/bin/glab', '/usr/local/bin/glab']),
  gh: binCandidates('GH_BIN', ['/opt/homebrew/bin/gh', '/usr/local/bin/gh']),
};
const CHILD_PATH = [join(homedir(), '.local/bin'), '/opt/homebrew/bin', '/usr/local/bin', process.env.PATH].join(':');
const TIMEOUT_MS = 60 * 1000;

export function binFor(name) {
  return BINS[name].find((path) => path && existsSync(path)) ?? null;
}

// Qué destinos admite un proyecto del catálogo, para pintar los botones.
export function destinationsFor(entry) {
  const list = [];
  if (entry?.repo?.kind === 'gitlab' && binFor('glab')) list.push('gitlab');
  if (entry?.repo?.kind === 'github' && binFor('gh')) list.push('github');
  return list;
}

// Lo que se va a ejecutar, para enseñarlo en la confirmación y para ejecutarlo después: lo mismo.
export function issueCommand(entry, { title, description }) {
  const kind = entry?.repo?.kind;
  if (kind === 'gitlab') {
    return {
      kind,
      bin: 'glab',
      env: { GITLAB_HOST: entry.repo.host },
      args: ['issue', 'create', '-R', entry.repo.path, '--title', title, '--description', description, '--assignee', '@me', '--yes'],
      target: entry.repo.path,
    };
  }
  if (kind === 'github') {
    return {
      kind,
      bin: 'gh',
      env: {},
      args: ['issue', 'create', '-R', entry.repo.path, '--title', title, '--body', description, '--assignee', '@me'],
      target: entry.repo.path,
    };
  }
  throw new OrderError(400, 'Este proyecto no tiene un repo de GitLab o GitHub al que mandar issues.');
}

export async function createIssue(entry, plan) {
  const command = issueCommand(entry, plan);
  const bin = binFor(command.bin);
  if (!bin) throw new OrderError(503, `No encuentro el CLI de ${command.bin}.`);
  const output = await run(bin, command.args, command.env);
  // Los dos CLI terminan imprimiendo la URL del issue creado.
  const url = output.match(/https?:\/\/\S+/g)?.pop();
  if (!url) throw new OrderError(502, `${command.bin} no devolvió la dirección del issue.`);
  const number = /\/(?:issues|work_items)\/(\d+)/.exec(url)?.[1];
  return {
    kind: command.kind,
    ref: number ? `${command.target}#${number}` : command.target,
    url,
    repo: entry.repo.path,
    host: entry.repo.host,
    number: number ? Number(number) : null,
  };
}

// ¿Está cerrado el issue? null si no se puede saber (sin número, sin CLI o sin red).
export async function issueClosed(sent) {
  if (!sent.number || !sent.repo) return null;
  if (sent.kind === 'gitlab') {
    const bin = binFor('glab');
    if (!bin) return null;
    const output = await run(bin, ['issue', 'view', String(sent.number), '-R', sent.repo, '--output', 'json'], { GITLAB_HOST: sent.host });
    // El hito y otros objetos del issue también llevan `state`: vale el del propio issue.
    return topLevelState(output) === 'closed';
  }
  if (sent.kind === 'github') {
    const bin = binFor('gh');
    if (!bin) return null;
    const output = await run(bin, ['issue', 'view', String(sent.number), '-R', sent.repo, '--json', 'state'], {});
    return topLevelState(output) === 'CLOSED';
  }
  return null;
}

// `state` del objeto JSON que imprime el CLI; null si la salida no es el JSON esperado.
function topLevelState(output) {
  const start = output.indexOf('{');
  const end = output.lastIndexOf('}');
  if (start < 0 || end < start) return null;
  try {
    const state = JSON.parse(output.slice(start, end + 1)).state;
    return typeof state === 'string' ? state : null;
  } catch {
    return null;
  }
}

function run(bin, args, env) {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout: TIMEOUT_MS, env: { ...process.env, PATH: CHILD_PATH, ...env } }, (error, stdout, stderr) => {
      if (!error) {
        resolve(`${stdout}\n${stderr}`);
        return;
      }
      const detail = String(stderr || stdout || error.message).trim().split('\n').slice(-3).join(' ');
      console.error(`${bin} ${args.slice(0, 2).join(' ')}: ${detail}`);
      reject(new OrderError(502, error.killed ? 'El CLI ha tardado demasiado.' : `No se ha podido crear: ${detail}`));
    });
  });
}
