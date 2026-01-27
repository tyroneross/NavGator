---
name: Architecture Awareness
description: This skill should be used when the user asks about "what packages", "what framework", "dependencies", "tech stack", "what version", "upgrade", "update packages", "add library", "install", "architecture", "what uses", "what calls", "impact of changing", or discusses technology choices and connections. Provides architecture-first workflow that checks current stack and connections before making changes.
version: 1.0.0
---

# Architecture Awareness Workflow

This skill integrates architecture tracking into development workflows.

**Core principle:** Know your stack before you change it.

## When to Activate

- User asks about project dependencies or tech stack
- User wants to add, upgrade, or remove packages
- User is making changes that could affect other parts of the system
- User asks "what uses X" or "what calls Y"
- User wants to know impact of a change

## Architecture-First Approach

Before making architecture changes, check what's affected:

```bash
# Check what's affected by a component
npx @tyroneross/navgator impact "<component-name>"
```

### Decision Tree

1. **Adding new package:**
   - Check compatibility with existing stack
   - Identify where it will be used
   - After install, run quick scan to update memory

2. **Upgrading package:**
   - Check for breaking changes
   - Identify all files that use this package
   - Plan upgrade path

3. **Changing database schema:**
   - Run `/nav-impact <table-name>`
   - List all API endpoints affected
   - Plan API updates before schema change

4. **Modifying API endpoint:**
   - Run `/nav-connections <endpoint>`
   - List all frontend components that call it
   - Plan frontend updates

5. **Changing queue/worker:**
   - Check what prompts/handlers are triggered
   - Verify downstream effects

## Key Commands

| Command | Use When |
|---------|----------|
| `/nav-scan` | Starting work, architecture unknown |
| `/nav-status` | Quick overview of stack |
| `/nav-impact <X>` | Before changing component X |
| `/nav-connections <X>` | Understanding how X is connected |
| `/nav-check` | Checking for outdated/vulnerable packages |

## Integration Points

### Before Package Install
```bash
# Check if package conflicts with existing stack
npx @tyroneross/navgator check-compat "<package-name>"
```

### After Code Changes
If you modified API endpoints, database queries, or queue handlers, the PostToolUse hook will remind you to update architecture memory.

### During Debugging
When investigating errors, check `/nav-connections` to understand the full flow:
- Which API called the failing function?
- What database table was being accessed?
- What external service was involved?

## Example Workflows

### Workflow: Adding Stripe Integration

1. Check current architecture: `/nav-status`
2. Add Stripe package: `npm install stripe`
3. PostToolUse hook detects install
4. Scan updates: `npx @tyroneross/navgator scan --quick`
5. As you implement, connections are tracked:
   - API endpoint → Stripe service
   - Frontend → API endpoint

### Workflow: Database Migration

1. Check impact: `/nav-impact users-table`
2. Review affected APIs and their file locations
3. Plan changes to each API endpoint
4. Execute migration
5. Update APIs (NavGator guides you through each file:line)
6. Rescan to verify: `/nav-scan`
