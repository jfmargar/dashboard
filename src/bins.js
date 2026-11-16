// Rutas candidatas de un CLI. Si la variable de entorno está puesta (por ejemplo, un CLI falso para
// pruebas), es la única candidata: si esa ruta no existe, no hay CLI. Así una prueba nunca acaba
// usando el de verdad y creando issues, tareas o sesiones reales.
export function binCandidates(envName, defaults) {
  const override = process.env[envName];
  return override ? [override] : defaults;
}
