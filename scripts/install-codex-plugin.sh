#!/usr/bin/env bash
set -euo pipefail

# NavGator Codex marketplace registrar
# Usage: ./scripts/install-codex-plugin.sh [--user | --workspace]

SCOPE="${1:---user}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PACKAGE_SOURCE="${NAVGATOR_PACKAGE_SOURCE:-$PLUGIN_ROOT}"

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

update_marketplace() {
  local marketplace_root="$1"
  local marketplace_path="$2"
  local source_path="$3"
  local manifest_path="$4"

  node - "$marketplace_root" "$marketplace_path" "$source_path" "$manifest_path" <<'NODE'
const fs = require('fs')
const path = require('path')

const [marketplaceRootInput, marketplacePath, sourcePath, manifestPath] = process.argv.slice(2)
const marketplaceRoot = fs.realpathSync(marketplaceRootInput)
const relative = path.relative(marketplaceRoot, path.resolve(marketplacePath))
if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
  throw new Error(`Marketplace destination escapes ${marketplaceRoot}: ${marketplacePath}`)
}

function assertNoSymlinkComponents() {
  let current = marketplaceRoot
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment)
    try {
      if (fs.lstatSync(current).isSymbolicLink()) {
        throw new Error(`Refusing symlinked marketplace destination: ${current}`)
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
  }
}
assertNoSymlinkComponents()

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
let data = {
  name: 'navgator',
  interface: { displayName: 'NavGator Plugins' },
  plugins: [],
}

if (fs.existsSync(marketplacePath)) {
  data = JSON.parse(fs.readFileSync(marketplacePath, 'utf8'))
  if (!data || typeof data !== 'object') data = {}
  if (!Array.isArray(data.plugins)) data.plugins = []
  if (!data.interface || typeof data.interface !== 'object') data.interface = {}
  if (!data.name) data.name = 'navgator'
  if (!data.interface.displayName) data.interface.displayName = 'NavGator Plugins'
}

const entry = {
  name: 'navgator',
  source: {
    source: 'local',
    path: sourcePath,
  },
  policy: {
    installation: 'AVAILABLE',
    authentication: 'ON_INSTALL',
  },
  category: 'Coding',
  version: manifest.version,
}

const index = data.plugins.findIndex((plugin) => plugin?.name === 'navgator')
if (index >= 0) data.plugins[index] = entry
else data.plugins.push(entry)

const parent = path.dirname(marketplacePath)
fs.mkdirSync(parent, { recursive: true, mode: 0o700 })
assertNoSymlinkComponents()
const candidate = path.join(
  parent,
  `.${path.basename(marketplacePath)}.${process.pid}.${Date.now()}.tmp`,
)
let descriptor
try {
  descriptor = fs.openSync(candidate, 'wx', 0o600)
  fs.writeFileSync(descriptor, `${JSON.stringify(data, null, 2)}\n`)
  fs.fsyncSync(descriptor)
  fs.closeSync(descriptor)
  descriptor = undefined
  fs.renameSync(candidate, marketplacePath)
} finally {
  if (descriptor !== undefined) fs.closeSync(descriptor)
  fs.rmSync(candidate, { force: true })
}
NODE
}

configure_codex_mcp_runtime() {
  local package_dir="$1"
  local config_path="$2"
  local cache_dir="$3"

  node - "$package_dir" "$config_path" "$cache_dir" <<'NODE'
const fs = require('fs')
const path = require('path')

const [packageDirInput, configPath, cacheDir] = process.argv.slice(2)
const packageDir = fs.realpathSync(packageDirInput)
const relativeConfig = path.relative(packageDir, path.resolve(configPath))
if (relativeConfig === '..' || relativeConfig.startsWith(`..${path.sep}`) || path.isAbsolute(relativeConfig)) {
  throw new Error(`MCP config escapes ${packageDir}: ${configPath}`)
}
let current = packageDir
for (const segment of relativeConfig.split(path.sep).filter(Boolean)) {
  current = path.join(current, segment)
  try {
    if (fs.lstatSync(current).isSymbolicLink()) {
      throw new Error(`Refusing symlinked MCP config destination: ${current}`)
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
}

const packagedEntry = path.join(packageDir, 'dist', 'mcp', 'server.js')
const serverEntry = path.resolve(cacheDir, 'dist', 'mcp', 'server.js')
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
const server = config?.mcpServers?.navgator

if (!server || server.command !== 'node' || !Array.isArray(server.args)) {
  throw new Error(`Invalid NavGator MCP config: ${configPath}`)
}
if (!fs.existsSync(packagedEntry)) {
  throw new Error(`NavGator MCP server is missing: ${packagedEntry}`)
}

// Codex resolves a relative plugin MCP cwd against the installed plugin root.
// Point registration at the deterministic versioned cache that Codex creates
// on install, but omit cwd so the installed server scans the active workspace.
server.args = [serverEntry, ...server.args.slice(1)]
delete server.cwd

const parent = path.dirname(configPath)
const candidate = path.join(parent, `.${path.basename(configPath)}.${process.pid}.${Date.now()}.tmp`)
let descriptor
try {
  descriptor = fs.openSync(candidate, 'wx', 0o600)
  fs.writeFileSync(descriptor, `${JSON.stringify(config, null, 2)}\n`)
  fs.fsyncSync(descriptor)
  fs.closeSync(descriptor)
  descriptor = undefined
  fs.renameSync(candidate, configPath)
} finally {
  if (descriptor !== undefined) fs.closeSync(descriptor)
  fs.rmSync(candidate, { force: true })
}
NODE
}

case "$SCOPE" in
  --user)
    MARKETPLACE_ROOT="$HOME"
    SCOPE_LABEL="user"
    ;;
  --workspace)
    MARKETPLACE_ROOT="${NAVGATOR_WORKSPACE_ROOT:-$PWD}"
    SCOPE_LABEL="workspace"
    ;;
  *)
    echo "Usage: $0 [--user | --workspace]"
    echo ""
    echo "  --user       Register NavGator in ~/.agents/plugins/marketplace.json"
    echo "  --workspace  Register NavGator in <workspace>/.agents/plugins/marketplace.json"
    exit 1
    ;;
esac

command -v npm >/dev/null 2>&1 || {
  err "npm is required to materialize the NavGator package and its runtime dependencies."
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

MARKETPLACE_ROOT="$(assert_safe_tree \
  "$MARKETPLACE_ROOT" \
  ".agents" \
  ".agents/plugins" \
  ".agents/plugins/marketplace.json" \
  ".codex" \
  ".codex/plugins" \
  ".codex/plugins/navgator-runtime" \
  ".codex/plugins/navgator-runtime/node_modules" \
  ".codex/plugins/navgator-runtime/node_modules/@tyroneross" \
  ".codex/plugins/navgator-runtime/node_modules/@tyroneross/navgator")"

CODEX_HOME_INPUT="${CODEX_HOME:-$HOME/.codex}"
CODEX_HOME_PARENT="$(dirname "$CODEX_HOME_INPUT")"
CODEX_HOME_NAME="$(basename "$CODEX_HOME_INPUT")"
CODEX_HOME_PARENT="$(assert_safe_tree "$CODEX_HOME_PARENT" "$CODEX_HOME_NAME")"
CODEX_HOME_ROOT="$CODEX_HOME_PARENT/$CODEX_HOME_NAME"
mkdir -p "$CODEX_HOME_ROOT"
CODEX_HOME_ROOT="$(assert_safe_tree "$CODEX_HOME_ROOT" "plugins" "plugins/cache")"

MARKETPLACE_PATH="$MARKETPLACE_ROOT/.agents/plugins/marketplace.json"
RUNTIME_ROOT="$MARKETPLACE_ROOT/.codex/plugins/navgator-runtime"
PACKAGE_DIR="$RUNTIME_ROOT/node_modules/@tyroneross/navgator"
SOURCE_PATH="./.codex/plugins/navgator-runtime/node_modules/@tyroneross/navgator"

info "Materializing the NavGator Codex runtime ($SCOPE_LABEL scope)..."
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
  "$MARKETPLACE_ROOT" \
  ".agents" \
  ".agents/plugins" \
  ".agents/plugins/marketplace.json" \
  ".codex" \
  ".codex/plugins" \
  ".codex/plugins/navgator-runtime" \
  ".codex/plugins/navgator-runtime/node_modules" \
  ".codex/plugins/navgator-runtime/node_modules/@tyroneross" \
  ".codex/plugins/navgator-runtime/node_modules/@tyroneross/navgator" >/dev/null

MANIFEST="$PACKAGE_DIR/.codex-plugin/plugin.json"
MCP_CONFIG="$PACKAGE_DIR/.codex-plugin/mcp.json"
if [ ! -f "$MANIFEST" ] || [ ! -f "$MCP_CONFIG" ]; then
  err "Codex plugin manifest or MCP config is missing from $PACKAGE_DIR"
  exit 1
fi

EXPECTED_VERSION="$(node -p "JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8')).version" "$MANIFEST")"
CACHE_DIR="$CODEX_HOME_ROOT/plugins/cache/navgator/navgator/$EXPECTED_VERSION"
assert_safe_tree \
  "$CODEX_HOME_ROOT" \
  "plugins" \
  "plugins/cache" \
  "plugins/cache/navgator" \
  "plugins/cache/navgator/navgator" \
  "plugins/cache/navgator/navgator/$EXPECTED_VERSION" >/dev/null

# Codex copies the marketplace source into its versioned cache. Keep runtime
# dependencies inside the plugin root so that cache remains self-contained.
npm install \
  --prefix "$PACKAGE_DIR" \
  --ignore-scripts \
  --omit=dev \
  --no-audit \
  --no-fund

configure_codex_mcp_runtime "$PACKAGE_DIR" "$MCP_CONFIG" "$CACHE_DIR"

update_marketplace "$MARKETPLACE_ROOT" "$MARKETPLACE_PATH" "$SOURCE_PATH" "$MANIFEST"

echo ""
ok "NavGator marketplace entry registered."
echo "  Marketplace: $MARKETPLACE_PATH"
echo "  Package:     $PACKAGE_DIR"
echo "  Source:      $SOURCE_PATH"
echo "  MCP package: $CACHE_DIR"
echo "  Scan target: active task workspace"
echo ""
warn "Registration does not install or enable the Codex plugin."
echo "Next steps:"
echo "  1. Open the Codex plugin browser."
echo "  2. Install and enable navgator."
echo "  3. Disable the legacy gator plugin if it is present."
echo "  4. Start a new task so the 6 skills and NavGator MCP tools load."
