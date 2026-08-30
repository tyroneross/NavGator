---
name: navgator-setup
description: Use when user asks to install navgator, update navgator, set up navgator, launch the dashboard, or run navgator ui maintenance.
version: 0.9.1
user-invocable: false
argument-hint: [install|update|ui]
---

# NavGator Setup & Maintenance

Install the plugin, update to latest version, or launch the web dashboard. These operations use CLI commands (npm/shell operations that aren't MCP tools).

## Resolving the navgator binary

Resolve the NavGator binary once per session, in this order. Never hardcode an
absolute path.

1. `navgator` on PATH — installed globally or via `npm link`.
2. The project dependency — resolve `@tyroneross/navgator/package.json` without
   downloading anything.
3. `NAVGATOR_HOME` — the installed plugin/package root (Claude exports
   `${CLAUDE_PLUGIN_ROOT}`).

Whichever rung resolves, retain both `NAVGATOR_BIN` and `NAVGATOR_PACKAGE` for
the whole operation. Report the path, version, and realpath source before
installing or updating anything:

   ```bash
   if command -v navgator >/dev/null 2>&1; then
     NAVGATOR_BIN="$(command -v navgator)"
     NAVGATOR_RESOLVED="$(node -e "const fs=require('fs');process.stdout.write(fs.realpathSync(process.argv[1]))" "$NAVGATOR_BIN")"
     NAVGATOR_PACKAGE="$(dirname "$(dirname "$(dirname "$NAVGATOR_RESOLVED")")")"
   elif NAVGATOR_ENTRY="$(node --input-type=module -e "import {fileURLToPath} from 'node:url';process.stdout.write(fileURLToPath(import.meta.resolve('@tyroneross/navgator')))" 2>/dev/null)"; then
     NAVGATOR_PACKAGE="$(dirname "$(dirname "$NAVGATOR_ENTRY")")"
     NAVGATOR_BIN="$NAVGATOR_PACKAGE/dist/cli/index.js"
     NAVGATOR_SOURCE="$NAVGATOR_BIN"
   elif [ -n "${NAVGATOR_HOME:-}" ] && [ -x "$NAVGATOR_HOME/dist/cli/index.js" ]; then
     NAVGATOR_PACKAGE="$NAVGATOR_HOME"
     NAVGATOR_BIN="$NAVGATOR_PACKAGE/dist/cli/index.js"
     NAVGATOR_SOURCE="$NAVGATOR_BIN"
   else
     echo "navgator CLI unavailable" >&2
     return 1 2>/dev/null || exit 1
   fi
   NAVGATOR_SOURCE="$(node -e "const fs=require('fs');process.stdout.write(fs.realpathSync(process.argv[1]))" "$NAVGATOR_BIN")"
   NAVGATOR_VERSION="$("$NAVGATOR_BIN" --version)"
   printf 'navgator CLI path: %s\nnavgator CLI version: %s\nnavgator CLI source: %s\n' \
     "$NAVGATOR_BIN" "$NAVGATOR_VERSION" "$NAVGATOR_SOURCE"
   ```

If none resolve, prefer the already-materialized runtime path printed by the
host installer. Recommend a registry install only after checking the registry
version is not older than an available local package.
Treat a non-zero exit code as a real failure and surface stderr; never silently
continue with stale architecture data.

## Install Plugin

Install NavGator explicitly for Claude Code or Codex.

### Steps

1. **Check if npm package is installed globally:**
```bash
npm ls -g @tyroneross/navgator 2>/dev/null | head -3
```

2. **Choose the package source.** If the active NavGator checkout or resolved
   binary is newer than the registry, use that local package root and skip the
   global install. Install from the registry only when no equal-or-newer local
   package is available:
```bash
npm install -g @tyroneross/navgator
```

3. **Locate the published package:**

```bash
NAVGATOR_PACKAGE="${NAVGATOR_PACKAGE:-$(npm root -g)/@tyroneross/navgator}"
test -f "$NAVGATOR_PACKAGE/.claude-plugin/plugin.json"
```

4. **Install the Claude surface:**

Global (all projects):
```bash
bash "$NAVGATOR_PACKAGE/scripts/install-plugin.sh" --global
```

Project only:
```bash
bash "$NAVGATOR_PACKAGE/scripts/install-plugin.sh" --project
```

5. **Verify:** Run `claude plugin list --json` and confirm `navgator@navgator` is installed and enabled at the requested scope. By default no MCP server is registered — the 13 slash commands, 4 subagents, 6 skills, and the `navgator` CLI are the wired surface. Pass `--with-mcp` to the installer only if the client cannot run a shell; that flag also starts the cached MCP server with production dependencies.

   If `navgator@rosslabs-ai-toolkit` is still enabled, follow the installer's scoped `claude plugin disable` command and rerun. Do not leave both registry entries active.

6. Start a new Claude Code session for changes to take effect.

### Codex

Use the Codex installer from the published package:

```bash
# Register a user-wide local marketplace entry
bash "$NAVGATOR_PACKAGE/scripts/install-codex-plugin.sh" --user

# Register a marketplace entry in the current workspace
bash "$NAVGATOR_PACKAGE/scripts/install-codex-plugin.sh" --workspace
```

The script installs or updates the npm package and registers the local plugin
source in the selected marketplace. By default it does not register an MCP
entry — Codex loads only `skills/`, so the 6 skills plus the `navgator` CLI are
Codex's entire NavGator surface. Registration does not install or enable the
Codex plugin. Open the Codex plugin browser, install and enable `navgator`,
disable the legacy `gator` plugin if it is present, then start a new task so
the skills load.

Pass `--with-mcp` to `install-codex-plugin.sh` only if the client cannot run a
shell. That flag rewrites the registration MCP entry to the deterministic
versioned Codex cache with no fixed `cwd`; the checked-in MCP file is a
package template, and after browser install the MCP executable is cache-owned
while its tools analyze the active task workspace.

Codex uses:
- `.codex-plugin/plugin.json`
- `.agents/plugins/marketplace.json` in the selected user or workspace scope

With `--with-mcp`, the Codex installer also registers `mcp-optin/codex.mcp.json`.

## Update

1. Use the retained `NAVGATOR_BIN` and `NAVGATOR_PACKAGE` from the three-rung
   resolution above. Check that exact binary against the registry version. Do not use
   `npx @tyroneross/navgator --version` for the current version: it can download
   and report the registry package instead of the binary being updated.
```bash
CURRENT_VERSION="$("$NAVGATOR_BIN" --version)"
REGISTRY_VERSION="$(npm view @tyroneross/navgator version)"
printf 'current=%s registry=%s package=%s\n' "$CURRENT_VERSION" "$REGISTRY_VERSION" "$NAVGATOR_PACKAGE"
```

2. Compare the versions using SemVer. Update only when the registry version is
   newer. If the resolved local version is newer (for example, local `0.9.1`
   while the registry is `0.9.0`), keep the local binary and do not run
   `npm install ...@latest`.

3. If and only if the registry is newer, update the CLI package and deliberately
   switch the retained package root. Otherwise leave both retained variables
   pointed at the equal-or-newer local package:
```bash
npm install -g @tyroneross/navgator@latest
NAVGATOR_PACKAGE="$(npm root -g)/@tyroneross/navgator"
NAVGATOR_BIN="$NAVGATOR_PACKAGE/dist/cli/index.js"
```

4. Re-run only the relevant Claude or Codex installer from the retained package
   root so its isolated runtime is updated:
```bash
bash "$NAVGATOR_PACKAGE/scripts/install-plugin.sh" --global
# Or, for Codex:
bash "$NAVGATOR_PACKAGE/scripts/install-codex-plugin.sh" --user
```

5. Verify the resolved binary explicitly, including its provenance:
```bash
"$NAVGATOR_BIN" --version
node -e "const fs=require('fs');process.stdout.write(fs.realpathSync(process.argv[1])+'\n')" "$NAVGATOR_BIN"
```

## Web Dashboard

Launch the visual architecture explorer:

```bash
npx @tyroneross/navgator ui --port 3002
```

Dashboard at `http://localhost:3002` shows:
- Architecture overview with component counts
- Interactive connection graph
- Impact analysis interface
- LLM/prompt tracking
- Project switcher

## Uninstall

```bash
# User scope
claude plugin uninstall navgator@navgator --scope user
claude plugin marketplace remove navgator --scope user
rm -rf "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/navgator-runtime"

# Project scope (run from that project)
claude plugin uninstall navgator@navgator --scope project
claude plugin marketplace remove navgator --scope project
rm -rf .claude/navgator-runtime

# Codex marketplace entries are removed from the Codex plugin browser.
# Disable/uninstall `navgator` there before deleting a local package link.
```

*navgator — architecture tracker*
