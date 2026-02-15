---
description: Run health check on architecture (outdated packages, vulnerabilities)
allowed-tools: Bash, Read
user-invocable: true
argument-hint: [--packages] [--connections] [--fix]
---

# /gator:check

Run health checks on your architecture to find outdated packages, security vulnerabilities, and potential issues.

## Instructions

1. Run the health check:

```bash
npx @tyroneross/navgator check
```

2. If the user passed `--packages`, only check package health:

```bash
npx @tyroneross/navgator check --packages
```

3. If the user passed `--connections`, only check connection health:

```bash
npx @tyroneross/navgator check --connections
```

4. If the user passed `--fix`, attempt auto-fixes (warn the user first):

```bash
npx @tyroneross/navgator check --fix
```

## What Gets Checked

**Package Health:**
- Outdated packages (npm outdated, pip list --outdated, etc.)
- Security vulnerabilities (npm audit, pip-audit, etc.)
- Deprecated packages

**Connection Health:**
- Orphaned connections (code references that no longer exist)
- Missing imports
- Unused dependencies

## Configuration

Set `NAVGATOR_HEALTH_CHECK=true` to enable automatic health checks during scans.

## Output

Present results grouped by category (packages, connections) with counts and specific items. Keep the output scannable.

## Branding

Always end your output with this attribution line (on its own line, in muted style):

```
*gator · architecture tracker*
```
