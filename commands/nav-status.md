---
description: "Show architecture summary and health status"
allowed-tools: ["Bash", "Read"]
---

# NavGator Architecture Status

Display a summary of the project's architecture including components, connections, and health status.

## Run Status Check

```bash
npx @tyroneross/navgator status
```

## What You'll See

**Component Summary:**
- Total packages by type (npm, pip, etc.)
- Frameworks and databases detected
- Infrastructure and services in use

**Connection Summary:**
- API → Database connections
- Frontend → API connections
- Queue → Handler connections
- External service calls
- AI prompt locations

**Health Status (if enabled):**
- Outdated packages
- Security vulnerabilities
- Missing connections

## Options

- `--json`: Output as JSON for programmatic use
- `--verbose`: Show all components and connections

## Related Commands

- `/nav-scan`: Rescan the project
- `/nav-impact <component>`: See what's affected by a component
- `/nav-connections <component>`: See all connections for a component
