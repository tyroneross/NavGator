<!-- Plugin: navgator · Version: 0.6.1 · Source of truth: local (~/Desktop/git-folder/NavGator) -->
<!-- Before any commit, version bump, or major change, read ./VERSIONING.md. Update it on version bumps. -->

# NavGator — Architecture Context for Claude

## What NavGator Does

NavGator externalizes architecture knowledge so you never lose track of file paths, dependencies, model routing, or component connections between sessions.

## Context Model (Three Tiers)

**Tier 1 — Hot Context** (`NAVSUMMARY.md`)
Read this first. It's a concise overview (~40-150 lines) with:
- Components by layer (frontend, backend, database, queue, infra, external)
- AI/LLM routing table (provider, file, line, purpose)
- Top connections with `file:line` references
- Delta from last scan (what changed)
- Pointers to detail files for drill-down

If `NAVSUMMARY.md` was compressed (large projects), the full version is at `NAVSUMMARY_FULL.md`.

**Tier 2 — Structured Index** (`index.json`, `graph.json`, `file_map.json`, `prompts.json`)
Use for programmatic lookups:
- `index.json` — component counts, types, layers, stats
- `graph.json` — full connection graph for impact analysis
- `file_map.json` — maps file paths to component IDs (O(1) lookup)
- `prompts.json` — full prompt content with LLM provider associations (scan with `--prompts`)

**Tier 3 — Detail Files** (`components/COMP_*.json`, `connections/CONN_*.json`)
Load on demand when you need full detail about a specific component or connection. Each entry in NAVSUMMARY.md points to its detail file.

## When to Read Architecture Context

**Always read `NAVSUMMARY.md` at the start of a session.** It's located at:
```
<project-root>/.navgator/architecture/NAVSUMMARY.md
```

**Before editing tracked files:** If you're about to edit a file that belongs to a tracked component, read the component's detail file first. The architecture-check hook will remind you.

**After dependency changes:** If you ran `npm install`, `pip install`, etc., architecture data may be stale. Run `/gator:scan` to update.

## Investigation Protocol — Consult Before Fixing

**Before fixing a bug, debugging an issue, or making any change that touches multiple files:**

1. **Understand the component:** Run `navgator explore <component>` or the `explore` MCP tool to see what the component connects to, its runtime identity, impact severity, and data flow paths.

2. **Check blast radius:** Run `navgator impact <component>` to see what breaks downstream. A "simple fix" in a high-fan-out component can cascade.

3. **Trace the data flow:** Run `navgator trace <component>` to follow how data moves through the system. This reveals the full chain: User → Frontend → API → Service → Database → Response.

4. **Check for patterns:** Run `navgator rules` to identify any existing architectural violations that might be related to the issue.

**Why this matters:** Code fixes that don't consider architecture cause cascading failures. NavGator's graph shows connections that aren't obvious from reading a single file. A queue worker change might affect 5 API routes and 3 cron jobs — NavGator tells you which ones.

**Quick reference for common investigation tasks:**

| I need to... | Use |
|-------------|-----|
| Understand a component before changing it | `explore <component>` |
| Know what breaks if I change X | `impact <component>` |
| Follow data through the system | `trace <component>` |
| Check architecture health | `rules` or `/gator:review` |
| Find where a function/file is used | `connections <component>` |
| See the full architecture overview | `status` |

## Retrieving Stored Context

NavGator stores architecture data in `.navgator/architecture/`. Key files for retrieval:

| File | What it contains | When to read |
|------|-----------------|-------------|
| `NAVSUMMARY.md` | Hot context — component overview, AI routing, top connections | Session start, quick orientation |
| `index.json` | Stats, component/connection counts by type | Programmatic lookups |
| `file_map.json` | File path → component ID mapping | "What component owns this file?" |
| `graph.json` | Full connection graph | Impact analysis, traversal |
| `prompts.json` | AI prompt content + provider associations | LLM debugging, prompt review |
| `components/COMP_*.json` | Full detail for one component | Deep dive on specific component |
| `connections/CONN_*.json` | Full detail for one connection | Understanding a specific relationship |

**For agents building on NavGator:** Use the MCP tools (`scan`, `status`, `explore`, `review`, `trace`, `rules`) rather than reading JSON files directly. The tools return pre-analyzed, compact text output optimized for LLM consumption.

## Available Commands

### Slash Commands

| Command | Purpose |
|---------|---------|
| `/gator:map` | Map full architecture — components, connections, topology, LLM use cases |
| `/gator:scan` | Quick scan — refresh tracking data |
| `/gator:trace <component>` | Trace data flow through the system (cron → route → service → DB → queue → LLM) |
| `/gator:impact <component>` | What breaks if you change this? Blast radius analysis |
| `/gator:test [instructions]` | End-to-end architecture test with optional custom focus |
| `/gator:review` | Architectural integrity review (connections, drift, lessons) |
| `/gator:review learn "..."` | Record a manual architectural lesson |
| `/gator:llm-map` | Map all LLM use cases by purpose (search, summarization, extraction, etc.) |
| `/gator:schema [model]` | Show readers vs writers per database model |
| `/gator:dead` | Find orphaned components — unused packages, models, queues, infra |

### CLI Commands

| Command | Purpose |
|---------|---------|
| `navgator status` | Architecture summary with runtime topology and anomaly warnings |
| `navgator connections <component>` | Show all connections with `[test]`/`[dev-only]` badges |
| `navgator diagram` | Generate visual architecture diagram |
| `navgator trace <component>` | Trace with `--production`, `--max-paths N`, `--direction` |
| `navgator rules` | Check architecture rules (orphans, layer violations, cycles, hotspots) |
| `navgator llm-map` | LLM use case map with `--provider`, `--category`, `--classify` |
| `navgator schema [model]` | Database model read/write analysis |
| `navgator dead` | List orphaned components by type |
| `navgator history` | Architecture change timeline |
| `navgator diff [id]` | Detailed architecture diff |
| `navgator subgraph <component>` | Extract focused subgraph |
| `navgator coverage --fields` | Prisma field usage analysis |
| `navgator coverage --typespec` | Prisma vs TypeScript type validation |
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

### Lessons: Per-Project vs Global (Three-Tier Data Model)

NavGator uses a three-tier data model so architecture details stay local to each
repo while transferable patterns become shareable across projects.

**Tier 1 — Per-project architecture** (`<project>/.navgator/architecture/`)
Full scan output: `index.json`, `graph.json`, `file_map.json`, `prompts.json`,
`components/`, `connections/`, `NAVSUMMARY.md`. Project-specific. Never shared.

**Tier 2 — Per-project lessons** (`<project>/.navgator/lessons/lessons.json`)
Patterns discovered in *this* project. Recorded via `/gator:review learn` or
surfaced by `/gator:review`. Scoped to this repo by default.

**Tier 3 — Global lessons** (`~/.navgator/lessons/global-lessons.json`)
Cross-project patterns — approaches, architectural connections, config insights
that apply across your work. Each entry includes `source_project`, `applies_to`
tags, and `promoted_at` so you can trace provenance.

**Promotion is opt-in and non-destructive.** When you promote a local lesson to
global, the local lesson stays in place but gets marked `promoted: true`. The
global lesson gets a full copy plus traceability fields. There is no automatic
cross-project application — global lessons are for recall and reference.

**CLI**:

| Command | Purpose |
|---------|---------|
| `navgator lessons list` | List lessons in current project |
| `navgator lessons list --global` | List global lessons across all projects |
| `navgator lessons list --all` | Combined view |
| `navgator lessons show <id>` | Show full detail for one lesson |
| `navgator lessons search <query>` | Regex-search across lessons |
| `navgator lessons search <q> --tag <t>` | Filter by applies_to tag (global only) |
| `navgator lessons search <q> --category <c>` | Filter by lesson category |
| `navgator lessons promote <id> --tag <t>` | Promote local → global with tags |
| `navgator lessons demote <id>` | Remove from global (local untouched) |

All `lessons` subcommands support `--json` and the `--agent` envelope.

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
- `NAVSUMMARY.md` header shows `> Branch: **main** @ \`abc1234\``
- `navgator history` shows `[branch@commit]` tags on entries
- `navgator projects` shows the last tracked branch

## Architecture Data Location

All data lives in `<project-root>/.navgator/architecture/`:
```
.navgator/architecture/
├── NAVSUMMARY.md          ← Read this first (hot context)
├── NAVSUMMARY_FULL.md     ← Full version if compressed
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

Instead of trying to "remember" architecture details, reload the externalized source of truth. NAVSUMMARY.md is cheap to read and gives you the full picture. Drill into detail files only when needed.
