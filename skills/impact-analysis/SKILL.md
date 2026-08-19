---
name: impact-analysis
description: Forecasts the blast radius of a change before you make it — dependencies, connections, data flow. Use when user asks what breaks if I change X, impact of changing, what depends on, trace data flow, show connections, dependency graph, upstream/downstream, or safe to modify before refactoring. Not for reviewing changes already made; use `code-review` instead.
version: 0.9.1
user-invocable: false
---

# Impact Analysis & Connections

Analyze what's affected by changes and map component connections using the navgator CLI. This skill covers impact analysis, connection viewing, and dataflow tracing.

Resolve the binary first: use `navgator` if it is on PATH, otherwise `node "$NAVGATOR_HOME/dist/cli/index.js"` where `NAVGATOR_HOME` is the installed package root. Never hardcode an absolute path. See the `navgator-setup` skill for the full resolution order.

## When to Activate

- User asks what's affected by changing a component or file
- User wants to see dependencies before refactoring
- User asks about upstream/downstream connections
- Before major changes to shared components
- User wants to trace how data flows through the system

## Impact Analysis

Run `navgator impact "<component>" --agent` to analyze blast radius. A non-zero exit code is a real failure — surface stderr and do not present a partial result as complete impact analysis.

**Input:** Component name (e.g., "express", "prisma", "/api/users")

**Returns:**
- Component's name, type, and layer
- **Incoming connections**: Components/files that USE this component (may need changes)
- **Outgoing connections**: Components this one depends on
- Severity assessment (critical/high/medium/low based on dependent count)
- Specific file paths and line numbers for each connection

### File-Based Impact

If the user provides a file path instead of a component name:
1. The tool resolves the file to its parent component automatically via file map lookup
2. If no component found, suggest running a scan to refresh architecture data

## Connection Mapping

Run `navgator connections "<component>" --agent` to show all connections for a component. Add `--incoming` or `--outgoing` to narrow direction (default shows both).

**Returns:**
- All incoming connections (what connects TO this component)
- All outgoing connections (what this component connects TO)
- File paths and line numbers for each connection

## Dataflow Tracing

Run `navgator trace "<component>" --agent` to follow data flow through the architecture. Add `--direction forward` or `--direction backward` to narrow it (default: both).

**Returns:**
- Data flow path through components
- Layer crossings (e.g., frontend → backend → database)
- Dependency chains with depth

## Decision Tree

| User Intent | CLI Command | Notes |
|-------------|-------------|-------|
| "What breaks if I change X?" | `navgator impact "X" --agent` | Full blast radius |
| "Show connections for X" | `navgator connections "X" --agent` | All connections |
| "What depends on X?" | `navgator connections "X" --incoming --agent` | Incoming only |
| "What does X use?" | `navgator connections "X" --outgoing --agent` | Outgoing only |
| "Trace data flow from X" | `navgator trace "X" --agent` | Forward/backward/both |
| "Is it safe to modify X?" | `navgator impact "X" --agent` | Check severity |

## After Analysis

Present results clearly:
1. Severity level and summary
2. Direct dependents (most important to review)
3. Transitive dependents (may be affected)
4. Recommendation: which files to review before making changes

*navgator — architecture tracker*
