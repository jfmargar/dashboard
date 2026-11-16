#!/bin/sh
# Rehace las capturas de docs/images y la imagen social a partir de la demo con datos inventados.
# Antes, arranca la demo (configuración `dashboard-demo` de .claude/launch.json, puerto 4320).
# Necesita las Command Line Tools de Xcode (swiftc) y cwebp (`brew install webp`).
set -eu
cd "$(dirname "$0")/.."
DEMO="${DEMO_URL:-http://localhost:4320/}"
OUT=docs/images
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

curl -fsS "${DEMO}api/state" >/dev/null || { echo "No responde la demo en $DEMO"; exit 1; }
swiftc docs/render.swift -o "$TMP/render"

shot() { # nombre ancho alto escala javascript ancho-final
  "$TMP/render" "$DEMO" "$TMP/$1.png" "$2" "$3" "$4" "$5" 3
  cwebp -quiet -q 85 -resize "$6" 0 "$TMP/$1.png" -o "$OUT/$1.webp"
}

shot oficina 1024 710 2 "document.getElementById('office-overview').click(); true" 800
shot misiones 1366 948 2 "document.getElementById('tab-missions').click(); true" 800
shot bandeja 1024 710 2 "document.getElementById('tab-inbox').click(); true" 800
shot ficha 1024 710 2 "fetch('/api/state').then(function (r) { return r.json(); }).then(function (s) {
  var blog = s.projects.filter(function (p) { return p.name === 'Blog'; })[0];
  window.Office.select(blog.sessions.filter(function (x) { return x.status === 'yours'; })[0].id);
}); true" 800
shot movil-oficina 375 812 2 "true" 750
shot movil-misiones 375 812 2 "document.getElementById('tab-missions').click(); true" 375

"$TMP/render" docs/social.html "$OUT/social.png" 1280 640 1 "true" 1
echo "Listo. Revisa docs/images antes de confirmar."
