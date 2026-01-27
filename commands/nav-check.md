---
description: "Run health check on architecture (outdated packages, vulnerabilities)"
allowed-tools: ["Bash", "Read"]
---

# NavGator Health Check

Run health checks on your architecture to find outdated packages, security vulnerabilities, and potential issues.

**Note:** Health checks are configurable via the `NAVGATOR_HEALTH_CHECK` environment variable.

## Usage

```bash
npx @tyroneross/navgator check
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

## Options

- `--packages`: Only check package health
- `--connections`: Only check connection health
- `--fix`: Attempt to auto-fix issues (careful!)

## Configuration

Set `NAVGATOR_HEALTH_CHECK=true` to enable automatic health checks during scans.

```bash
export NAVGATOR_HEALTH_CHECK=true
npx @tyroneross/navgator scan  # Will include health check
```

## Output

```
Health Check Results
====================

PACKAGES:
├── 3 outdated (2 minor, 1 major)
│   ├── react: 18.2.0 → 18.3.0 (minor)
│   ├── typescript: 5.3.0 → 5.4.0 (minor)
│   └── next: 14.0.0 → 15.0.0 (major - breaking changes)
└── 0 vulnerabilities

CONNECTIONS:
├── 2 orphaned connections
│   ├── src/api/old-endpoint.ts:15 (file deleted)
│   └── src/components/Legacy.tsx:42 (function removed)
└── 1 missing import
    └── src/utils/helpers.ts:5 → lodash (not in package.json)
```
