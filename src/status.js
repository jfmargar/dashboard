// Estados de una sesión tal y como los ve el panel:
// - working: el agente está en mitad de un turno.
// - yours:   el agente terminó su turno hace poco y le toca al usuario.
// - idle:    la sesión lleva tiempo parada.
// - done:    (lo decide state.js) terminó su turno sin preguntarte nada; ver `needsYou` en tasks.js.
export const WORKING_WINDOW_MS = 15 * 60 * 1000;
export const YOURS_WINDOW_MS = 4 * 60 * 60 * 1000;

export function resolveStatus({ turnOpen, lastActivity, now = Date.now() }) {
  const age = now - lastActivity;
  if (turnOpen && age <= WORKING_WINDOW_MS) return 'working';
  if (turnOpen === false && age <= YOURS_WINDOW_MS) return 'yours';
  return 'idle';
}
