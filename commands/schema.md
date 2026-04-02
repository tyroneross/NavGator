---
name: schema
description: Show which files read from and write to database models
arguments:
  - name: model
    description: "Optional: model name to inspect (e.g., 'Article', 'entities'). Without a model, shows overview of all models."
    required: false
---

Inspect database schema usage: **$ARGUMENTS**

## What to do

1. Run `navgator schema` CLI command (with model name if provided)
2. If no model specified, show the overview — models sorted by connection count with read/write breakdown
3. If a model is specified, show all files that read from or write to it, with [test]/[dev-only] badges
4. Highlight any models with 0 writers (read-only) or 0 readers (write-only — potential dead data)
