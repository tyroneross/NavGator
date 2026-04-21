---
name: impact-analysis
description: This skill activates when the user asks "what breaks if I change", "show dependencies for", "impact of changing", "what depends on", "trace data flow", "show connections", "what uses this", "what does this connect to", "dependency graph for", "upstream/downstream of", "will this break anything", "safe to modify", or is about to refactor a component. Provides impact analysis and connection mapping via NavGator MCP tools.
version: 0.4.0
user-invocable: false
---

# Impact Analysis & Connections

Analyze what's affected by changes and map component connections using NavGator MCP tools. This skill covers impact analysis, connection viewing, and dataflow tracing.

## When to Activate

- User asks what's affected by changing a component or file
- User wants to see dependencies before refactoring
- User asks about upstream/downstream connections
- Before major changes to shared components
- User wants to trace how data flows through the system

## Impact Analysis

Use the `navgator impact` MCP tool with the component name to analyze blast radius.

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

Use the `navgator connections` MCP tool to show all connections for a component.

**Input:** Component name (required), direction (optional: "in", "out", or "both")

**Returns:**
- All incoming connections (what connects TO this component)
- All outgoing connections (what this component connects TO)
- File paths and line numbers for each connection

## Dataflow Tracing

Use the `navgator trace` MCP tool to follow data flow through the architecture.

**Input:** Component name (required), direction (optional: "forward", "backward", or "both")

**Returns:**
- Data flow path through components
- Layer crossings (e.g., frontend → backend → database)
- Dependency chains with depth

## Decision Tree

| User Intent | MCP Tool | Notes |
|-------------|----------|-------|
| "What breaks if I change X?" | `navgator impact` | Full blast radius |
| "Show connections for X" | `navgator connections` | All connections |
| "What depends on X?" | `navgator connections` (direction: "in") | Incoming only |
| "What does X use?" | `navgator connections` (direction: "out") | Outgoing only |
| "Trace data flow from X" | `navgator trace` | Forward/backward/both |
| "Is it safe to modify X?" | `navgator impact` | Check severity |

## After Analysis

Present results clearly:
1. Severity level and summary
2. Direct dependents (most important to review)
3. Transitive dependents (may be affected)
4. Recommendation: which files to review before making changes

*navgator — architecture tracker*
