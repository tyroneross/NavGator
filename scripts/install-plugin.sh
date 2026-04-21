#!/usr/bin/env bash
set -euo pipefail

# NavGator Claude Code plugin installer
# Usage: ./install-plugin.sh [--global | --project]

SCOPE="${1:---global}"
BOLD="\033[1m"
GREEN="\033[0;32m"
YELLOW="\033[0;33m"
RED="\033[0;31m"
RESET="\033[0m"

info()  { echo -e "${BOLD}$1${RESET}"; }
ok()    { echo -e "${GREEN}$1${RESET}"; }
warn()  { echo -e "${YELLOW}$1${RESET}"; }
err()   { echo -e "${RED}$1${RESET}" >&2; }

# --- Determine scope ---
case "$SCOPE" in
  --global)
    TARGET_DIR="$HOME/.claude/plugins"
    LINK_NAME="navgator"
    info "Installing navgator plugin globally for Claude Code..."
    ;;
  --project)
    TARGET_DIR=".claude/plugins"
    LINK_NAME="navgator"
    info "Installing navgator plugin for the current Claude Code project..."
    ;;
  *)
    echo "Usage: $0 [--global | --project]"
    echo ""
    echo "  --global   Install for all Claude projects (~/.claude/plugins/navgator)"
    echo "  --project  Install for the current Claude project (.claude/plugins/navgator)"
    echo ""
    echo "For Codex installs, run: bash scripts/install-codex-plugin.sh [--user | --workspace]"
    exit 1
    ;;
esac

# --- Check/install npm package ---
NPM_ROOT=$(npm root -g 2>/dev/null)
NAVGATOR_PATH="$NPM_ROOT/@tyroneross/navgator"

if [ ! -d "$NAVGATOR_PATH" ]; then
  warn "NavGator not found globally. Installing..."
  npm install -g @tyroneross/navgator
  NAVGATOR_PATH="$NPM_ROOT/@tyroneross/navgator"
fi

if [ ! -f "$NAVGATOR_PATH/.claude-plugin/plugin.json" ]; then
  err "Error: plugin.json not found at $NAVGATOR_PATH/.claude-plugin/plugin.json"
  err "Try: npm install -g @tyroneross/navgator@latest"
  exit 1
fi

# --- Clean up old navgator alias ---
OLD_ALIAS="$TARGET_DIR/navgator"
if [ -L "$OLD_ALIAS" ]; then
  warn "Removing legacy 'navgator' Claude plugin alias..."
  rm -f "$OLD_ALIAS"
fi

# --- Create symlink ---
mkdir -p "$TARGET_DIR"
FULL_LINK="$TARGET_DIR/$LINK_NAME"

if [ -L "$FULL_LINK" ]; then
  warn "Updating existing symlink..."
  rm -f "$FULL_LINK"
fi

ln -sfn "$NAVGATOR_PATH" "$FULL_LINK"

# --- Verify ---
if [ -f "$FULL_LINK/.claude-plugin/plugin.json" ]; then
  echo ""
  ok "navgator Claude plugin installed successfully!"
  echo ""
  echo "  Location: $FULL_LINK -> $NAVGATOR_PATH"
  echo "  Scope:    $([ "$SCOPE" = "--global" ] && echo "all projects" || echo "current project only")"
  echo ""
  echo "  Claude slash commands:"
  echo "    /navgator:scan"
  echo "    /navgator:map"
  echo "    /navgator:trace"
  echo "    /navgator:impact"
  echo "    /navgator:test"
  echo "    /navgator:review"
  echo "    /navgator:llm-map"
  echo "    /navgator:schema"
  echo "    /navgator:dead"
  echo "    /navgator:lessons"
  echo ""
  echo "  Codex install:"
  echo "    bash scripts/install-codex-plugin.sh --user"
  echo ""
  warn "Restart Claude Code for changes to take effect."
else
  err "Installation failed — symlink not working."
  exit 1
fi
