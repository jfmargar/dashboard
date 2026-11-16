#!/bin/sh
# Quita el servicio del panel y la app de barra de menú.
set -u
LABEL="com.jfmargar.dashboard"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/$LABEL.plist"
pkill -x Dashboard 2>/dev/null || true
rm -rf "$HOME/Applications/Dashboard.app"
echo "Servicio y app quitados."
