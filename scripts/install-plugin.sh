#!/usr/bin/env bash
set -euo pipefail

# NavGator (gator) plugin installer for Claude Code
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
    LINK_NAME="gator"
    info "Installing gator plugin globally (all projects)..."
    ;;
  --project)
    TARGET_DIR=".claude/plugins"
    LINK_NAME="gator"
    info "Installing gator plugin for current project only..."
    ;;
  *)
    echo "Usage: $0 [--global | --project]"
    echo ""
    echo "  --global   Install for all projects (~/.claude/plugins/gator)"
    echo "  --project  Install for current project only (.claude/plugins/gator)"
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

# --- Clean up old navgator symlink ---
OLD_LINK="$HOME/.claude/plugins/navgator"
if [ -L "$OLD_LINK" ]; then
  warn "Removing old 'navgator' symlink..."
  rm -f "$OLD_LINK"
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
  ok "gator plugin installed successfully!"
  echo ""
  echo "  Location: $FULL_LINK -> $NAVGATOR_PATH"
  echo "  Scope:    $([ "$SCOPE" = "--global" ] && echo "all projects" || echo "current project only")"
  echo ""
  echo "  Available commands:"
  echo "    /gator:scan         Scan project architecture"
  echo "    /gator:status       Show architecture summary"
  echo "    /gator:impact       Analyze change impact"
  echo "    /gator:connections  Show component connections"
  echo "    /gator:diagram      Generate architecture diagram"
  echo "    /gator:export       Export architecture data"
  echo "    /gator:check        Run health checks"
  echo "    /gator:ui           Launch web dashboard"
  echo "    /gator:update       Update to latest version"
  echo "    /gator:install      Re-run this installer"
  echo ""
  warn "Restart Claude Code for changes to take effect."
else
  err "Installation failed — symlink not working."
  exit 1
fi
