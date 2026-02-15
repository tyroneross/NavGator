---
description: Install the gator plugin for Claude Code (all projects or current project only)
user-invocable: true
allowed-tools: Bash, AskUserQuestion
argument-hint: [--global | --project]
---

# /gator:install

Install the gator plugin so `/gator:scan`, `/gator:status`, and all gator commands are available as slash commands in Claude Code.

## Instructions

### 1. Determine scope

If the user passed `--global` or `--project`, use that. Otherwise ask:

**Global (user scope):** Available in every project on this machine. Installs to `~/.claude/plugins/gator/`.

**Project only:** Available only in the current project. Installs to `<project-root>/.claude/plugins/gator/`.

### 2. Check if npm package is installed globally

```bash
npm ls -g @tyroneross/navgator 2>/dev/null | head -3
```

If not installed:

```bash
npm install -g @tyroneross/navgator
```

### 3. Find the package location

```bash
NPM_ROOT=$(npm root -g)
NAVGATOR_PATH="$NPM_ROOT/@tyroneross/navgator"
ls "$NAVGATOR_PATH/.claude-plugin/plugin.json"
```

### 4. Create symlink based on scope

**Global (user scope):**
```bash
# Remove old navgator symlink if it exists
rm -f ~/.claude/plugins/navgator

# Create new gator symlink
mkdir -p ~/.claude/plugins
ln -sfn "$NAVGATOR_PATH" ~/.claude/plugins/gator
```

**Project only:**
```bash
mkdir -p .claude/plugins
ln -sfn "$NAVGATOR_PATH" .claude/plugins/gator
```

### 5. Verify installation

```bash
ls -la ~/.claude/plugins/gator/.claude-plugin/plugin.json 2>/dev/null || ls -la .claude/plugins/gator/.claude-plugin/plugin.json 2>/dev/null
```

### 6. Report to user

Tell them:
- Where gator was installed (path)
- Which scope (global or project)
- Commands now available: `/gator:scan`, `/gator:status`, `/gator:impact`, `/gator:connections`, `/gator:diagram`, `/gator:export`, `/gator:check`, `/gator:ui`, `/gator:update`
- They may need to restart Claude Code for changes to take effect

### Uninstall

If the user asks to uninstall:

**Global:**
```bash
rm -f ~/.claude/plugins/gator
```

**Project:**
```bash
rm -f .claude/plugins/gator
```
