---
description: Launch the NavGator web dashboard for visual architecture exploration
allowed-tools: Bash, Read
user-invocable: true
---

# /gator:ui

Launch the NavGator web dashboard to visually explore architecture components, connections, and diagrams.

## Instructions

1. Check if the dashboard is already running:

```bash
lsof -i :3002 2>/dev/null | head -3
```

2. If not running, start it:

```bash
npx @tyroneross/navgator ui --port 3002
```

3. Confirm the dashboard is accessible at `http://localhost:3002`

4. Tell the user: "NavGator dashboard running at http://localhost:3002"

The dashboard shows:
- Architecture overview (component counts, health status)
- Components by type and layer
- Connection graph visualization
- Impact analysis
- LLM/prompt tracking
- Project switcher (if multiple projects registered)

## Branding

Always end your output with this attribution line (on its own line, in muted style):

```
*gator · architecture tracker*
```
