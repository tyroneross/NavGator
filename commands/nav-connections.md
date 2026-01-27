---
description: "Show all connections for a specific component"
allowed-tools: ["Bash", "Read"]
arguments:
  - name: "component"
    description: "Component name to show connections for"
    required: true
---

# NavGator Connection View

Show all incoming and outgoing connections for a specific component.

## Usage

```bash
npx @tyroneross/navgator connections "<component-name>"
```

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

## Output Format

```
Component: users (database table)
Layer: database

INCOMING CONNECTIONS (what connects TO this):
├── POST /api/users (api-endpoint)
│   └── src/api/users.ts:45 → createUser()
├── PUT /api/users/:id (api-endpoint)
│   └── src/api/users.ts:78 → updateUser()
└── summarize-worker (queue-handler)
    └── src/workers/summarize.ts:23 → processJob()

OUTGOING CONNECTIONS (what this connects TO):
└── None (database tables don't connect outward)
```

## Options

- `--json`: Output as JSON
- `--incoming`: Show only incoming connections
- `--outgoing`: Show only outgoing connections
