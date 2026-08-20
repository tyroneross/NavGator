#!/usr/bin/env bash
set -euo pipefail

# NavGator Claude Code plugin installer
# Usage: ./scripts/install-plugin.sh [--global | --project] [--with-mcp]

SCOPE="--global"
WITH_MCP="false"
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

guarded_package_backup() {
  local root_path="$1"
  local target_path="$2"
  local backup_path="$3"
  local action="$4"

  node - "$root_path" "$target_path" "$backup_path" "$action" <<'NODE'
const fs = require('fs')
const path = require('path')

const [rootInput, targetInput, backupInput, action] = process.argv.slice(2)
const root = fs.realpathSync(rootInput)
function resolveSafe(relativeInput) {
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
      if (fs.lstatSync(current).isSymbolicLink()) throw new Error(`Refusing symlinked package component: ${current}`)
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
  }
  return target
}
const target = resolveSafe(targetInput)
const backup = resolveSafe(backupInput)
const absent = resolveSafe(`${backupInput}.absent`)
if (action === 'stage') {
  if (fs.existsSync(backup) || fs.existsSync(absent)) throw new Error(`Package backup already exists: ${backup}`)
  if (fs.existsSync(target)) fs.renameSync(target, backup)
  else fs.writeFileSync(absent, '')
} else if (action === 'rollback') {
  fs.rmSync(target, { recursive: true, force: true })
  if (fs.existsSync(backup)) {
    fs.renameSync(backup, target)
  }
  fs.rmSync(absent, { force: true })
} else if (action === 'commit') {
  fs.rmSync(backup, { recursive: true, force: true })
  fs.rmSync(absent, { force: true })
} else {
  throw new Error(`Unknown package backup action: ${action}`)
}
NODE
}

# Copy a file into the package tree without ever writing through a symlink.
#
# `cp` follows a destination symlink and writes to its target. `assert_safe_tree`
# above clears the path COMPONENTS down to the package dir, not the leaf being
# written — and it already asserts leaf files elsewhere in this script
# (plugins/known_marketplaces.json, plugins/installed_plugins.json), so checking
# the leaf is the established standard here. Refuse first, then publish
# atomically with openSync('wx',0o600) + fsync + rename + finally cleanup.
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

usage() {
  echo "Usage: $0 [--global | --project] [--with-mcp]"
  echo ""
  echo "  --global    Install and enable NavGator at Claude user scope"
  echo "  --project   Install and enable NavGator for the current project"
  echo "  --with-mcp  Also register the MCP server (last resort; only for clients that cannot run a shell)"
  echo ""
  echo "For Codex marketplace registration, run:"
  echo "  bash scripts/install-codex-plugin.sh [--user | --workspace]"
}

# Flags are position-independent: --global/--project set the scope, --with-mcp
# is an independent opt-in. Scope defaults to --global when only --with-mcp is
# passed.
while [ "$#" -gt 0 ]; do
  case "$1" in
    --global | --project)
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
    usage
    exit 1
    ;;
esac

command -v npm >/dev/null 2>&1 || {
  err "npm is required to materialize NavGator."
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
PACKAGE_DIR="$RUNTIME_ROOT/node_modules/@tyroneross/navgator"
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
PACKAGE_RELATIVE="$CLAUDE_RELATIVE_ROOT/navgator-runtime/node_modules/@tyroneross/navgator"
PACKAGE_BACKUP_RELATIVE="$CLAUDE_RELATIVE_ROOT/navgator-runtime/.navgator-package-backup"
restore_previous_package() {
  local status=$?
  trap - ERR
  guarded_package_backup "$CLAUDE_BOUNDARY" "$PACKAGE_RELATIVE" "$PACKAGE_BACKUP_RELATIVE" rollback || true
  exit "$status"
}
trap restore_previous_package ERR
guarded_package_backup "$CLAUDE_BOUNDARY" "$PACKAGE_RELATIVE" "$PACKAGE_BACKUP_RELATIVE" stage
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

MANIFEST="$PACKAGE_DIR/.claude-plugin/plugin.json"
PACKAGE_JSON="$PACKAGE_DIR/package.json"
if [ ! -f "$MANIFEST" ]; then
  err "Claude manifest not found after package materialization: $MANIFEST"
  exit 1
fi
if [ ! -f "$PACKAGE_JSON" ]; then
  err "package.json not found after package materialization: $PACKAGE_JSON"
  exit 1
fi

# Claude installs marketplace plugins into its own cache. Embed production
# dependencies inside the plugin root so the cached CLI remains runnable.
npm install \
  --prefix "$PACKAGE_DIR" \
  --ignore-scripts \
  --omit=dev \
  --no-audit \
  --no-fund
guarded_package_backup "$CLAUDE_BOUNDARY" "$PACKAGE_RELATIVE" "$PACKAGE_BACKUP_RELATIVE" commit
trap - ERR

# The manifest omits version by policy (see .claude-plugin/plugin.json), so the
# only semver source of truth is package.json.
EXPECTED_VERSION="$(node -p "JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8')).version" "$PACKAGE_JSON")"
# `node -p` prints the literal string "undefined" for a missing key, so an
# existence check on the file is not a check on the value. Validate the shape
# and fail closed with the real reason rather than surfacing "undefined" from a
# downstream comparison.
case "$EXPECTED_VERSION" in
  ''|undefined|null|*[!0-9A-Za-z.+-]*)
    err "package.json has no usable version: '$EXPECTED_VERSION'"
    exit 1
    ;;
esac

# MCP is off by default. Claude copies whatever .mcp.json it finds in the
# marketplace source into its plugin cache, so the default path removes any
# stale copy before registration and the opt-in path materializes one from the
# checked-in template. The path COMPONENTS down to $PACKAGE_DIR are asserted
# symlink-free above; write_guarded_copy asserts the .mcp.json leaf itself.
if [ "$WITH_MCP" = "true" ]; then
  MCP_TEMPLATE="$PACKAGE_DIR/mcp-optin/claude.mcp.json"
  if [ ! -f "$MCP_TEMPLATE" ]; then
    err "--with-mcp requested but the MCP template is missing: $MCP_TEMPLATE"
    exit 1
  fi
  info "Registering the NavGator MCP server (opt-in)..."
  write_guarded_copy "$PACKAGE_DIR" "$MCP_TEMPLATE" "$PACKAGE_DIR/.mcp.json"
else
  rm -f "$PACKAGE_DIR/.mcp.json"
fi

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

# No version equality check here: the manifest omits `version` by policy, so
# the host resolves plugin identity itself — "unknown" for this local-path
# source, or the git commit SHA for a git source — and that string is never
# NavGator's identity oracle. Installed/enabled/installPath are what the host
# actually owns; the real "is this the package we built" proof runs the
# installed CLI's --version output against package.json below.
INSTALL_PATH="$(
  claude plugin list --json | \
  PLUGIN_ID="$PLUGIN_ID" \
  PLUGIN_SCOPE="$CLAUDE_SCOPE" \
  node -e '
let input = ""
process.stdin.setEncoding("utf8")
process.stdin.on("data", (chunk) => { input += chunk })
process.stdin.on("end", () => {
  const plugins = JSON.parse(input)
  const plugin = plugins.find((item) => item.id === process.env.PLUGIN_ID && item.scope === process.env.PLUGIN_SCOPE)
  if (!plugin) throw new Error(`${process.env.PLUGIN_ID} is not installed at ${process.env.PLUGIN_SCOPE} scope`)
  if (!plugin.enabled) throw new Error(`${process.env.PLUGIN_ID} is installed but disabled`)
  process.stdout.write(plugin.installPath)
})
'
)"

if [ ! -f "$INSTALL_PATH/node_modules/glob/package.json" ]; then
  err "Installed plugin is missing runtime dependencies: $INSTALL_PATH"
  exit 1
fi
# The CLI entrypoint imports every command module, so a successful --version
# run force-loads the same dependency tree the MCP server used to prove. It
# also prints package.json's version (Commander's .version(), sourced via
# src/version.ts), so comparing it to EXPECTED_VERSION is the real "the
# installed runtime is the package we built" proof — independent of the
# host's own version resolution, which we no longer trust for identity.
INSTALLED_CLI_VERSION="$(node "$INSTALL_PATH/dist/cli/index.js" --version 2>/dev/null)" || {
  err "Installed NavGator CLI failed its dependency-complete startup check."
  exit 1
}
if [ "$INSTALLED_CLI_VERSION" != "$EXPECTED_VERSION" ]; then
  err "Installed NavGator CLI reports version $INSTALLED_CLI_VERSION, expected $EXPECTED_VERSION."
  exit 1
fi
if [ "$WITH_MCP" = "true" ]; then
  if ! node "$INSTALL_PATH/dist/mcp/server.js" </dev/null >/dev/null 2>&1; then
    err "Installed NavGator MCP server failed its dependency-complete startup check."
    exit 1
  fi
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
if [ "$WITH_MCP" = "true" ]; then
  echo "  MCP: registered (opt-in)"
fi

# Claude exports ${CLAUDE_PLUGIN_ROOT}, so the skills' third resolution rung
# (node "$NAVGATOR_HOME/dist/cli/index.js") always resolves on this host. A
# missing PATH entry costs you the shell shorthand, not the plugin surface —
# which is the opposite of Codex, where nothing sets NAVGATOR_HOME.
if NAVGATOR_ON_PATH="$(command -v navgator 2>/dev/null)"; then
  echo "  navgator CLI: $NAVGATOR_ON_PATH"
else
  echo "  navgator CLI: $INSTALL_PATH/dist/cli/index.js (via \${CLAUDE_PLUGIN_ROOT}; not on PATH)"
fi

echo ""
echo "Claude loads 13 /navgator:* commands, 4 subagents, 6 skills, and the navgator CLI."
echo "MCP is off by default. Re-run with --with-mcp only if your client cannot run a shell."
if [ -z "${NAVGATOR_ON_PATH:-}" ]; then
  warn "navgator is not on your PATH. The plugin still works — Claude resolves the CLI"
  warn "through \${CLAUDE_PLUGIN_ROOT}. Add it to PATH only to run navgator yourself:"
  warn "  npm i -g @tyroneross/navgator"
  if [ -x "$RUNTIME_ROOT/node_modules/.bin/navgator" ]; then
    warn "  export PATH=\"$RUNTIME_ROOT/node_modules/.bin:\$PATH\""
  fi
fi
warn "Start a new Claude Code session for the plugin surface to load."
