---
description: Scan project architecture and update connection tracking
allowed-tools: Bash, Read
user-invocable: true
argument-hint: [--prompts] [--verbose] [--quick]
---

# /navgator:scan

Scan the current project to detect components (packages, services, databases, infrastructure) and map their connections.

## Instructions

1. Run the scan from the project root:

```bash
npx @tyroneross/navgator scan --verbose
```

For enhanced AI prompt detection, add `--prompts`:

```bash
npx @tyroneross/navgator scan --prompts --verbose
```

2. After scan completes, read the updated summary:

```
Read .claude/architecture/SUMMARY.md
```

3. Report the results to the user:
   - Number of components found
   - Number of connections mapped
   - Any changes since the last scan (added/removed components)
   - Any warnings (outdated packages, vulnerabilities)

## Scan Options

- `--quick`: Only scan package files, skip code analysis (faster)
- `--prompts`: Enhanced AI prompt scanning with full content extraction
- `--ast`: Use AST-based scanning (more accurate, requires ts-morph)
- `--clear`: Clear existing data before scanning
- `--verbose`: Show detailed detection output

## After Scanning

The scan updates `.claude/architecture/` with fresh data. All hooks will use the updated context automatically.
