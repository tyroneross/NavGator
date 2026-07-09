---
name: navgator-setup
description: Use when user asks to install navgator, update navgator, set up navgator, launch the dashboard, or run navgator ui maintenance.
version: 0.9.1
user-invocable: true
argument-hint: [install|update|ui]
---

# NavGator Setup & Maintenance

Install the plugin, update to latest version, or launch the web dashboard. These operations use CLI commands (npm/shell operations that aren't MCP tools).

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

5. **Verify:** Run `claude plugin list --json` and confirm `navgator@navgator` is installed and enabled at the requested scope. The installer performs this check and also starts the cached MCP server with production dependencies.

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

The script installs or updates the npm package, rewrites the registration MCP
entry to the deterministic versioned Codex cache with no fixed `cwd`, and
registers that local source in the selected marketplace. After browser install,
the MCP executable is cache-owned while its tools analyze the active task
workspace. The checked-in MCP file is a package template. Registration does not
install or enable the Codex plugin. Open
the Codex plugin browser, install and enable `navgator`, disable the legacy
`gator` plugin if it is present, then start a new task so skills and MCP tools
are loaded.

Codex uses:
- `.codex-plugin/plugin.json`
- `.codex-plugin/mcp.json`
- `.agents/plugins/marketplace.json` in the selected user or workspace scope

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
