---
name: navgator-setup
description: Install, update, or launch NavGator tools. Use when the user asks to "install navgator", "update navgator", "launch dashboard", "navgator ui", "set up navgator", or needs maintenance operations.
version: 0.4.0
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

3. **Install the Claude surface:**

Global (all projects):
```bash
mkdir -p ~/.claude/plugins
ln -sfn "$(npm root -g)/@tyroneross/navgator" ~/.claude/plugins/navgator
```

Project only:
```bash
mkdir -p .claude/plugins
ln -sfn "$(npm root -g)/@tyroneross/navgator" .claude/plugins/navgator
```

4. **Verify:** Check that `plugin.json` is accessible at the symlink target.

5. Restart Claude Code for changes to take effect.

### Codex

Use the Codex installer from the repo root:

```bash
# user-wide install
bash scripts/install-codex-plugin.sh --user

# repo-local workspace metadata only
bash scripts/install-codex-plugin.sh --workspace
```

Codex uses:
- `.codex-plugin/plugin.json`
- `.agents/plugins/marketplace.json`

## Update

1. Check current vs latest version:
```bash
npx @tyroneross/navgator --version
npm view @tyroneross/navgator version
```

2. If update available:
```bash
npm install -g @tyroneross/navgator@latest
```

3. Clear npx cache so subsequent calls use the new version:
```bash
NPX_CACHE_DIR=$(npm config get cache)/_npx
find "$NPX_CACHE_DIR" -path "*/@tyroneross/navgator" -type d 2>/dev/null | head -1 | xargs -I{} dirname "$(dirname "{}")" | xargs rm -rf 2>/dev/null || true
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
# Global
rm -f ~/.claude/plugins/navgator

# Project
rm -f .claude/plugins/navgator
```

*navgator — architecture tracker*
