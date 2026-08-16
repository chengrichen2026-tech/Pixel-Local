#!/bin/zsh
set -euo pipefail
ACTION="${1:-status}"; LABEL="com.pixel-local.bridge"; PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
PROJECT_DIR="${0:A:h:h}"; NODE_BIN="$(command -v node)"; LOG_DIR="$PROJECT_DIR/.runtime"
install_service() {
  mkdir -p "$HOME/Library/LaunchAgents" "$LOG_DIR"
  local temp_plist="$(mktemp)"
  sed -e "s|__LABEL__|$LABEL|g" -e "s|__NODE__|$NODE_BIN|g" -e "s|__DAEMON__|$PROJECT_DIR/tools/pixel-local-bridge/daemon.mjs|g" -e "s|__LOG_DIR__|$LOG_DIR|g" "$PROJECT_DIR/tools/pixel-local-bridge/com.pixel-local.bridge.plist.template" > "$temp_plist"
  mv "$temp_plist" "$PLIST"
  launchctl bootout "gui/$UID/$LABEL" >/dev/null 2>&1 || true
  launchctl bootstrap "gui/$UID" "$PLIST"; launchctl kickstart -k "gui/$UID/$LABEL"
  echo "Pixel Local bridge installed and started."
}
uninstall_service() {
  launchctl bootout "gui/$UID/$LABEL" >/dev/null 2>&1 || true
  if [[ -f "$PLIST" ]]; then mv "$PLIST" "$HOME/.Trash/$LABEL.$(date +%Y%m%d%H%M%S).plist"; fi
  echo "Pixel Local bridge stopped; plist moved to Trash."
}
case "$ACTION" in
  install) install_service;; uninstall) uninstall_service;; restart) launchctl kickstart -k "gui/$UID/$LABEL";;
  status) launchctl print "gui/$UID/$LABEL" 2>/dev/null || { echo "Pixel Local bridge is not installed."; exit 1; };;
  *) echo "Usage: $0 {install|uninstall|restart|status}" >&2; exit 2;;
esac
