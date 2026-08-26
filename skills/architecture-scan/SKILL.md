---
name: architecture-scan
description: Use when user asks to scan architecture, check dependencies, find outdated packages, show project structure, refresh architecture, or run a health check. Navgator scan, status, and staleness check.
version: 0.9.1
user-invocable: false
---

# Architecture Scan & Status

Scan project architecture, check health, and monitor staleness using the navgator CLI. This skill covers scanning, status display, and health checks.

Resolve the binary first: use `navgator` if it is on PATH, otherwise `node "$NAVGATOR_HOME/dist/cli/index.js"` where `NAVGATOR_HOME` is the installed package root. Never hardcode an absolute path. See the `navgator-setup` skill for the full resolution order.

## When to Activate

- User asks about project architecture, stack, or dependencies
- User wants to check for outdated packages or vulnerabilities
- Session starts and architecture data may be stale (>24h since last scan)
- User adds/removes dependencies or makes structural changes
- After `npm install`, `pip install`, or similar dependency operations

## Scanning

Run `navgator scan --agent` to detect components, connections, AI prompts, and infrastructure. A non-zero exit code is a real failure — surface stderr and do not present a scan as complete.

**Options:**
- Default: Full scan including code analysis
- `quick: true`: Package files only, skip code analysis (faster)

After scanning, present a smart brevity brief:
- **Line 1**: "Scanned [project]. [N] components, [N] connections."
- **What's new**: Added/removed components since last scan
- **What to watch**: Outdated packages, vulnerabilities, low-confidence detections
- **AI routing**: Providers and model count if AI calls detected

## Status

Run `navgator status --agent --no-refresh` to inspect the stored architecture
summary without re-scanning or writing architecture data. Plain
`navgator status --agent` may auto-refresh stale data, so use it only when that
write is intended.

Returns: component counts by type/layer, connection counts, AI routing table, last scan timestamp, and staleness indicator.

If no architecture data exists, recommend running a scan first.

## Health Checks

Run `navgator scan --agent` with a follow-up review of the results. Health information is included in scan output:
- Outdated packages
- Security vulnerabilities
- Orphaned connections (dead code references)
- Missing imports and unused dependencies

## Decision Tree

| User Intent | CLI Command | Notes |
|-------------|-------------|-------|
| "Scan my project" | `navgator scan --agent` | Full scan |
| "Quick scan" | `navgator scan --agent --quick` | Packages only |
| "What's my stack?" | `navgator status --agent --no-refresh` | Read-only stored summary |
| "Any outdated packages?" | `navgator scan --agent` | Check health results |
| "Is architecture data fresh?" | `navgator status --agent --no-refresh` | Read-only timestamp check |

## Output Format

Keep output concise. Do NOT dump raw CLI output. Summarize into a scannable brief.

*navgator — architecture tracker*
