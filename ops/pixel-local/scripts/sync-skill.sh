#!/bin/zsh
set -euo pipefail

OPS_DIR="${0:A:h:h}"
PROJECT_DIR="${OPS_DIR:h:h}"
SOURCE="$OPS_DIR/skill"
TARGET="$HOME/.codex/skills/pixel-local-editor"
MODE="${1:---check}"

compare_file() {
  local source_file="$1" target_file="$2"
  if [[ ! -f "$target_file" ]]; then
    echo "MISSING $target_file"
    return 1
  fi
  cmp -s "$source_file" "$target_file" || { echo "DIFF $target_file"; return 1; }
}

check_all() {
  local result=0
  compare_file "$SOURCE/SKILL.md" "$TARGET/SKILL.md" || result=1
  compare_file "$SOURCE/agents/openai.yaml" "$TARGET/agents/openai.yaml" || result=1
  compare_file "$SOURCE/scripts/check_bridge.mjs" "$TARGET/scripts/check_bridge.mjs" || result=1
  compare_file "$PROJECT_DIR/COMMAND_API.md" "$TARGET/references/command-api.md" || result=1
  [[ $result -eq 0 ]] && echo "Pixel Local Skill is synchronized."
  return $result
}

case "$MODE" in
  --check) check_all ;;
  --apply)
    mkdir -p "$TARGET/agents" "$TARGET/scripts" "$TARGET/references"
    cp "$SOURCE/SKILL.md" "$TARGET/SKILL.md"
    cp "$SOURCE/agents/openai.yaml" "$TARGET/agents/openai.yaml"
    cp "$SOURCE/scripts/check_bridge.mjs" "$TARGET/scripts/check_bridge.mjs"
    cp "$PROJECT_DIR/COMMAND_API.md" "$TARGET/references/command-api.md"
    echo "Pixel Local Skill synchronized to $TARGET"
    ;;
  *) echo "Usage: $0 [--check|--apply]" >&2; exit 2 ;;
esac
