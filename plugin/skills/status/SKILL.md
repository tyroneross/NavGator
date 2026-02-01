---
description: Show architecture summary and context health
allowed-tools: Read, Bash
user-invocable: true
---

# /navgator:status

Display the project's architecture summary from the hot context file.

## Instructions

1. Read the architecture summary:

```
Read .claude/architecture/SUMMARY.md
```

2. If the file doesn't exist, tell the user:
   "No architecture data found. Run `/navgator:scan` to scan this project."

3. If it exists, present the contents to the user. Highlight:
   - Total components and connections
   - Key services and their file locations
   - AI/LLM routing table (which models are used where)
   - Changes since last scan
   - Whether data is stale (check last scan timestamp)

4. If the summary was compressed, mention that the full version is available at `.claude/architecture/SUMMARY_FULL.md`.
