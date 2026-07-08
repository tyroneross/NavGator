---
name: promote-lesson
description: Scan all per-project NavGator lessons and propose cross-project patterns for promotion to the global lesson bank. Read-only by default; requires --write to apply.
---

# /navgator:promote-lesson

Find architectural patterns that recur across multiple projects and propose them
for promotion to the global lesson bank at `~/.navgator/lessons/global-lessons.json`.

This complements the per-id `navgator lessons promote <id>` CLI command:
- `lessons promote <id>` — manual, one-at-a-time promotion of a known lesson
- `/navgator:promote-lesson` — automated cross-project pattern detection across
  every project under `~/dev/git-folder/`

## How it works

The promoter scans every `<project>/.navgator/lessons/lessons.json` it can find,
then groups lessons by `(category, normalized_signature)`. Any group with **3+
distinct projects** becomes a promotion candidate. Default is dry-run — nothing
is written without the `--write` flag.

Each promoted lesson gets:
- `source_projects`: list of repos where the pattern appeared
- `promoted_at`: ISO date
- `applies_to`: tags (starts from category)
- `promotion_signature`: 12-char hash of `(category, signature)` for idempotency

Re-running with `--write` is safe: existing entries are detected by
`promotion_signature` and skipped.

## What to run

Default (dry-run, human-readable):

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/promote-lessons.py
```

Lower threshold to see near-misses (categories appearing in 2 projects):

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/promote-lessons.py --threshold 2
```

Apply candidates to global bank (creates a `.bak.e3.<TS>` backup first):

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/promote-lessons.py --write
```

JSON envelope for downstream processing:

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/promote-lessons.py --json
```

## Common requests

| User says | Run |
|---|---|
| "find lessons that recur across projects" | (default dry-run) |
| "show me categories trending toward promotion" | `--threshold 2` |
| "promote all qualifying patterns to global" | `--write` (confirm with user first) |
| "what would change if I promoted everything?" | `--threshold 1 --json` |

## Behavioral notes

- **Read-only by default.** Never write to global bank without `--write`.
- **Idempotent.** Two `--write` runs in a row produce identical output the second time.
- **Non-destructive.** Per-project lessons are never modified or deleted; existing
  global entries are never overwritten.
- **No network.** All work is local-filesystem only.
- **Conservative matching.** "Same pattern" means same category AND same sorted
  signature regex list. Different paths or different regex lists = different patterns.
- **Lessons without signatures are skipped.** Unsigned lessons can't be safely merged.

## Example first run

A real `--dry-run` against the current local-apps set looks like this:

```
Scanned 4 projects with .navgator/lessons/lessons.json
  agent-studio (5), chief-of-staff (4), FlowDoro (4), NavGator (0)
Found 13 unique (category, signature) groups
Above 3-project promotion threshold: 0
Near-threshold (2 projects): 3
  - api-contract        [agent-studio, chief-of-staff]
  - doc-drift           [agent-studio, chief-of-staff]
  - llm-architecture    [agent-studio, chief-of-staff]
No writes (use --write to apply).
```

Use `--threshold 2` to surface the near-misses as candidates without lowering the production threshold.

## Reversibility

Every `--write` creates `~/.navgator/lessons/global-lessons.json.bak.e3.<TS>`.
To roll back the most recent promotion batch:

```bash
ls -t ~/.navgator/lessons/global-lessons.json.bak.e3.* | head -1 | \
  xargs -I {} cp {} ~/.navgator/lessons/global-lessons.json
```
