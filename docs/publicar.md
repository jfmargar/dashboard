# Publicar en GitHub

Lo que hay que ajustar a mano en GitHub. Nada de esto lo hace el código.

## Datos del repositorio

- **Descripción:** `Una oficina en pixel art con tus sesiones de Codex y Claude Code: quién trabaja, quién te espera y contestar desde la tablet. Node 24, sin dependencias.`
- **Web:** `https://jfmargar.github.io/dashboard/`
- **Topics:**

```text
claude-code codex ai-agents coding-agents agent-monitoring dashboard pixel-art macos menu-bar-app tailscale nodejs zero-dependencies self-hosted developer-tools
```

Con `gh`, una vez público:

```bash
gh repo edit jfmargar/dashboard --description "Una oficina en pixel art con tus sesiones de Codex y Claude Code: quién trabaja, quién te espera y contestar desde la tablet. Node 24, sin dependencias." --homepage "https://jfmargar.github.io/dashboard/" --add-topic claude-code,codex,ai-agents,coding-agents,agent-monitoring,dashboard,pixel-art,macos,menu-bar-app,tailscale,nodejs,zero-dependencies,self-hosted,developer-tools
```

## Vista previa social

`docs/images/social.png` (1280×640) se sube en **Settings → General → Social preview**; GitHub no la lee del repositorio. La página de `docs/` ya la anuncia en sus etiquetas `og:image`.

Sale de `docs/social.html` y se rehace con `docs/capturas.sh` (ver Capturas).

## GitHub Pages

**Settings → Pages → Build and deployment:** *Deploy from a branch*, rama `main`, carpeta `/docs`. La página es `docs/index.html`, estática y sin compilar. Para verla en local: configuración `dashboard-docs` de `.claude/launch.json` (puerto 4330).

## Capturas

Las capturas de `docs/images/` salen de la demo con datos inventados, nunca del panel de verdad: enseñaría títulos de sesiones de clientes. Con la demo en marcha (`dashboard-demo` en `.claude/launch.json`, puerto 4320), un solo comando las rehace todas, junto con la imagen social:

```bash
docs/capturas.sh
```

Usa `docs/render.swift` (WebKit, sin datos guardados entre capturas) y `cwebp` (`brew install webp`). La demo se regenera al arrancar, así que las horas son las del momento.

El icono (`docs/images/icon.png` y `docs/favicon.png`) sale de `macos/AppIcon.icns`:

```bash
iconutil -c iconset macos/AppIcon.icns -o /tmp/AppIcon.iconset
cp /tmp/AppIcon.iconset/icon_256x256.png docs/images/icon.png
cp /tmp/AppIcon.iconset/icon_32x32.png docs/favicon.png
```
