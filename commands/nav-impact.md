---
description: "Show what's affected if you change a component"
allowed-tools: ["Bash", "Read"]
arguments:
  - name: "component"
    description: "Component name to analyze (e.g., 'users-table', 'bullmq', 'stripe')"
    required: true
---

# NavGator Impact Analysis

Show what other components and code would be affected if you change a specific component.

**This is the key value of NavGator:** Know what else needs updating before you make a change.

## Usage

```bash
npx @tyroneross/navgator impact "<component-name>"
```

## Examples

**Database table change:**
```bash
npx @tyroneross/navgator impact "users"
# Shows: All API endpoints that read/write the users table
# Shows: File:line references for each connection
```

**Queue/worker change:**
```bash
npx @tyroneross/navgator impact "bullmq"
# Shows: All handlers triggered by BullMQ jobs
# Shows: AI prompts called from workers
```

**External service change:**
```bash
npx @tyroneross/navgator impact "stripe"
# Shows: All files that call Stripe APIs
# Shows: Frontend components that handle Stripe flows
```

## Output

For each affected component, you'll see:
- Component name and type
- Connection type (api-calls-db, frontend-calls-api, etc.)
- File path and line number
- Function name (if detected)
- Code snippet (truncated)

## Use Cases

1. **Before schema migration:** "If I change the users table, what APIs need updating?"
2. **Before refactoring:** "If I modify this BullMQ worker, what prompts are affected?"
3. **Before removing a dependency:** "What code uses this package?"
