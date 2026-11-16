#!/bin/sh
# Instala el panel como servicio de macOS (arranca al iniciar sesión y se reinicia si se cae)
# y compila la app de barra de menú en ~/Applications/Dashboard.app.
set -eu

LABEL="com.jfmargar.dashboard"
HERE="$(cd "$(dirname "$0")" && pwd)"
# Carpeta del panel que ejecutará el servicio (por defecto, la del propio repositorio)
REPO="${DASHBOARD_REPO:-$(cd "$HERE/.." && pwd)}"
NODE="$(command -v node)"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/Dashboard.log"
APP="$HOME/Applications/Dashboard.app"
BUILD="$(mktemp -d)"
DOMAIN="gui/$(id -u)"

# Servicio
mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE</string>
    <string>$REPO/src/server.js</string>
  </array>
  <key>WorkingDirectory</key><string>$REPO</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
PLIST
launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
# bootout vuelve antes de que el servicio termine de pararse; si se carga demasiado pronto falla con
# "Bootstrap failed: 5", así que se espera a que desaparezca y se reintenta unas veces.
for _ in 1 2 3 4 5 6 7 8 9 10; do
  launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1 || break
  sleep 0.5
done
for attempt in 1 2 3 4 5; do
  launchctl bootstrap "$DOMAIN" "$PLIST" 2>/dev/null && break
  [ "$attempt" = 5 ] && launchctl bootstrap "$DOMAIN" "$PLIST"
  sleep 1
done
echo "Servicio $LABEL instalado (registro en $LOG)."

# App de barra de menú
mkdir -p "$BUILD/Dashboard.app/Contents/MacOS"
swiftc -O -swift-version 5 "$HERE/DashboardMenu.swift" -o "$BUILD/Dashboard.app/Contents/MacOS/Dashboard"
cat > "$BUILD/Dashboard.app/Contents/Info.plist" <<INFO
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key><string>$LABEL.menu</string>
  <key>CFBundleName</key><string>Dashboard</string>
  <key>CFBundleExecutable</key><string>Dashboard</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>0.4.0</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>LSUIElement</key><true/>
</dict>
</plist>
INFO
mkdir -p "$BUILD/Dashboard.app/Contents/Resources"
cp "$HERE/AppIcon.icns" "$BUILD/Dashboard.app/Contents/Resources/AppIcon.icns"
codesign --force --sign - "$BUILD/Dashboard.app" >/dev/null 2>&1
mkdir -p "$HOME/Applications"
pkill -x Dashboard 2>/dev/null || true
rm -rf "$APP"
mv "$BUILD/Dashboard.app" "$APP"
open "$APP"
echo "App instalada en $APP."
