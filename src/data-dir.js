import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Carpeta de los datos propios del panel (bandeja, catálogo aprendido, sesiones lanzadas…).
// `DASHBOARD_DATA_DIR` la cambia, para que las pruebas no toquen los datos de verdad.
export const DATA_DIR = process.env.DASHBOARD_DATA_DIR
  ? `${resolve(process.env.DASHBOARD_DATA_DIR)}/`
  : fileURLToPath(new URL('../data/', import.meta.url));
