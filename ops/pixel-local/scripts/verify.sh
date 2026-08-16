#!/bin/zsh
set -euo pipefail

OPS_DIR="${0:A:h:h}"
PROJECT_DIR="${OPS_DIR:h:h}"
CONFIG="$HOME/.codex/config.toml"
PLIST="$HOME/Library/LaunchAgents/com.pixel-local.bridge.plist"

for file in \
  "$PROJECT_DIR/tools/pixel-local-mcp/server.mjs" \
  "$PROJECT_DIR/tools/pixel-local-bridge/daemon.mjs" \
  "$PROJECT_DIR/tools/pixel-local-bridge/com.pixel-local.bridge.plist.template" \
  "$OPS_DIR/skill/SKILL.md"; do
  [[ -f "$file" ]] || { echo "Missing project source: $file" >&2; exit 1; }
done

grep -Fq "$PROJECT_DIR/tools/pixel-local-mcp/server.mjs" "$CONFIG" || { echo "Codex MCP config does not point to project source." >&2; exit 1; }
[[ -f "$PLIST" ]] || { echo "LaunchAgent is not installed." >&2; exit 1; }
plutil -p "$PLIST" | grep -Fq "$PROJECT_DIR/tools/pixel-local-bridge/daemon.mjs" || { echo "LaunchAgent does not point to project source." >&2; exit 1; }

node "$OPS_DIR/skill/scripts/check_bridge.mjs"
echo "Pixel Local project source, MCP registration, LaunchAgent and bridge health verified."
