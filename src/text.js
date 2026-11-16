const MAX_TITLE = 90;

// Convierte el primer mensaje de una sesión en un título corto y legible.
export function cleanTitle(raw) {
  if (!raw) return '';
  const text = String(raw)
    .replace(/<[^>]+>[\s\S]*?<\/[^>]+>/g, ' ')
    .replace(/^#+\s.*$/gm, ' ');
  // Codex añade los ficheros adjuntos antes de "## My request:".
  const request = text.split(/##\s*My request:\s*/i).pop();
  const line = request
    .split('\n')
    .map((l) => l.replace(/^#+\s+/, '').replace(/[*`>_]/g, '').trim())
    .find((l) => l.length > 0);
  if (!line) return '';
  return line.length > MAX_TITLE ? `${line.slice(0, MAX_TITLE - 1).trimEnd()}…` : line;
}
