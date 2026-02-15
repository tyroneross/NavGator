---
description: Analyze what's affected if you change a component or file
argument-hint: <component-or-file>
allowed-tools: Bash, Read, Grep
user-invocable: true
---

# /gator:impact

Show what files, components, and connections are affected when changing a specific component or file.

## Instructions

### If the user provides a component name:

```bash
npx @tyroneross/navgator impact "$ARGUMENTS"
```

### If the user provides a file path:

1. Look up the file in `.claude/architecture/file_map.json` to find which component it belongs to:

```
Read .claude/architecture/file_map.json
```

2. Find the matching component ID for the file path.

3. Run impact analysis on that component:

```bash
npx @tyroneross/navgator impact "<component-name>"
```

### If no match found:

The file is not tracked by NavGator. It may not be part of a detected component. Suggest running `/gator:scan` to refresh.

## What to Report

- The component's name, type, and layer
- **Incoming connections**: Files and components that USE this component (these may need changes)
- **Outgoing connections**: Components this one depends on
- Specific file paths and line numbers for each connection
- A recommendation: which files to review before making changes

## After Impact Analysis

If the user proceeds with changes, the architecture-check hook will remind them about tracked dependencies when they edit affected files.
