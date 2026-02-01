# NavGator — Architecture Context for Claude

## What NavGator Does

NavGator externalizes architecture knowledge so you never lose track of file paths, dependencies, model routing, or component connections between sessions.

## Context Model (Three Tiers)

**Tier 1 — Hot Context** (`SUMMARY.md`)
Read this first. It's a concise overview (~40-150 lines) with:
- Components by layer (frontend, backend, database, queue, infra, external)
- AI/LLM routing table (provider, file, line, purpose)
- Top connections with `file:line` references
- Delta from last scan (what changed)
- Pointers to detail files for drill-down

If `SUMMARY.md` was compressed (large projects), the full version is at `SUMMARY_FULL.md`.

**Tier 2 — Structured Index** (`index.json`, `graph.json`, `file_map.json`, `prompts.json`)
Use for programmatic lookups:
- `index.json` — component counts, types, layers, stats
- `graph.json` — full connection graph for impact analysis
- `file_map.json` — maps file paths to component IDs (O(1) lookup)
- `prompts.json` — full prompt content with LLM provider associations (scan with `--prompts`)

**Tier 3 — Detail Files** (`components/COMP_*.json`, `connections/CONN_*.json`)
Load on demand when you need full detail about a specific component or connection. Each entry in SUMMARY.md points to its detail file.

## When to Read Architecture Context

**Always read `SUMMARY.md` at the start of a session.** It's located at:
```
<project-root>/.claude/architecture/SUMMARY.md
```

**Before editing tracked files:** If you're about to edit a file that belongs to a tracked component, read the component's detail file first. The architecture-check hook will remind you.

**After dependency changes:** If you ran `npm install`, `pip install`, etc., architecture data may be stale. Run `/navgator:scan` to update.

## Available Commands

| Command | Purpose |
|---------|---------|
| `/navgator:ui` | Launch the web dashboard |
| `/navgator:scan` | Scan project architecture |
| `/navgator:status` | Show architecture summary |
| `/navgator:impact` | Analyze what's affected by a change |

## Architecture Data Location

All data lives in `<project-root>/.claude/architecture/`:
```
.claude/architecture/
├── SUMMARY.md          ← Read this first (hot context)
├── SUMMARY_FULL.md     ← Full version if compressed
├── index.json          ← Master index
├── graph.json          ← Connection graph
├── file_map.json       ← File path → component ID lookup
├── prompts.json        ← Full prompt content + LLM associations
├── hashes.json         ← File change detection
├── components/         ← One JSON per component
└── connections/        ← One JSON per connection
```

## Key Principle

Instead of trying to "remember" architecture details, reload the externalized source of truth. SUMMARY.md is cheap to read and gives you the full picture. Drill into detail files only when needed.
