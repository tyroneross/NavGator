---
name: architecture-export
description: Use when user asks to show or generate an architecture diagram, visualize dependencies, export architecture docs, create architecture documentation, save architecture output, or create a mermaid diagram of their project.
version: 0.9.1
user-invocable: false
argument-hint: "[diagram|export] [options]"
---

# Architecture Diagrams & Export

Generate architecture diagrams and export architecture summaries using the navgator CLI.

Resolve the binary first: use `navgator` if it is on PATH, otherwise `node "$NAVGATOR_HOME/dist/cli/index.js"` where `NAVGATOR_HOME` is the installed package root. Never hardcode an absolute path. See the `navgator-setup` skill for the full resolution order.

## Prerequisites

Before generating output, check whether architecture data exists. If the CLI reports missing data, run or recommend `navgator scan --agent` first. Do not fabricate architecture from raw source when scan data is unavailable.

## Diagrams

For in-chat diagrams, run `navgator diagram --summary` (diagram output is Mermaid text, not a JSON envelope — it has no `--agent` flag).

**Diagram modes:**
- Summary: top connected components only — `--summary`
- Focus: center on a specific component — `--focus "<component-name>"`
- Layer: show one layer — `--layer <layer-name>` such as `frontend`, `backend`, `database`, `queue`, `infra`, or `external`

The command returns Mermaid markdown that can be rendered in any Mermaid-compatible viewer.

For file output, use the same `diagram` command with `--output`. NavGator does not have an `export` command.

```bash
# Raw Mermaid
navgator diagram --summary --output architecture.mmd

# Markdown-wrapped Mermaid
navgator diagram --summary --markdown --output ARCHITECTURE.md

# Focused component diagram
navgator diagram --focus "component-name" --markdown --output component-architecture.md

# Layer diagram
navgator diagram --layer backend --markdown --output backend-architecture.md
```

A non-zero exit code is a real failure — surface stderr and do not present a diagram as generated.

## Summary Export

For an in-chat executive summary, run `navgator summary --agent`.

For a JSON file, use the same `summary` command and shell redirection:

```bash
navgator summary > architecture-summary.json
```

If the user asks for machine-readable graph data, point them to the generated scan artifacts rather than inventing an export command:

- `.navgator/architecture/index.json`
- `.navgator/architecture/graph.json`
- `.navgator/architecture/file_map.json`

## Decision Tree

| User Intent | Command | Notes |
|-------------|---------|-------|
| "Show architecture diagram" | `navgator diagram --summary` | Summary mode |
| "Diagram of X component" | `navgator diagram --focus "X"` | Component-focused |
| "Show backend layer" | `navgator diagram --layer backend` | Pass layer name to `--layer` |
| "Save a Mermaid diagram" | `navgator diagram --output <file>` | Add `--markdown` for Markdown docs |
| "Export architecture summary" | `navgator summary > <file>.json` | JSON file output |
| "Architecture summary in chat" | `navgator summary --agent` | Executive summary |
| "Export full graph JSON" | Existing `.navgator/architecture/*.json` files | No CLI export command exists |

## Guardrails

- Do not use `navgator export`; that command is not registered.
- Do not run npm or write files unless the user asked for file output.
- Use `focus` for complex diagrams so the output stays readable.
- Prefer Markdown-wrapped Mermaid for documentation files and raw Mermaid for diagram-only artifacts.

*navgator - architecture tracker*
