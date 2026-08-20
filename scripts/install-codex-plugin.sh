#!/usr/bin/env bash
set -euo pipefail

# NavGator Codex marketplace registrar
# Usage: ./scripts/install-codex-plugin.sh [--user | --workspace] [--with-mcp]

SCOPE="--user"
WITH_MCP="false"
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

# Replace exactly one validated package directory. npm preserves extraneous
# files when the same local package version is installed again, so deleting the
# old materialization is required for a truthful source refresh.
remove_guarded_package_dir() {
  local root_path="$1"
  local relative_path="$2"

  node - "$root_path" "$relative_path" <<'NODE'
const fs = require('fs')
const path = require('path')

const [rootInput, relativeInput] = process.argv.slice(2)
const root = fs.realpathSync(rootInput)
if (path.isAbsolute(relativeInput)) throw new Error(`Package path must be relative to ${root}`)
const normalized = path.normalize(relativeInput)
if (!normalized || normalized === '.' || normalized === '..' || normalized.startsWith(`..${path.sep}`)) {
  throw new Error(`Unsafe package path: ${relativeInput}`)
}

const target = path.resolve(root, normalized)
const relative = path.relative(root, target)
if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
  throw new Error(`Package path escapes ${root}: ${relativeInput}`)
}

let current = root
for (const segment of relative.split(path.sep).filter(Boolean)) {
  current = path.join(current, segment)
  try {
    if (fs.lstatSync(current).isSymbolicLink()) {
      throw new Error(`Refusing symlinked package component: ${current}`)
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
}

if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true })
NODE
}

# Copy a file into the package tree without ever writing through a symlink.
#
# `cp` follows a destination symlink and writes to its target, so the refusal
# has to run BEFORE anything is materialized — a guard that lives downstream of
# the write it protects is not a guard. Publication then uses the same
# openSync('wx',0o600) + fsync + rename + finally-cleanup shape as every other
# write in this script.
write_guarded_copy() {
  local root_path="$1"
  local source_path="$2"
  local destination_path="$3"

  node - "$root_path" "$source_path" "$destination_path" <<'NODE'
const fs = require('fs')
const path = require('path')

const [rootInput, sourcePath, destinationInput] = process.argv.slice(2)
const root = fs.realpathSync(rootInput)
const destination = path.resolve(destinationInput)
const relative = path.relative(root, destination)
if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
  throw new Error(`Destination escapes ${root}: ${destinationInput}`)
}

let current = root
for (const segment of relative.split(path.sep).filter(Boolean)) {
  current = path.join(current, segment)
  try {
    if (fs.lstatSync(current).isSymbolicLink()) {
      throw new Error(`Refusing symlinked destination component: ${current}`)
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
}

const contents = fs.readFileSync(sourcePath)
const parent = path.dirname(destination)
fs.mkdirSync(parent, { recursive: true, mode: 0o700 })
const candidate = path.join(parent, `.${path.basename(destination)}.${process.pid}.${Date.now()}.tmp`)
let descriptor
try {
  descriptor = fs.openSync(candidate, 'wx', 0o600)
  fs.writeFileSync(descriptor, contents)
  fs.fsyncSync(descriptor)
  fs.closeSync(descriptor)
  descriptor = undefined
  fs.renameSync(candidate, destination)
} finally {
  if (descriptor !== undefined) fs.closeSync(descriptor)
  fs.rmSync(candidate, { force: true })
}
NODE
}

update_marketplace() {
  local marketplace_root="$1"
  local marketplace_path="$2"
  local source_path="$3"

  node - "$marketplace_root" "$marketplace_path" "$source_path" <<'NODE'
const fs = require('fs')
const path = require('path')

const [marketplaceRootInput, marketplacePath, sourcePath] = process.argv.slice(2)
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
  // No `version` key: Codex resolves the plugin version itself and ignores
  // this field for a local source — it reported an empty VERSION column with a
  // semver written here, then `local` once installed. Writing one would only
  // create a second place for the version to drift.
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

# Opt-in only. The shipped manifest has no mcpServers key, so Codex registers
# zero MCP servers by default; --with-mcp adds the key back before Codex copies
# the package into its versioned cache.
enable_manifest_mcp_servers() {
  local manifest_path="$1"

  node - "$manifest_path" <<'NODE'
const fs = require('fs')
const path = require('path')

const [manifestPath] = process.argv.slice(2)
if (fs.lstatSync(manifestPath).isSymbolicLink()) {
  throw new Error(`Refusing symlinked Codex manifest: ${manifestPath}`)
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
if (!manifest || typeof manifest !== 'object') {
  throw new Error(`Invalid Codex plugin manifest: ${manifestPath}`)
}
manifest.mcpServers = './.codex-plugin/mcp.json'

const parent = path.dirname(manifestPath)
const candidate = path.join(parent, `.${path.basename(manifestPath)}.${process.pid}.${Date.now()}.tmp`)
let descriptor
try {
  descriptor = fs.openSync(candidate, 'wx', 0o600)
  fs.writeFileSync(descriptor, `${JSON.stringify(manifest, null, 2)}\n`)
  fs.fsyncSync(descriptor)
  fs.closeSync(descriptor)
  descriptor = undefined
  fs.renameSync(candidate, manifestPath)
} finally {
  if (descriptor !== undefined) fs.closeSync(descriptor)
  fs.rmSync(candidate, { force: true })
}
NODE
}

# Exact inverse of enable_manifest_mcp_servers.
#
# `npm install --install-links` of an already-materialized same-version package
# neither prunes extraneous files from the package dir nor restores a mutated
# manifest, so a re-run without --with-mcp cannot rely on reinstallation to undo
# the opt-in. Without this, one opt-in registers Codex MCP permanently.
disable_manifest_mcp_servers() {
  local manifest_path="$1"

  node - "$manifest_path" <<'NODE'
const fs = require('fs')
const path = require('path')

const [manifestPath] = process.argv.slice(2)
if (fs.lstatSync(manifestPath).isSymbolicLink()) {
  throw new Error(`Refusing symlinked Codex manifest: ${manifestPath}`)
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
if (!manifest || typeof manifest !== 'object') {
  throw new Error(`Invalid Codex plugin manifest: ${manifestPath}`)
}
if ('mcpServers' in manifest) {
  delete manifest.mcpServers

  const parent = path.dirname(manifestPath)
  const candidate = path.join(parent, `.${path.basename(manifestPath)}.${process.pid}.${Date.now()}.tmp`)
  let descriptor
  try {
    descriptor = fs.openSync(candidate, 'wx', 0o600)
    fs.writeFileSync(descriptor, `${JSON.stringify(manifest, null, 2)}\n`)
    fs.fsyncSync(descriptor)
    fs.closeSync(descriptor)
    descriptor = undefined
    fs.renameSync(candidate, manifestPath)
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor)
    fs.rmSync(candidate, { force: true })
  }
}
NODE
}

# Codex copies the marketplace source into a versioned cache at install time, so
# an earlier --with-mcp run leaves a registered copy there too and the cache is
# what a running Codex actually loads. Removing the whole cache directory would
# delete host-owned install state, so this removes exactly the two artifacts
# --with-mcp adds — the config file and the manifest key — and leaves skills and
# dist/ alone. Anything it refuses to touch is reported with the manual
# remediation instead of being silently skipped.
revoke_cached_mcp_registration() {
  local cache_dir="$1"
  local outcome

  outcome="$(node - "$cache_dir" <<'NODE'
const fs = require('fs')
const path = require('path')

const [cacheDir] = process.argv.slice(2)

function lstatOrNull(target) {
  try {
    return fs.lstatSync(target)
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

function revokeCachedRegistration() {
  if (!fs.existsSync(cacheDir)) return ''

  const configPath = path.join(cacheDir, '.codex-plugin', 'mcp.json')
  const manifestPath = path.join(cacheDir, '.codex-plugin', 'plugin.json')
  let revoked = false

  const configStat = lstatOrNull(configPath)
  if (configStat?.isSymbolicLink()) return 'unsafe'
  if (configStat) {
    fs.rmSync(configPath, { force: true })
    revoked = true
  }

  const manifestStat = lstatOrNull(manifestPath)
  if (manifestStat?.isSymbolicLink()) return 'unsafe'
  if (manifestStat) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    if (manifest && typeof manifest === 'object' && 'mcpServers' in manifest) {
      delete manifest.mcpServers
      const parent = path.dirname(manifestPath)
      const candidate = path.join(parent, `.${path.basename(manifestPath)}.${process.pid}.${Date.now()}.tmp`)
      let descriptor
      try {
        descriptor = fs.openSync(candidate, 'wx', 0o600)
        fs.writeFileSync(descriptor, `${JSON.stringify(manifest, null, 2)}\n`)
        fs.fsyncSync(descriptor)
        fs.closeSync(descriptor)
        descriptor = undefined
        fs.renameSync(candidate, manifestPath)
      } finally {
        if (descriptor !== undefined) fs.closeSync(descriptor)
        fs.rmSync(candidate, { force: true })
      }
      revoked = true
    }
  }

  return revoked ? 'revoked' : ''
}

process.stdout.write(revokeCachedRegistration())
NODE
)"

  case "$outcome" in
    unsafe)
      warn "The Codex plugin cache holds a symlinked MCP artifact and was left untouched:"
      warn "  $cache_dir"
      warn "Codex may still register the NavGator MCP server. Remove the cache yourself:"
      warn "  rm -rf \"$cache_dir\""
      ;;
    revoked)
      warn "Removed a stale MCP registration from the Codex plugin cache: $cache_dir"
      warn "If Codex still lists a navgator MCP server, remove the cache and reinstall the"
      warn "plugin from the Codex plugin browser:"
      warn "  rm -rf \"$cache_dir\""
      ;;
  esac
}

usage() {
  echo "Usage: $0 [--user | --workspace] [--with-mcp]"
  echo ""
  echo "  --user       Register NavGator in ~/.agents/plugins/marketplace.json"
  echo "  --workspace  Register NavGator in <workspace>/.agents/plugins/marketplace.json"
  echo "  --with-mcp   Also register the MCP server (last resort; only for clients that cannot run a shell)"
}

# Flags are position-independent: --user/--workspace set the scope, --with-mcp
# is an independent opt-in. Scope defaults to --user when only --with-mcp is
# passed.
while [ "$#" -gt 0 ]; do
  case "$1" in
    --user | --workspace)
      SCOPE="$1"
      ;;
    --with-mcp)
      WITH_MCP="true"
      ;;
    *)
      usage
      exit 1
      ;;
  esac
  shift
done

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
    usage
    exit 1
    ;;
esac

command -v npm >/dev/null 2>&1 || {
  err "npm is required to materialize the NavGator package and its runtime dependencies."
  exit 1
}
command -v node >/dev/null 2>&1 || {
  err "Node.js >=20.19.0 is required to run NavGator."
  exit 1
}
if ! node -e '
const [major, minor] = process.versions.node.split(".").map(Number)
process.exit(major > 20 || (major === 20 && minor >= 19) ? 0 : 1)
'; then
  err "NavGator requires Node.js >=20.19.0 (found $(node --version 2>/dev/null || echo unknown))."
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
remove_guarded_package_dir "$MARKETPLACE_ROOT" ".codex/plugins/navgator-runtime/node_modules/@tyroneross/navgator"
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
MCP_TEMPLATE="$PACKAGE_DIR/mcp-optin/codex.mcp.json"
if [ ! -f "$MANIFEST" ]; then
  err "Codex plugin manifest is missing from $PACKAGE_DIR"
  exit 1
fi
# The package no longer ships .codex-plugin/mcp.json. Under --with-mcp it is
# materialized from the checked-in template below, so validate the template.
if [ "$WITH_MCP" = "true" ] && [ ! -f "$MCP_TEMPLATE" ]; then
  err "--with-mcp requested but the MCP template is missing: $MCP_TEMPLATE"
  exit 1
fi

# CODEX_CACHE_REF names the last path segment of the cache Codex creates at
# install time. It is NOT a version we choose — the host resolves it, and it is
# whatever `codex plugin list` reports in its VERSION column. Observed directly
# against codex 0.130.0: this installer registers a `{"source":"local"}` entry,
# the manifest omits `version` by policy, and Codex therefore names the cache
# `.../plugins/cache/navgator/navgator/local` and reports the version as
# `local`. That is the same rule as the auto-SHA policy itself — absent a
# manifest version the host substitutes its own reference for the source (a
# commit SHA for a git source, `local` here).
#
# Deriving this segment from ANY version field we control is the defect class
# that produced `.../navgator/undefined` when the manifest version was removed.
# package.json's semver is equally wrong: it yields `.../0.9.1`, a directory
# Codex never creates, which silently breaks every cache operation below.
CODEX_CACHE_REF="local"
CACHE_DIR="$CODEX_HOME_ROOT/plugins/cache/navgator/navgator/$CODEX_CACHE_REF"
assert_safe_tree \
  "$CODEX_HOME_ROOT" \
  "plugins" \
  "plugins/cache" \
  "plugins/cache/navgator" \
  "plugins/cache/navgator/navgator" \
  "plugins/cache/navgator/navgator/$CODEX_CACHE_REF" >/dev/null

# Codex copies the marketplace source into its versioned cache. Keep runtime
# dependencies inside the plugin root so that cache remains self-contained.
npm install \
  --prefix "$PACKAGE_DIR" \
  --ignore-scripts \
  --omit=dev \
  --no-audit \
  --no-fund

# Opt-in and opt-out are symmetric: --with-mcp writes the config and the
# manifest key, and a re-run without it removes both. Reinstallation undoes
# neither on its own, so without the default branch a single opt-in would make
# Codex register MCP forever.
if [ "$WITH_MCP" = "true" ]; then
  info "Registering the NavGator MCP server (opt-in)..."
  write_guarded_copy "$PACKAGE_DIR" "$MCP_TEMPLATE" "$MCP_CONFIG"
  enable_manifest_mcp_servers "$MANIFEST"
  configure_codex_mcp_runtime "$PACKAGE_DIR" "$MCP_CONFIG" "$CACHE_DIR"
else
  rm -f "$MCP_CONFIG"
  disable_manifest_mcp_servers "$MANIFEST"
  # Revoke from every cache Codex actually created, not only the one we
  # predict. The host owns that directory's name, so a single predicted path
  # silently no-ops against a cache named anything else — and a no-op here
  # means one --with-mcp opt-in stays registered forever, which is exactly the
  # invariant the opt-out exists to hold. Discovering beats predicting on a
  # removal path; it also reaches caches left behind under the old
  # version-named scheme. Symlinked entries are refused, not followed.
  for cached_dir in \
    "$CODEX_HOME_ROOT/plugins/cache/navgator/navgator"/* \
    "$CODEX_HOME_ROOT/plugins/cache"/*/navgator/*; do
    [ -e "$cached_dir" ] || continue
    if [ -L "$cached_dir" ]; then
      warn "Refusing to touch a symlinked Codex plugin cache: $cached_dir"
      continue
    fi
    [ -d "$cached_dir" ] || continue
    cache_relative="${cached_dir#"$CODEX_HOME_ROOT"/}"
    if ! assert_safe_tree "$CODEX_HOME_ROOT" "$cache_relative" >/dev/null; then
      warn "Refusing an unsafe Codex plugin cache path: $cached_dir"
      continue
    fi
    revoke_cached_mcp_registration "$cached_dir"
  done
fi

update_marketplace "$MARKETPLACE_ROOT" "$MARKETPLACE_PATH" "$SOURCE_PATH"

echo ""
ok "NavGator marketplace entry registered."
echo "  Marketplace: $MARKETPLACE_PATH"
echo "  Package:     $PACKAGE_DIR"
echo "  Source:      $SOURCE_PATH"
if [ "$WITH_MCP" = "true" ]; then
  echo "  MCP package: $CACHE_DIR"
fi
echo "  Scan target: active task workspace"

# Codex loads skills/ only: it declares no binary, exports no PATH entry, and
# sets no NAVGATOR_HOME. Every skill resolves the CLI at runtime, so an
# unreachable `navgator` silently degrades the whole surface to "tell the user
# to install it". Report reachability instead of assuming it.
NAVGATOR_BIN_DIR="$RUNTIME_ROOT/node_modules/.bin"
if NAVGATOR_ON_PATH="$(command -v navgator 2>/dev/null)"; then
  echo "  navgator CLI: $NAVGATOR_ON_PATH"
  NAVGATOR_REACHABLE="true"
else
  NAVGATOR_REACHABLE="false"
fi

echo ""
warn "Registration does not install or enable the Codex plugin."
echo "Next steps:"
echo "  1. Open the Codex plugin browser."
echo "  2. Install and enable navgator."
echo "  3. Disable the legacy gator plugin if it is present."
echo "  4. Start a new task so the 6 skills load. Skills drive the navgator CLI."
echo "     MCP is off by default. Re-run with --with-mcp only if your client cannot run a shell."

if [ "$NAVGATOR_REACHABLE" != "true" ]; then
  echo ""
  err "REQUIRED: the navgator CLI is not reachable, so the skills cannot run it."
  err "Codex loads skills only. It puts no binary on PATH and sets no NAVGATOR_HOME,"
  err "so every NavGator skill will fail until 'navgator' resolves in your shell."
  err "Do one of these before starting a Codex task:"
  err "  npm i -g @tyroneross/navgator"
  if [ -x "$NAVGATOR_BIN_DIR/navgator" ]; then
    err "  export PATH=\"$NAVGATOR_BIN_DIR:\$PATH\"   # add to your shell profile"
  fi
  err "Verify with: command -v navgator"
fi
