# Contribuir

Gracias por tu interés. Issues y pull requests son bienvenidos.

## Antes de empezar

- Node.js 24 o posterior. No hay dependencias de npm, y la idea es seguir así salvo que de verdad compense.
- Lee [AGENTS.md](AGENTS.md): explica cómo está montado el panel y sus reglas (no escribir nunca en `~/.claude` ni en `~/.codex`, textos de la interfaz en español, sin exponer el servidor a internet).
- Para ver la interfaz sin tus datos reales, arranca la demo: `node tests/fixtures/demo-world.js` y después el servidor con las variables que imprime, o la configuración `dashboard-demo` de `.claude/launch.json`.

## Ramas

El repo usa Gitflow. Crea tu rama `feature/<descripción>` desde `develop` y abre el pull request contra `develop`. Las versiones salen de `release/*` hacia `main`.

## Antes de abrir el pull request

- `npm test` en verde.
- Si cambia la interfaz, compruébala a 375 px, 768 px y en escritorio, sin scroll horizontal.
- Si cambia algo visible para quien lo usa, añádelo a `[Unreleased]` en el [CHANGELOG](CHANGELOG.md).
