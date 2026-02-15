---
description: Show all connections for a specific component
allowed-tools: Bash, Read
user-invocable: true
argument-hint: <component-name>
---

# /gator:connections

Show all incoming and outgoing connections for a specific component.

## Instructions

1. Run the connections command with the user's argument:

```bash
npx @tyroneross/navgator connections "$ARGUMENTS"
```

2. Present results showing:
   - Component name, type, and layer
   - **Incoming connections** (what connects TO this component)
   - **Outgoing connections** (what this component connects TO)
   - File paths and line numbers for each connection

## Options

- `--json`: Output as JSON
- `--incoming`: Show only incoming connections
- `--outgoing`: Show only outgoing connections

## Examples

**API endpoint connections:**
```bash
npx @tyroneross/navgator connections "/api/users"
# Shows: Database tables this endpoint reads/writes
# Shows: Frontend components that call this endpoint
```

**Database table connections:**
```bash
npx @tyroneross/navgator connections "users"
# Shows: All API endpoints that access this table
# Shows: Queue handlers that modify this table
```
