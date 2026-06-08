---
name: architecture-export
description: Use when user asks to show or generate an architecture diagram, visualize dependencies, export architecture docs, create architecture documentation, save architecture output, or create a mermaid diagram of their project.
version: 0.4.0
user-invocable: true
argument-hint: "[diagram|export] [options]"
---

# Architecture Diagrams & Export

Generate architecture diagrams and export architecture summaries using the real NavGator MCP and CLI surfaces.

## Prerequisites

Before generating output, check whether architecture data exists. If the MCP tool or CLI reports missing data, run or recommend `navgator scan` first. Do not fabricate architecture from raw source when scan data is unavailable.

## Diagrams

For in-chat diagrams, use the `navgator diagram` MCP tool.

**MCP modes:**
- `summary`: top connected components only (default)
- `focus`: center on a specific component; pass `focus: "<component-name>"`
- `layer`: show one layer; pass `focus: "<layer-name>"` such as `frontend`, `backend`, `database`, `queue`, `infra`, or `external`

The MCP tool returns Mermaid markdown that can be rendered in any Mermaid-compatible viewer.

For file output, use the CLI `diagram` command. NavGator does not have an `export` command.

```bash
# Raw Mermaid
npx @tyroneross/navgator diagram --summary --output architecture.mmd

# Markdown-wrapped Mermaid
npx @tyroneross/navgator diagram --summary --markdown --output ARCHITECTURE.md

# Focused component diagram
npx @tyroneross/navgator diagram --focus "component-name" --markdown --output component-architecture.md

# Layer diagram
npx @tyroneross/navgator diagram --layer backend --markdown --output backend-architecture.md
```

## Summary Export

For an in-chat executive summary, use the `navgator summary` MCP tool.

For a JSON file, use the CLI `summary` command and shell redirection:

```bash
npx @tyroneross/navgator summary > architecture-summary.json
```

If the user asks for machine-readable graph data, point them to the generated scan artifacts rather than inventing an export command:

- `.navgator/architecture/index.json`
- `.navgator/architecture/graph.json`
- `.navgator/architecture/file_map.json`

## Decision Tree

| User Intent | Tool | Notes |
|-------------|------|-------|
| "Show architecture diagram" | MCP `navgator diagram` | Summary mode |
| "Diagram of X component" | MCP `navgator diagram` with `mode: "focus"` | Component-focused |
| "Show backend layer" | MCP `navgator diagram` with `mode: "layer"` | Pass layer name as `focus` |
| "Save a Mermaid diagram" | CLI `npx @tyroneross/navgator diagram --output <file>` | Add `--markdown` for Markdown docs |
| "Export architecture summary" | CLI `npx @tyroneross/navgator summary > <file>.json` | JSON file output |
| "Architecture summary in chat" | MCP `navgator summary` | Executive summary |
| "Export full graph JSON" | Existing `.navgator/architecture/*.json` files | No CLI export command exists |

## Guardrails

- Do not use `navgator export`; that command is not registered.
- Do not run npm or write files unless the user asked for file output.
- Use `focus` for complex diagrams so the output stays readable.
- Prefer Markdown-wrapped Mermaid for documentation files and raw Mermaid for diagram-only artifacts.

*navgator - architecture tracker*
