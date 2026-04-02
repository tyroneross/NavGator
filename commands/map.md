---
name: map
description: Map the full architecture of this repository — components, connections, runtime topology, LLM use cases, and data flow pipelines
arguments:
  - name: options
    description: "Optional: --quick (packages only), --prompts (include AI prompt detection), --field-usage (Prisma field analysis)"
    required: false
---

Perform a comprehensive architecture mapping of this project.

**Options:** $ARGUMENTS

## What to do

1. Run the navgator `scan` MCP tool to detect all components and connections
2. Run the navgator `status` MCP tool to display the architecture summary
3. Present a brief of what was found:
   - Total components and connections
   - Runtime topology (databases, caches, queues, workers, crons)
   - AI/LLM use cases (distinct purposes, not raw import counts)
   - Any anomalies (duplicate queue consumers, orphaned components)
4. If architecture connections seem sparse, suggest running with `--prompts` for AI prompt detection

**Default behavior (no arguments):** Full scan with connection detection, infrastructure scanning, and schema-to-code mapping.

**When to use:**
- Starting work on a new project
- After major dependency changes
- When architecture data is stale (>24h)
- Before making cross-cutting changes
