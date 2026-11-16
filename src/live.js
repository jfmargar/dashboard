import { jobFor } from './orders.js';
import { readTranscript, transcriptVersion } from './transcripts.js';

// Solo la sesión abierta: consulta metadatos baratos y relee el registro si cambia.
export function liveSnapshot(sessionId) {
  let version;
  let messages = [];
  return () => {
    const next = transcriptVersion(sessionId);
    if (next !== version) {
      version = next;
      messages = readTranscript(sessionId) ?? [];
    }
    return { messages, order: jobFor(sessionId) };
  };
}

export function streamSession(res, snapshot, { intervalMs = 250, heartbeatMs = 15000 } = {}) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 2000\n\n');
  let previous;
  let lastWrite = Date.now();
  const tick = () => {
    if (res.destroyed || res.writableNeedDrain) return;
    try {
      const body = JSON.stringify(snapshot());
      if (body !== previous) {
        res.write(`data: ${body}\n\n`);
        previous = body;
        lastWrite = Date.now();
      } else if (Date.now() - lastWrite >= heartbeatMs) {
        res.write(': activo\n\n');
        lastWrite = Date.now();
      }
    } catch {
      res.end();
    }
  };
  const timer = setInterval(tick, intervalMs);
  res.once('close', () => clearInterval(timer));
  tick();
}
