---
name: architecture-scan
description: Use when user asks to scan architecture, check dependencies, find outdated packages, show project structure, refresh architecture, or run a health check. Navgator scan, status, and staleness check.
version: 0.4.0
user-invocable: false
---

# Architecture Scan & Status

Scan project architecture, check health, and monitor staleness using NavGator MCP tools. This skill covers scanning, status display, and health checks.

## When to Activate

- User asks about project architecture, stack, or dependencies
- User wants to check for outdated packages or vulnerabilities
- Session starts and architecture data may be stale (>24h since last scan)
- User adds/removes dependencies or makes structural changes
- After `npm install`, `pip install`, or similar dependency operations

## Scanning

Use the `navgator scan` MCP tool to detect components, connections, AI prompts, and infrastructure.

**Options:**
- Default: Full scan including code analysis
- `quick: true`: Package files only, skip code analysis (faster)

After scanning, present a smart brevity brief:
- **Line 1**: "Scanned [project]. [N] components, [N] connections."
- **What's new**: Added/removed components since last scan
- **What to watch**: Outdated packages, vulnerabilities, low-confidence detections
- **AI routing**: Providers and model count if AI calls detected

## Status

Use the `navgator status` MCP tool to show architecture summary without re-scanning.

Returns: component counts by type/layer, connection counts, AI routing table, last scan timestamp, and staleness indicator.

If no architecture data exists, recommend running a scan first.

## Health Checks

Use the `navgator scan` MCP tool with a follow-up review of the results. Health information is included in scan output:
- Outdated packages
- Security vulnerabilities
- Orphaned connections (dead code references)
- Missing imports and unused dependencies

## Decision Tree

| User Intent | MCP Tool | Notes |
|-------------|----------|-------|
| "Scan my project" | `navgator scan` | Full scan |
| "Quick scan" | `navgator scan` (quick: true) | Packages only |
| "What's my stack?" | `navgator status` | No re-scan needed |
| "Any outdated packages?" | `navgator scan` | Check health results |
| "Is architecture data fresh?" | `navgator status` | Check timestamp |

## Output Format

Keep output concise. Do NOT dump raw CLI output. Summarize into a scannable brief.

*navgator — architecture tracker*
