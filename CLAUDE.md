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
<project-root>/.navgator/architecture/SUMMARY.md
```

**Before editing tracked files:** If you're about to edit a file that belongs to a tracked component, read the component's detail file first. The architecture-check hook will remind you.

**After dependency changes:** If you ran `npm install`, `pip install`, etc., architecture data may be stale. Run `/gator:scan` to update.

## Available Commands

| Command | Purpose |
|---------|---------|
| `/gator:scan` | Scan project architecture |
| `/gator:status` | Show architecture summary |
| `/gator:impact` | Analyze what's affected by a change |
| `/gator:connections` | Show all connections for a component |
| `/gator:diagram` | Generate visual architecture diagram |
| `/gator:export` | Export architecture to markdown or JSON |
| `/gator:check` | Run health checks (outdated packages, vulnerabilities) |
| `/gator:ui` | Launch the web dashboard |
| `/gator:update` | Update NavGator to the latest version |
| `/gator:review` | Architectural integrity review (connections, flow, drift, lessons) |
| `/gator:review --all` | Review entire architecture, not just changes |
| `/gator:review --validate` | Trigger freshness validation (internet research) for lessons |
| `/gator:review learn "..."` | Record a manual architectural lesson |
| `navgator trace <component>` | Trace dataflow paths forward and backward through system |
| `navgator rules` | Check architecture rules (orphans, layer violations, cycles, hotspots) |
| `navgator subgraph <component>` | Extract focused subgraph around a component |
| `navgator history` | Show architecture change timeline |
| `navgator diff [id]` | Show detailed diff (most recent if no ID) |
| `navgator projects` | List all registered NavGator projects |
| `navgator summary` | Executive summary with risks, blockers, next actions (JSON) |
| `navgator coverage --fields` | Analyze DB field usage (unused, read-only, write-only) |
| `navgator coverage --typespec` | Validate Prisma types against TypeScript interfaces |

## Agent/Machine Output

All commands that support `--json` also support `--agent`, which wraps output in a stable envelope:

```json
{
  "command": "scan",
  "data": { ... },
  "schema_version": "1.0.0",
  "timestamp": 1234567890
}
```

### Infrastructure Scanning

NavGator detects infrastructure beyond packages:
- **Prisma models**: schema parsing, relations, indexes (`--field-usage` for usage analysis)
- **Environment variables**: `.env` files + `process.env` references in source
- **Queues**: BullMQ/Bull producers and consumers
- **Cron jobs**: vercel.json, railway.json, node-cron patterns
- **Deploy configs**: Vercel, Railway, Heroku service definitions
- **TypeSpec validation**: Prisma model vs TypeScript interface comparison (`--typespec`)

These are detected automatically during `navgator scan`. Use `navgator coverage --fields` or `--typespec` for detailed analysis.

### Runtime Topology

NavGator annotates components with runtime identity — service names, connection endpoints, and deployment targets extracted from code and config. This enables backward tracing from runtime failures to code: "which code produces to this BullMQ queue?" or "what database engine does this Prisma schema connect to?"

The `navgator status` command shows a RUNTIME TOPOLOGY section with all detected bindings.

### LLM Use Case Tracking

NavGator tracks distinct LLM use cases, not raw import counts. Instead of "154 service calls," it shows "8 use cases across 3 providers." Deduplication uses a priority cascade: prompt-based grouping (strongest), function name grouping, callType+model grouping, file-based (fallback). Test and dev-only connections are filtered automatically.

The `navgator status` command shows an AI/LLM section with use case count, providers, and a table of distinct use cases.

### Lessons System

NavGator accumulates architectural lessons in `.navgator/lessons/lessons.json`. Lessons are patterns that caused issues — they're matched against future changes during `/gator:review`. Categories: api-contract, data-flow, component-communication, llm-architecture, infrastructure, typespec, database-structure.

Record lessons manually with `/gator:review learn "description"`. Lessons are validated periodically against current documentation via `/gator:review --validate`.

### Scan Flags

| Flag | Purpose |
|------|---------|
| `--track-branch` | Capture git branch/commit in scan output (opt-in) |
| `--json` | Output scan results as JSON (stats, changes, git info) |
| `--agent` | Wrap output in agent envelope (implies `--json`) |

### Schema Version

All JSON files (`index.json`, `graph.json`, `file_map.json`, `prompts.json`) include a `schema_version` field (currently `1.0.0`). The `file_map.json` is wrapped as `{ schema_version, generated_at, files: { ... } }`.

### Branch Tracking

When `--track-branch` is used during scan:
- `timeline.json` entries include a `git` field with `{ branch, commit }`
- `SUMMARY.md` header shows `> Branch: **main** @ \`abc1234\``
- `navgator history` shows `[branch@commit]` tags on entries
- `navgator projects` shows the last tracked branch

## Architecture Data Location

All data lives in `<project-root>/.navgator/architecture/`:
```
.navgator/architecture/
├── SUMMARY.md          ← Read this first (hot context)
├── SUMMARY_FULL.md     ← Full version if compressed
├── index.json          ← Master index
├── graph.json          ← Connection graph
├── file_map.json       ← File path → component ID lookup
├── prompts.json        ← Full prompt content + LLM associations
├── hashes.json         ← File change detection
├── timeline.json       ← Architecture change history (diffs between scans)
├── components/         ← One JSON per component
└── connections/        ← One JSON per connection
```

## Key Principle

Instead of trying to "remember" architecture details, reload the externalized source of truth. SUMMARY.md is cheap to read and gives you the full picture. Drill into detail files only when needed.
