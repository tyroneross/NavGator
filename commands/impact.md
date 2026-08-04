---
name: impact
description: Check what breaks if you change a component — blast radius analysis before modifying code
arguments:
  - name: component
    description: "Component name, file path, or partial match to analyze (e.g., 'prisma', 'Article', 'lib/search/groq-reranker.ts')"
    required: true
---

Analyze the impact of changing: **$ARGUMENTS**

## What to do

1. Run `navgator explore "$ARGUMENTS" --agent` (prefer `navgator` on PATH) to get:
   - Component details (type, layer, status)
   - Runtime identity (database engine, queue name, deploy target)
   - Incoming connections (what depends on this)
   - Outgoing connections (what this depends on)
   - Data flow paths through the system

2. Run `navgator impact "$ARGUMENTS" --agent` for severity assessment. A non-zero exit code from either call is a real failure — surface stderr and stop; do not present a partial result as a complete impact analysis.

3. Present findings:
   - **Severity**: critical/high/medium/low based on dependent count
   - **Direct dependents**: components that will break immediately
   - **Transitive dependents**: components affected downstream
   - **Files to check**: specific file:line references
   - **Recommendation**: safe to change, proceed with caution, or needs coordination

4. If the component is a database model, also run `navgator schema <model> --agent` to show readers vs writers
