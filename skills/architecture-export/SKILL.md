---
name: architecture-export
description: Generate architecture diagrams or export architecture documentation. Use when the user asks to "show architecture diagram", "generate diagram", "export architecture", "visualize dependencies", "create architecture doc", "mermaid diagram", or wants visual/exportable representations of their project architecture.
version: 0.4.0
user-invocable: true
argument-hint: [diagram|export] [options]
---

# Architecture Diagrams & Export

Generate visual diagrams and export architecture documentation using NavGator MCP tools.

## Diagrams

Use the `navgator diagram` MCP tool to generate Mermaid diagrams.

**Modes:**
- `summary`: Top connected components only (default)
- `focus`: Center on a specific component — pass `focus: "<component-name>"`
- `layer`: Show only a specific layer — pass `focus: "<layer-name>"` (frontend, backend, database, queue, infra, external)

Returns Mermaid markdown that can be rendered in any Mermaid-compatible viewer.

### Tips
- Run a scan first if no architecture data exists
- Use `focus` for complex projects with many nodes
- Combine with impact analysis to visualize affected components

## Export

For structured export, use the `navgator summary` MCP tool to get an executive summary of the architecture.

For full export to files, use CLI commands (these are npm operations, not MCP):

```bash
# Markdown export
npx @tyroneross/navgator export md ARCHITECTURE.md

# JSON export
npx @tyroneross/navgator export json architecture.json

# With options
npx @tyroneross/navgator export md ARCHITECTURE.md --components-only
npx @tyroneross/navgator export json architecture.json --graph
```

## Decision Tree

| User Intent | Tool | Notes |
|-------------|------|-------|
| "Show architecture diagram" | `navgator diagram` | Summary mode |
| "Diagram of X component" | `navgator diagram` (focus) | Component-focused |
| "Show backend layer" | `navgator diagram` (layer) | Layer-filtered |
| "Export architecture docs" | CLI: `npx navgator export md` | File output |
| "Architecture summary" | `navgator summary` | Executive summary |

*gator — architecture tracker*
