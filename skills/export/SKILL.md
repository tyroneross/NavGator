---
description: Export architecture to markdown or JSON
allowed-tools: Bash, Read, Write
user-invocable: true
argument-hint: [md|json] [output-file]
---

# /gator:export

Export your project's architecture documentation to markdown or JSON format.

## Instructions

1. Run the export command based on user arguments:

**Markdown (default):**
```bash
npx @tyroneross/navgator export md ARCHITECTURE.md
```

**JSON:**
```bash
npx @tyroneross/navgator export json architecture.json
```

2. Confirm the export was successful and tell the user where the file was saved.

## Options

- `--components-only`: Export only components, skip connections
- `--connections-only`: Export only connections
- `--graph`: Include mermaid diagram of connections

## Formats

**Markdown** generates a structured document with:
- Components grouped by type (packages, infrastructure, external services)
- Connection tables (API to Database, Frontend to API, etc.)
- AI prompt locations

**JSON** generates the raw architecture data for programmatic use.
