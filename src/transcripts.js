import { readJsonlTail } from './files.js';
import { statSync } from 'node:fs';

// Últimos mensajes de una conversación, para enseñarlos en la ficha del personaje.
// Las fuentes apuntan aquí dónde está el registro de cada sesión mientras la leen.
const TAIL_BYTES = 768 * 1024;
const MAX_TAIL_BYTES = 16 * 1024 * 1024;
const MAX_TEXT = 16000;
const files = new Map();

export function registerTranscript(sessionId, agent, path) {
  if (path) files.set(sessionId, { agent, path });
}

// Dónde está el registro de una sesión y de qué agente es.
export function transcriptFile(sessionId) {
  return files.get(sessionId) ?? null;
}

export function transcriptVersion(sessionId) {
  const entry = files.get(sessionId);
  if (!entry) return null;
  try {
    const stat = statSync(entry.path);
    return `${stat.ino}:${stat.size}:${stat.mtimeMs}`;
  } catch {
    return null;
  }
}

export function readTranscript(sessionId, limit = 12) {
  const entry = files.get(sessionId);
  if (!entry) return null;
  let size;
  try { size = statSync(entry.path).size; } catch { return []; }
  let messages = [];
  // Las capturas pueden ocupar más que la ventana inicial. Amplía solo si faltan mensajes.
  for (let bytes = TAIL_BYTES; ; bytes = Math.min(bytes * 2, MAX_TAIL_BYTES)) {
    const rows = readJsonlTail(entry.path, bytes);
    messages = entry.agent === 'claude' ? fromClaude(rows) : fromCodex(rows);
    if (messages.filter((message) => message.role !== 'tool').length >= 4 || bytes >= size || bytes === MAX_TAIL_BYTES) break;
  }
  return compactTools(messages).slice(-limit);
}

// Texto que el agente o la app añaden por su cuenta (contexto, recordatorios, órdenes internas).
function isInjected(text) {
  const t = text.trimStart();
  return t.startsWith('<') || t.startsWith('# AGENTS.md') || t.startsWith('Caveat:');
}

function clip(text) {
  const t = String(text).trim();
  return t.length > MAX_TEXT ? `${t.slice(0, MAX_TEXT - 1)}…` : t;
}

function fromClaude(rows) {
  const out = [];
  for (const row of rows) {
    if ((row.type !== 'user' && row.type !== 'assistant') || row.isSidechain || row.isMeta) continue;
    const content = row.message?.content;
    const at = Date.parse(row.timestamp) || null;
    if (row.type === 'user') {
      const text = typeof content === 'string'
        ? content
        : Array.isArray(content) ? content.filter((p) => p.type === 'text').map((p) => p.text).join('\n') : '';
      if (text && !isInjected(text)) out.push({ role: 'user', text: clip(text), at });
      continue;
    }
    for (const part of Array.isArray(content) ? content : []) {
      if (part.type === 'text' && part.text?.trim()) out.push({ role: 'agent', text: clip(part.text), at });
      else if (part.type === 'tool_use') out.push({ role: 'tool', text: toolLabel(part.name, part.input), at });
    }
  }
  return out;
}

function fromCodex(rows) {
  const out = [];
  for (const row of rows) {
    if (row.type !== 'response_item') continue;
    const p = row.payload ?? {};
    const at = Date.parse(row.timestamp) || null;
    if (p.type === 'message' && (p.role === 'user' || p.role === 'assistant')) {
      const text = (p.content ?? []).map((c) => c.text ?? '').join('\n');
      if (!text.trim() || (p.role === 'user' && isInjected(text))) continue;
      out.push({ role: p.role === 'user' ? 'user' : 'agent', text: clip(text), at, ...(p.id ? { id: p.id } : {}) });
    } else if (p.type === 'function_call' || p.type === 'custom_tool_call' || p.type === 'local_shell_call') {
      let input = p.arguments ?? p.input;
      try {
        input = typeof input === 'string' ? JSON.parse(input) : input;
      } catch {
        // Argumentos en texto plano
      }
      out.push({ role: 'tool', text: toolLabel(p.name ?? 'herramienta', input), at });
    }
  }
  return out;
}

function toolLabel(name, input) {
  const detail = input && typeof input === 'object'
    ? input.command ?? input.cmd ?? input.file_path ?? input.path ?? input.pattern ?? input.description ?? input.query
    : input;
  const text = Array.isArray(detail) ? detail.join(' ') : detail;
  return text ? `${name}: ${String(text).replace(/\s+/g, ' ').slice(0, 140)}` : String(name);
}

// Varias herramientas seguidas se resumen en una línea para no tapar la conversación.
function compactTools(messages) {
  const out = [];
  for (const m of messages) {
    const last = out[out.length - 1];
    if (m.role === 'tool' && last && last.role === 'tool') {
      last.count = (last.count ?? 1) + 1;
      last.text = m.text;
      last.at = m.at;
    } else {
      out.push({ ...m });
    }
  }
  return out;
}
