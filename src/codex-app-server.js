import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { createInterface } from 'node:readline';

// Cliente del `codex app-server`, el mismo motor que usan la app de escritorio y la extensión de VS Code.
// Cada orden tiene su proceso: cerrarlo al terminar libera el hilo para la app.
// Los hilos que crea quedan registrados como los de la app (origen `vscode`), así que aparecen en ella.
const CLIENT_INFO = { name: 'dashboard', title: 'Dashboard', version: '0.4.0' };
const REQUEST_TIMEOUT_MS = 60 * 1000;

export function createCodexAppServer({ bin, env }) {
  let child = null;
  let ready = null;
  let nextId = 1;
  let closing = null;
  let disposed = false;
  const pending = new Map();
  const watchers = new Map();

  function start() {
    if (disposed) return Promise.reject(new Error('La orden de Codex ya ha liberado la sesión.'));
    if (ready) return ready;
    child = spawn(bin, ['app-server'], { cwd: homedir(), env, stdio: ['pipe', 'pipe', 'pipe'] });
    const lines = createInterface({ input: child.stdout });
    lines.on('line', handleLine);
    child.stderr.on('data', () => {});
    child.on('error', (error) => shutdown(`No se pudo arrancar el app-server de Codex: ${error.message}`));
    child.on('close', (code) => shutdown(`El app-server de Codex se cerró (código ${code}).`));

    ready = rawRequest('initialize', { clientInfo: CLIENT_INFO, capabilities: { experimentalApi: true } })
      .then(() => {
        send({ method: 'initialized', params: {} });
      })
      .catch((error) => {
        ready = null;
        throw error;
      });
    return ready;
  }

  function send(message) {
    if (!child || !child.stdin.writable) throw new Error('El app-server de Codex no está en marcha.');
    child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  function rawRequest(method, params) {
    return new Promise((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Codex no respondió a ${method}.`));
      }, REQUEST_TIMEOUT_MS);
      pending.set(id, { resolve, reject, timer });
      try {
        send({ id, method, params });
      } catch (error) {
        clearTimeout(timer);
        pending.delete(id);
        reject(error);
      }
    });
  }

  async function request(method, params) {
    await start();
    return rawRequest(method, params);
  }

  function respond(id, result) {
    send({ id, result });
  }

  // Cada hilo con un turno en marcha tiene quien escuche sus avisos y peticiones de aprobación.
  function watch(threadId, handlers) {
    watchers.set(threadId, handlers);
  }

  function unwatch(threadId) {
    watchers.delete(threadId);
  }

  function threadIdOf(params) {
    return params?.threadId ?? params?.thread?.id ?? params?.turn?.threadId ?? null;
  }

  function handleLine(line) {
    if (disposed) return;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    // Respuesta a una petición nuestra
    if (message.id !== undefined && !message.method) {
      const entry = pending.get(message.id);
      if (!entry) return;
      pending.delete(message.id);
      clearTimeout(entry.timer);
      if (message.error) entry.reject(new Error(message.error.message ?? 'Codex devolvió un error.'));
      else entry.resolve(message.result ?? {});
      return;
    }
    const handlers = watchers.get(threadIdOf(message.params));
    // Petición del servidor (aprobaciones): sin nadie escuchando, se cancela
    if (message.id !== undefined && message.method) {
      if (handlers?.onServerRequest) handlers.onServerRequest(message);
      else respond(message.id, cancelResult(message));
      return;
    }
    if (message.method && handlers?.onNotification) handlers.onNotification(message);
  }

  function shutdown(reason) {
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(new Error(reason));
    }
    pending.clear();
    const listeners = [...watchers.values()];
    watchers.clear();
    child = null;
    ready = null;
    for (const handlers of listeners) handlers.onExit?.(reason);
  }

  function close() {
    if (closing) return closing;
    disposed = true;
    const process = child;
    closing = !process ? Promise.resolve() : new Promise((resolve) => {
      const force = setTimeout(() => process.kill('SIGKILL'), 3000);
      process.once('close', () => { clearTimeout(force); resolve(); });
      process.kill('SIGTERM');
    });
    shutdown('La orden de Codex ha terminado.');
    return closing;
  }

  return { request, respond, watch, unwatch, close };
}

// Respuesta neutra a una petición que nadie va a contestar.
export function cancelResult(message) {
  if (message.method === 'item/permissions/requestApproval') return { permissions: {}, scope: 'turn' };
  if (message.method === 'mcpServer/elicitation/request') return { action: 'cancel', content: null };
  return { decision: 'cancel' };
}
