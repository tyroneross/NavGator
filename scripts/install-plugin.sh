#!/usr/bin/env bash
set -euo pipefail

# NavGator Claude Code plugin installer
# Usage: ./scripts/install-plugin.sh [--global | --project]

SCOPE="${1:---global}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PACKAGE_SOURCE="${NAVGATOR_PACKAGE_SOURCE:-$PLUGIN_ROOT}"
PLUGIN_ID="navgator@navgator"

BOLD="\033[1m"
GREEN="\033[0;32m"
YELLOW="\033[0;33m"
RED="\033[0;31m"
RESET="\033[0m"

info() { echo -e "${BOLD}$1${RESET}"; }
ok() { echo -e "${GREEN}$1${RESET}"; }
warn() { echo -e "${YELLOW}$1${RESET}"; }
err() { echo -e "${RED}$1${RESET}" >&2; }

assert_safe_tree() {
  local root_path="$1"
  shift

  node - "$root_path" "$@" <<'NODE'
const fs = require('fs')
const path = require('path')

const [rootInput, ...relativePaths] = process.argv.slice(2)
const resolvedRoot = path.resolve(rootInput)
const rootStat = fs.lstatSync(resolvedRoot)
if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
  throw new Error(`Destination root must be a real directory: ${resolvedRoot}`)
}

const canonicalRoot = fs.realpathSync(resolvedRoot)
for (const relativePath of relativePaths) {
  if (path.isAbsolute(relativePath)) {
    throw new Error(`Destination must be relative to ${canonicalRoot}: ${relativePath}`)
  }
  const normalized = path.normalize(relativePath)
  if (normalized === '..' || normalized.startsWith(`..${path.sep}`)) {
    throw new Error(`Destination escapes ${canonicalRoot}: ${relativePath}`)
  }

  let current = canonicalRoot
  for (const segment of normalized.split(path.sep).filter((part) => part && part !== '.')) {
    current = path.join(current, segment)
    let stat
    try {
      stat = fs.lstatSync(current)
    } catch (error) {
      if (error?.code === 'ENOENT') continue
      throw error
    }
    if (stat.isSymbolicLink()) {
      throw new Error(`Refusing symlinked destination component: ${current}`)
    }
  }
}

process.stdout.write(canonicalRoot)
NODE
}

case "$SCOPE" in
  --global)
    CLAUDE_SCOPE="user"
    if [ -n "${CLAUDE_CONFIG_DIR:-}" ]; then
      CLAUDE_BOUNDARY="$(dirname "$CLAUDE_CONFIG_DIR")"
      CLAUDE_RELATIVE_ROOT="$(basename "$CLAUDE_CONFIG_DIR")"
    else
      CLAUDE_BOUNDARY="$HOME"
      CLAUDE_RELATIVE_ROOT=".claude"
    fi
    SCOPE_LABEL="all projects"
    ;;
  --project)
    CLAUDE_SCOPE="project"
    CLAUDE_BOUNDARY="${NAVGATOR_WORKSPACE_ROOT:-$PWD}"
    CLAUDE_RELATIVE_ROOT=".claude"
    SCOPE_LABEL="current project"
    ;;
  *)
    echo "Usage: $0 [--global | --project]"
    echo ""
    echo "  --global   Install and enable NavGator at Claude user scope"
    echo "  --project  Install and enable NavGator for the current project"
    echo ""
    echo "For Codex marketplace registration, run:"
    echo "  bash scripts/install-codex-plugin.sh [--user | --workspace]"
    exit 1
    ;;
esac

command -v npm >/dev/null 2>&1 || {
  err "npm is required to materialize NavGator."
  exit 1
}
command -v node >/dev/null 2>&1 || {
  err "Node.js >=20.11.0 is required to run NavGator."
  exit 1
}
if ! node -e '
const [major, minor] = process.versions.node.split(".").map(Number)
process.exit(major > 20 || (major === 20 && minor >= 11) ? 0 : 1)
'; then
  err "NavGator requires Node.js >=20.11.0 (found $(node --version 2>/dev/null || echo unknown))."
  exit 1
fi

CLAUDE_BOUNDARY="$(assert_safe_tree \
  "$CLAUDE_BOUNDARY" \
  "$CLAUDE_RELATIVE_ROOT" \
  "$CLAUDE_RELATIVE_ROOT/navgator-runtime" \
  "$CLAUDE_RELATIVE_ROOT/navgator-runtime/node_modules" \
  "$CLAUDE_RELATIVE_ROOT/navgator-runtime/node_modules/@tyroneross" \
  "$CLAUDE_RELATIVE_ROOT/navgator-runtime/node_modules/@tyroneross/navgator" \
  "$CLAUDE_RELATIVE_ROOT/plugins" \
  "$CLAUDE_RELATIVE_ROOT/plugins/cache" \
  "$CLAUDE_RELATIVE_ROOT/plugins/known_marketplaces.json" \
  "$CLAUDE_RELATIVE_ROOT/plugins/installed_plugins.json" \
  "$CLAUDE_RELATIVE_ROOT/plugins/gator")"
CLAUDE_ROOT="$CLAUDE_BOUNDARY/$CLAUDE_RELATIVE_ROOT"
RUNTIME_ROOT="$CLAUDE_ROOT/navgator-runtime"
LEGACY_PATH="$CLAUDE_ROOT/plugins/gator"

command -v claude >/dev/null 2>&1 || {
  err "Claude Code is required to register and enable the plugin."
  exit 1
}

ensure_no_legacy_registry() {
  local legacy_enabled
  legacy_enabled="$(
    claude plugin list --json | node -e '
let input = ""
process.stdin.setEncoding("utf8")
process.stdin.on("data", (chunk) => { input += chunk })
process.stdin.on("end", () => {
  const plugins = JSON.parse(input)
  const legacy = plugins.filter(
    (item) => item.id === "navgator@rosslabs-ai-toolkit" && item.enabled,
  )
  process.stdout.write(legacy.map((item) => `${item.id}\t${item.scope}`).join("\n"))
})
'
  )"

  if [ -n "$legacy_enabled" ]; then
    err "A legacy NavGator registry entry is still enabled and would duplicate plugin capabilities."
    while IFS=$'\t' read -r legacy_id legacy_scope; do
      err "Disable it with: claude plugin disable $legacy_id --scope $legacy_scope"
    done <<< "$legacy_enabled"
    err "Then rerun this installer so NavGator can verify a single active surface."
    exit 1
  fi
}

# Fail before materialization/registration so an abandoned install cannot leave
# both the legacy and current plugin surfaces enabled.
ensure_no_legacy_registry

info "Materializing NavGator for Claude Code ($SCOPE_LABEL)..."
mkdir -p "$RUNTIME_ROOT"
npm install \
  --prefix "$RUNTIME_ROOT" \
  --ignore-scripts \
  --omit=dev \
  --no-audit \
  --no-fund \
  --install-links=true \
  "$PACKAGE_SOURCE"

assert_safe_tree \
  "$CLAUDE_BOUNDARY" \
  "$CLAUDE_RELATIVE_ROOT" \
  "$CLAUDE_RELATIVE_ROOT/navgator-runtime" \
  "$CLAUDE_RELATIVE_ROOT/navgator-runtime/node_modules" \
  "$CLAUDE_RELATIVE_ROOT/navgator-runtime/node_modules/@tyroneross" \
  "$CLAUDE_RELATIVE_ROOT/navgator-runtime/node_modules/@tyroneross/navgator" \
  "$CLAUDE_RELATIVE_ROOT/plugins" \
  "$CLAUDE_RELATIVE_ROOT/plugins/cache" \
  "$CLAUDE_RELATIVE_ROOT/plugins/known_marketplaces.json" \
  "$CLAUDE_RELATIVE_ROOT/plugins/installed_plugins.json" \
  "$CLAUDE_RELATIVE_ROOT/plugins/gator" >/dev/null

PACKAGE_DIR="$RUNTIME_ROOT/node_modules/@tyroneross/navgator"
MANIFEST="$PACKAGE_DIR/.claude-plugin/plugin.json"
if [ ! -f "$MANIFEST" ]; then
  err "Claude manifest not found after package materialization: $MANIFEST"
  exit 1
fi

# Claude installs marketplace plugins into its own cache. Embed production
# dependencies inside the plugin root so the cached MCP server remains runnable.
npm install \
  --prefix "$PACKAGE_DIR" \
  --ignore-scripts \
  --omit=dev \
  --no-audit \
  --no-fund

EXPECTED_VERSION="$(node -p "JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8')).version" "$MANIFEST")"

info "Registering the local NavGator marketplace..."
claude plugin marketplace add "$PACKAGE_DIR" --scope "$CLAUDE_SCOPE"
claude plugin install "$PLUGIN_ID" --scope "$CLAUDE_SCOPE"
claude plugin update "$PLUGIN_ID" --scope "$CLAUDE_SCOPE"

plugin_state() {
  claude plugin list --json | PLUGIN_ID="$PLUGIN_ID" PLUGIN_SCOPE="$CLAUDE_SCOPE" node -e '
let input = ""
process.stdin.setEncoding("utf8")
process.stdin.on("data", (chunk) => { input += chunk })
process.stdin.on("end", () => {
  const plugins = JSON.parse(input)
  const plugin = plugins.find((item) => item.id === process.env.PLUGIN_ID && item.scope === process.env.PLUGIN_SCOPE)
  process.stdout.write(plugin ? (plugin.enabled ? "enabled" : "disabled") : "missing")
})
'
}

if [ "$(plugin_state)" = "disabled" ]; then
  claude plugin enable "$PLUGIN_ID" --scope "$CLAUDE_SCOPE"
fi

INSTALL_PATH="$(
  claude plugin list --json | \
  PLUGIN_ID="$PLUGIN_ID" \
  PLUGIN_SCOPE="$CLAUDE_SCOPE" \
  EXPECTED_VERSION="$EXPECTED_VERSION" \
  node -e '
let input = ""
process.stdin.setEncoding("utf8")
process.stdin.on("data", (chunk) => { input += chunk })
process.stdin.on("end", () => {
  const plugins = JSON.parse(input)
  const plugin = plugins.find((item) => item.id === process.env.PLUGIN_ID && item.scope === process.env.PLUGIN_SCOPE)
  if (!plugin) throw new Error(`${process.env.PLUGIN_ID} is not installed at ${process.env.PLUGIN_SCOPE} scope`)
  if (!plugin.enabled) throw new Error(`${process.env.PLUGIN_ID} is installed but disabled`)
  if (plugin.version !== process.env.EXPECTED_VERSION) {
    throw new Error(`installed version ${plugin.version} does not match ${process.env.EXPECTED_VERSION}`)
  }
  process.stdout.write(plugin.installPath)
})
'
)"

if [ ! -f "$INSTALL_PATH/node_modules/glob/package.json" ]; then
  err "Installed plugin is missing runtime dependencies: $INSTALL_PATH"
  exit 1
fi
if ! node "$INSTALL_PATH/dist/mcp/server.js" </dev/null >/dev/null 2>&1; then
  err "Installed NavGator MCP server failed its dependency-complete startup check."
  exit 1
fi

ensure_no_legacy_registry

if [ -e "$LEGACY_PATH" ] || [ -L "$LEGACY_PATH" ]; then
  warn "Legacy Claude plugin path detected. Disable or remove it to avoid duplicate NavGator surfaces."
fi

echo ""
ok "NavGator is installed and enabled for Claude Code."
echo "  Plugin:  $PLUGIN_ID"
echo "  Version: $EXPECTED_VERSION"
echo "  Scope:   $CLAUDE_SCOPE"
echo "  Cache:   $INSTALL_PATH"
echo ""
echo "Claude loads 13 /navgator:* commands, 4 subagents, 6 skills, and the NavGator MCP server."
warn "Start a new Claude Code session for the plugin surface to load."
