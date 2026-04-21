#!/usr/bin/env bash
set -euo pipefail

# NavGator Codex plugin installer
# Usage: ./install-codex-plugin.sh [--user | --workspace]

SCOPE="${1:---user}"
BOLD="\033[1m"
GREEN="\033[0;32m"
YELLOW="\033[0;33m"
RED="\033[0;31m"
RESET="\033[0m"

info()  { echo -e "${BOLD}$1${RESET}"; }
ok()    { echo -e "${GREEN}$1${RESET}"; }
warn()  { echo -e "${YELLOW}$1${RESET}"; }
err()   { echo -e "${RED}$1${RESET}" >&2; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

update_marketplace() {
  local marketplace_path="$1"
  local marketplace_name="$2"
  local display_name="$3"
  local source_path="$4"

  mkdir -p "$(dirname "$marketplace_path")"

  node - <<'NODE' "$marketplace_path" "$marketplace_name" "$display_name" "$source_path"
const fs = require("fs");

const [marketplacePath, marketplaceName, displayName, sourcePath] = process.argv.slice(2);

let data = {
  name: marketplaceName,
  interface: { displayName },
  plugins: [],
};

if (fs.existsSync(marketplacePath)) {
  data = JSON.parse(fs.readFileSync(marketplacePath, "utf8"));
  if (!data || typeof data !== "object") data = {};
  if (!Array.isArray(data.plugins)) data.plugins = [];
  if (!data.interface || typeof data.interface !== "object") data.interface = {};
  if (!data.name) data.name = marketplaceName;
  if (!data.interface.displayName) data.interface.displayName = displayName;
}

const entry = {
  name: "navgator",
  source: {
    source: "local",
    path: sourcePath,
  },
  policy: {
    installation: "AVAILABLE",
    authentication: "ON_INSTALL",
  },
  category: "Coding",
};

const index = data.plugins.findIndex((plugin) => plugin && plugin.name === "navgator");
if (index >= 0) {
  data.plugins[index] = {
    ...data.plugins[index],
    ...entry,
    source: entry.source,
    policy: entry.policy,
  };
} else {
  data.plugins.push(entry);
}

fs.writeFileSync(marketplacePath, `${JSON.stringify(data, null, 2)}\n`);
NODE
}

case "$SCOPE" in
  --user)
    TARGET_DIR="$HOME/plugins"
    MARKETPLACE_PATH="$HOME/.agents/plugins/marketplace.json"
    LINK_PATH="$TARGET_DIR/navgator"
    info "Installing navgator for Codex at user scope..."
    mkdir -p "$TARGET_DIR" "$HOME/.agents/plugins"
    ln -sfn "$PLUGIN_ROOT" "$LINK_PATH"
    if [ -L "$TARGET_DIR/gator" ]; then
      warn "Removing legacy Codex alias ~/plugins/gator ..."
      rm -f "$TARGET_DIR/gator"
    fi
    update_marketplace "$MARKETPLACE_PATH" "local" "Local Plugins" "./plugins/navgator"
    echo ""
    ok "navgator Codex plugin installed for your user account."
    echo ""
    echo "  Plugin link: $LINK_PATH -> $PLUGIN_ROOT"
    echo "  Marketplace: $MARKETPLACE_PATH"
    echo ""
    warn "Restart Codex if the plugin does not appear immediately."
    ;;
  --workspace)
    MARKETPLACE_PATH="$PLUGIN_ROOT/.agents/plugins/marketplace.json"
    info "Refreshing repo-local Codex marketplace metadata..."
    update_marketplace "$MARKETPLACE_PATH" "navgator-local-workspace" "NavGator Workspace Plugins" "./"
    echo ""
    ok "navgator Codex workspace metadata refreshed."
    echo ""
    echo "  Marketplace: $MARKETPLACE_PATH"
    echo "  Source path: ./"
    echo ""
    warn "Open this repository as the Codex workspace, or symlink it into another workspace's plugins directory."
    ;;
  *)
    echo "Usage: $0 [--user | --workspace]"
    echo ""
    echo "  --user       Install for your Codex user account (~/.agents/plugins/marketplace.json)"
    echo "  --workspace  Refresh repo-local workspace metadata (.agents/plugins/marketplace.json)"
    exit 1
    ;;
esac
