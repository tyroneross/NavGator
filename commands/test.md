---
name: test
description: End-to-end architecture test — verify that all components connect correctly, no orphans, no broken paths
arguments:
  - name: instructions
    description: "Optional: custom test instructions or focus area (e.g., 'check the search pipeline', 'verify queue topology')"
    required: false
---

Run an end-to-end architecture test on this project.

**Custom instructions:** $ARGUMENTS

## What to do

### Phase 1: Freshness Check
1. Run `navgator status` MCP tool — check if data is stale
2. If stale (>24h), run `navgator scan` first

### Phase 2: Architecture Health
1. Run `navgator rules` MCP tool — check for violations (orphans, layer violations, cycles, hotspots)
2. Run `navgator dead` CLI command (or check status POTENTIAL DEAD CODE section) — list orphaned components
3. Check for anomalies (queues with 2+ consumers)

### Phase 3: Pipeline Integrity
1. For each cron job detected, trace the full pipeline: cron → route → service → database → queue → worker
2. For each API route with frontend fetch connections, verify the page → API → database chain is complete
3. Flag any broken chains (trace returns 0 paths or dead-ends)

### Phase 4: LLM Architecture
1. Run `navgator llm-map` — verify all LLM use cases are categorized
2. Check for uncategorized use cases and classify them by reading the source files
3. Verify each LLM provider has at least one production connection

### Phase 5: Custom Instructions
If custom instructions were provided ($ARGUMENTS), focus the test on that area:
- Read the relevant source files
- Trace connections related to the focus area
- Verify the specific pipeline or component mentioned

### Report Format
```
ARCHITECTURE TEST REPORT
========================
Health: N violations (N critical, N warning)
Dead code: N orphaned components
Pipelines: N/M complete (N broken)
LLM: N use cases, N categorized
Anomalies: [list]

[Details for each finding]
```
