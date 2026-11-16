import { openSync, readSync, closeSync, fstatSync } from 'node:fs';

// Lee los últimos `bytes` de un fichero JSONL y devuelve sus líneas completas ya parseadas.
export function readJsonlTail(path, bytes) {
  return readJsonl(path, bytes, 'tail');
}

// Lee los primeros `bytes` de un fichero JSONL y devuelve sus líneas completas ya parseadas.
export function readJsonlHead(path, bytes) {
  return readJsonl(path, bytes, 'head');
}

// Busca desde el final sin limitar la distancia del evento ni cargar capturas enormes.
export function findLastJsonl(path, predicate) {
  let match = null;
  scanJsonlBackward(path, (row) => {
    if (!predicate(row)) return false;
    match = row;
    return true;
  });
  return match;
}

// Recorre las líneas desde el final hasta que `visit` devuelve true o se pasa de `maxBytes`.
// Las líneas de más de 256 KB (capturas) se saltan sin cargarlas. Devuelve hasta dónde llega la
// última línea completa, para seguir leyendo desde ahí cuando el fichero crezca.
export function scanJsonlBackward(path, visit, maxBytes = Infinity) {
  let fd;
  try {
    fd = openSync(path, 'r');
    const size = fstatSync(fd).size;
    let position = size;
    let complete = null;
    let pending = Buffer.alloc(0);
    let oversized = false;
    const maxLine = 256 * 1024;
    const consume = (part, whole) => {
      if (!oversized) {
        if (part.length + pending.length > maxLine) oversized = true;
        else pending = Buffer.concat([part, pending]);
      }
      if (!whole) return false;
      let stop = false;
      if (!oversized && pending.length) {
        try {
          stop = Boolean(visit(JSON.parse(pending.toString('utf8'))));
        } catch { /* Línea incompleta o ajena a JSON. */ }
      }
      pending = Buffer.alloc(0);
      oversized = false;
      return stop;
    };
    while (position > 0 && size - position < maxBytes) {
      const length = Math.min(position, 64 * 1024);
      position -= length;
      const chunk = Buffer.alloc(length);
      readSync(fd, chunk, 0, length, position);
      let end = chunk.length;
      for (let i = chunk.length - 1; i >= 0; i--) {
        if (chunk[i] !== 10) continue;
        if (complete === null) {
          // Lo que va tras el último salto de línea aún se está escribiendo.
          complete = position + i + 1;
          end = i;
          continue;
        }
        if (consume(chunk.subarray(i + 1, end), true)) return { end: complete };
        end = i;
      }
      if (complete !== null && consume(chunk.subarray(0, end), position === 0)) return { end: complete };
    }
    return { end: complete ?? 0 };
  } catch {
    return { end: 0 };
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

// Líneas completas entre `start` y el final del fichero, y dónde acaba la última completa.
export function readJsonlFrom(path, start) {
  let fd;
  try {
    fd = openSync(path, 'r');
    const size = fstatSync(fd).size;
    if (size <= start) return { rows: [], end: start };
    const buffer = Buffer.alloc(size - start);
    readSync(fd, buffer, 0, buffer.length, start);
    const last = buffer.lastIndexOf(10);
    if (last < 0) return { rows: [], end: start };
    const rows = [];
    for (const line of buffer.toString('utf8', 0, last).split('\n')) {
      if (!line.trim()) continue;
      try {
        rows.push(JSON.parse(line));
      } catch {
        // Línea corrupta: se ignora.
      }
    }
    return { rows, end: start + last + 1 };
  } catch {
    return { rows: [], end: start };
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

// Lee los primeros `bytes` de un fichero como texto, sin interpretar.
export function readTextHead(path, bytes) {
  let fd;
  try {
    fd = openSync(path, 'r');
    const buffer = Buffer.alloc(bytes);
    const read = readSync(fd, buffer, 0, bytes, 0);
    return buffer.toString('utf8', 0, read);
  } catch {
    return '';
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function readJsonl(path, bytes, side) {
  let fd;
  try {
    fd = openSync(path, 'r');
    const { size } = fstatSync(fd);
    const length = Math.min(size, bytes);
    const start = side === 'tail' ? size - length : 0;
    const buffer = Buffer.alloc(length);
    readSync(fd, buffer, 0, length, start);
    const lines = buffer.toString('utf8').split('\n');
    // Descarta la línea cortada por el límite de bytes.
    if (side === 'tail' && start > 0) lines.shift();
    if (side === 'head' && length < size) lines.pop();
    const rows = [];
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        rows.push(JSON.parse(line));
      } catch {
        // Línea a medio escribir: se ignora.
      }
    }
    return rows;
  } catch {
    return [];
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
