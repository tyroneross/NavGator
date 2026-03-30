---
name: review
description: Run architectural integrity review — checks system flow, component connections, documentation drift, and lessons learned
arguments:
  - name: scope
    description: "Optional: --all (full architecture), --validate (check lesson freshness), component name (focused review), or learn '...' (record lesson). Default: review git diff"
    required: false
---

Run the gator code-review skill to perform a 5-phase architectural integrity review.

**Scope:** $ARGUMENTS

**Default behavior (no arguments):** Review changes since `origin/main` — map changed files to components, check connection integrity, detect documentation drift, match against known lessons.

**Options:**
- `--all` — Review entire architecture, not just changes
- `--validate` — Trigger freshness validation (internet research) for lessons
- `<component>` — Focus review on a specific component and its connections
- `learn "description"` — Record a new architectural lesson manually
