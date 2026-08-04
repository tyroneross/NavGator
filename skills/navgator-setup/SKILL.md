---
name: navgator-setup
description: Use when user asks to install navgator, update navgator, set up navgator, launch the dashboard, or run navgator ui maintenance.
version: 0.9.1
user-invocable: true
argument-hint: [install|update|ui]
---

# NavGator Setup & Maintenance

Install the plugin, update to latest version, or launch the web dashboard. These operations use CLI commands (npm/shell operations that aren't MCP tools).

## Resolving the navgator binary

Resolve the NavGator binary once per session, in this order. Never hardcode an
absolute path.

1. `navgator` on PATH — installed globally or via `npm link`.
2. `npx --no-install navgator` — when the project depends on `@tyroneross/navgator`.
3. `node "$NAVGATOR_HOME/dist/cli/index.js"` — where `NAVGATOR_HOME` is the
   installed plugin/package root (Claude: `${CLAUDE_PLUGIN_ROOT}`).

If none resolve, tell the user to run `npm i -g @tyroneross/navgator` and stop.
Treat a non-zero exit code as a real failure and surface stderr; never silently
continue with stale architecture data.

## Install Plugin

Install NavGator explicitly for Claude Code or Codex.

### Steps

1. **Check if npm package is installed globally:**
```bash
npm ls -g @tyroneross/navgator 2>/dev/null | head -3
```

2. **Install globally if needed:**
```bash
npm install -g @tyroneross/navgator
```

3. **Locate the published package:**

```bash
NAVGATOR_PACKAGE="$(npm root -g)/@tyroneross/navgator"
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

1. Check current vs latest version:
```bash
npx @tyroneross/navgator --version
npm view @tyroneross/navgator version
```

2. If update available, update the CLI package:
```bash
npm install -g @tyroneross/navgator@latest
```

3. Re-run the relevant Claude/Codex installer so its isolated runtime is updated:
```bash
NAVGATOR_PACKAGE="$(npm root -g)/@tyroneross/navgator"
bash "$NAVGATOR_PACKAGE/scripts/install-plugin.sh" --global
bash "$NAVGATOR_PACKAGE/scripts/install-codex-plugin.sh" --user
```

4. Verify the updated package explicitly:
```bash
npx @tyroneross/navgator@latest --version
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
