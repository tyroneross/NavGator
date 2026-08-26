<!-- Plugin: navgator · Version: 0.9.1 · Source of truth: checked-in package and host manifests -->
<!-- Before any commit, version bump, or major change, read ./VERSIONING.md. Update it on version bumps. -->

# NavGator — Architecture Context for Claude

## What NavGator Does

NavGator externalizes architecture knowledge so you never lose track of file paths, dependencies, model routing, or component connections between sessions.

## Agent interface policy: CLI first, HTTP second, MCP last resort

**CLI first — the default, always.** `navgator <command> --agent` is the wired
surface for every agent-facing operation on both Claude Code and Codex. Each call
spawns a fresh process, so it reads current on-disk state, returns a real exit
code, and writes a stable `{command, data, schema_version, timestamp}` envelope
to stdout. It costs zero context until it is called.

**Local HTTP API second — for process boundaries only.** The loopback dashboard
(`navgator ui`) serves read routes under `web/app/api/`. Use it when a separate,
already-running process needs a request/response boundary. It is not an agent
surface: an agent that can run a shell should run the CLI.

**MCP last resort — deprecated as a default, opt-in only.** NavGator no longer
registers an MCP server on either host. The server code still ships and still
works; opt in with `--with-mcp` on either installer. Use it only for a consumer
that genuinely cannot spawn a subprocess — no shell, no Bash tool. Three failure
modes drove the demotion:

- **Startup state caching.** The server is a long-lived process. State it reads at
  startup can go stale against the working tree while the session continues, so a
  tool can answer from a snapshot the user has already changed. A CLI call
  re-reads on every invocation.
- **Silent failure.** A failed handshake or a crashed server surfaces as a missing
  tool, not an error. A CLI call returns a non-zero exit code and stderr you can
  act on.
- **Context cost.** Twelve tool schemas load into every request whether or not the
  session touches architecture. The CLI costs nothing until it is called.

Opting in:

    bash scripts/install-plugin.sh --global --with-mcp        # Claude Code
    bash scripts/install-codex-plugin.sh --user --with-mcp    # Codex

Without `--with-mcp`, no MCP server is registered on either host.

### Exit codes

`navgator <command> --agent` returns one of five exit codes so a caller can
decide what happened without parsing stdout. `0`–`2` predate this contract and
keep their existing meanings; `3` and `4` are additive.

| Code | Name | Meaning | Caller should |
|---|---|---|---|
| `0` | `SUCCESS` | Command ran, produced its result | Read stdout |
| `1` | `OPERATIONAL` | Unexpected failure — exception, unreadable/unwritable state, spawn failure | Read stderr; treat as a bug or environment problem, not a retry target |
| `2` | `NO_DATA` | Ran fine, but nothing to report yet — no scan data, stale index, lock busy, nothing to diff. Not an error. | Run `navgator scan` (or retry once the lock clears) |
| `3` | `NOT_FOUND` | The named entity does not exist — unknown component, unregistered project, missing lesson id, unknown model | Check the name/id (candidates are usually printed), don't retry unchanged |
| `4` | `USAGE` | The invocation itself was wrong — bad/missing arguments, mutually exclusive flags, or a request this surface can't serve (e.g. a natural-language argument) | Fix the invocation; retrying unchanged will fail the same way |

Named constants live in `src/cli/exit-codes.ts` — reference those, not the
bare numbers, from anything that shells out to `navgator`.

See the CLI-command mapping and full rationale in [README.md](README.md#migrating-off-the-mcp-tools).

## Context Model (Three Tiers)

**Tier 1 — Hot Context** (`NAVSUMMARY.md`)
Read this first. It's a concise overview (~40-150 lines) with:
- Components by layer (frontend, backend, database, queue, infra, external)
- AI/LLM routing table (provider, file, line, purpose)
- Top connections with `file:line` references
- Delta from last scan (what changed)
- Pointers to detail files for drill-down

If `NAVSUMMARY.md` was compressed (large projects), the full version is at `NAVSUMMARY_FULL.md`.

**Tier 2 — Canonical Records and Structured Index** (`components.full.jsonl`, `connections.full.jsonl`, `index.json`, `graph.json`, `file_map.json`, `prompts.json`)
Use for programmatic lookups:
- `components.full.jsonl` — canonical complete component records
- `connections.full.jsonl` — canonical complete connection records
- `index.json` — component counts, types, layers, stats
- `graph.json` — derived graph projection for impact analysis; omits some record fields
- `file_map.json` — maps file paths to component IDs (O(1) lookup)
- `prompts.json` — full prompt content with LLM provider associations (scan with `--prompts`)

**Tier 3 — Detail Files** (`components/COMP_*.json`, `connections/CONN_*.json`) *(opt-in since v0.9.0)*
Off by default to keep the on-disk footprint small. The canonical consolidated `components.full.jsonl` and `connections.full.jsonl` files retain complete records; `graph.json`, `index.json`, `file_map.json`, `connections.jsonl`, and `reverse-deps.json` are derived, potentially lossy views. Enable per-entity files when you need stable per-record paths (Obsidian linking, external indexers): run `navgator scan --per-entity-files` or set `NAVGATOR_PER_ENTITY_FILES=true`. When disabled, each scan idempotently removes any legacy per-entity files left over from earlier versions.

## When to Read Architecture Context

**Always read `NAVSUMMARY.md` at the start of a session.** It's located at:
```
<project-root>/.navgator/architecture/NAVSUMMARY.md
```

**Before editing tracked files:** If you're about to edit a file that belongs to a tracked component, read the component detail when per-entity files are enabled, or use `navgator explore`. NavGator does not install an automatic reminder hook.

**After dependency changes:** If you ran `npm install`, `pip install`, etc., architecture data may be stale. Run `/navgator:scan` to update.

## Investigation Protocol — Consult Before Fixing

**Before fixing a bug, debugging an issue, or making any change that touches multiple files:**

1. **Understand the component:** Run `navgator explore <component> --agent` to see what the component connects to, its runtime identity, impact severity, and data flow paths. Add `--depth N` to widen the connection radius.

2. **Check blast radius:** Run `navgator impact <component> --agent` to see what breaks downstream. A "simple fix" in a high-fan-out component can cascade.

3. **Trace the data flow:** Run `navgator trace <component> --agent` to follow how data moves through the system. This reveals the full chain: User → Frontend → API → Service → Database → Response.

4. **Check for patterns:** Run `navgator rules --agent` to identify any existing architectural violations that might be related to the issue.

**Why this matters:** Code fixes that don't consider architecture cause cascading failures. NavGator's graph shows connections that aren't obvious from reading a single file. A queue worker change might affect 5 API routes and 3 cron jobs — NavGator tells you which ones.

**Quick reference for common investigation tasks:**

| I need to... | Use |
|-------------|-----|
| Understand a component before changing it | `navgator explore <component> --agent` |
| Know what breaks if I change X | `navgator impact <component> --agent` |
| Follow data through the system | `navgator trace <component> --agent` |
| Check architecture health | `navgator rules --agent` or `/navgator:review` |
| Find where a function/file is used | `navgator connections <component> --agent` |
| See the stored architecture overview without refreshing | `navgator status --agent --no-refresh` |

## Retrieving Stored Context

NavGator stores architecture data in `.navgator/architecture/`. Key files for retrieval:

| File | What it contains | When to read |
|------|-----------------|-------------|
| `NAVSUMMARY.md` | Hot context — component overview, AI routing, top connections | Session start, quick orientation |
| `components.full.jsonl` | Canonical complete component records | Complete component retrieval |
| `connections.full.jsonl` | Canonical complete connection records | Complete relationship retrieval |
| `index.json` | Stats, component/connection counts by type | Programmatic lookups |
| `file_map.json` | File path → component ID mapping | "What component owns this file?" |
| `graph.json` | Derived graph projection (lossy) | Impact analysis, traversal |
| `prompts.json` | AI prompt content + provider associations | LLM debugging, prompt review |
| `components/COMP_*.json` | Full detail for one component *(opt-in: `--per-entity-files`)* | Deep dive on specific component |
| `connections/CONN_*.json` | Full detail for one connection *(opt-in: `--per-entity-files`)* | Understanding a specific relationship |

**For agents building on NavGator:** Run the CLI with `--agent` (`navgator scan|status|explore|review|trace|rules|portfolio|arch-diff --agent`) rather than reading JSON files directly. Each call returns pre-analyzed, compact text output optimized for LLM consumption.

## Available Commands

### Slash Commands

| Command | Purpose |
|---------|---------|
| `/navgator:gator [intent]` | Route a free-form architecture request to the most specific command or skill |
| `/navgator:map` | Map full architecture — components, connections, topology, LLM use cases |
| `/navgator:plan "<intent>"` | Delegate architecture-aware change planning to the planner agent |
| `/navgator:scan` | Quick scan — refresh tracking data |
| `/navgator:trace <component>` | Trace data flow through the system (cron → route → service → DB → queue → LLM) |
| `/navgator:impact <component>` | What breaks if you change this? Blast radius analysis |
| `/navgator:test [instructions]` | End-to-end architecture test with optional custom focus |
| `/navgator:review` | Architectural integrity review (connections, drift, lessons) |
| `/navgator:review learn "..."` | Record a manual architectural lesson |
| `/navgator:llm-map` | Map all LLM use cases by purpose (search, summarization, extraction, etc.) |
| `/navgator:deep-map` | Tiered mapping — isolate component groups, fan out parallel agents to describe them, then hunt inefficiencies with evidence |
| `/navgator:schema [model]` | Show readers vs writers per database model |
| `/navgator:dead` | Find orphaned components — unused packages, models, queues, infra |
| `/navgator:lessons` | Manage project and global architecture lessons |
| `/navgator:promote-lesson` | Find recurring cross-project lesson patterns for promotion |

### CLI Commands

| Command | Purpose |
|---------|---------|
| `navgator status` | Architecture summary with runtime topology and anomaly warnings |
| `navgator explore <component> [--depth N]` | Full detail on a component: connections, runtime identity, impact severity, data flow paths |
| `navgator connections <component>` | Show all connections with `[test]`/`[dev-only]` badges |
| `navgator diagram` | Generate visual architecture diagram |
| `navgator trace <component>` | Trace with `--production`, `--max-paths N`, `--direction` |
| `navgator rules` | Check architecture rules (orphans, layer violations, cycles, hotspots) |
| `navgator review [--component <c>]` | Architectural integrity review (drift, lessons, violations) |
| `navgator llm-map` | LLM use case map with `--provider`, `--category`, `--classify` |
| `navgator schema [model]` | Database model read/write analysis |
| `navgator dead` | List orphaned components by type |
| `navgator history` | Architecture change timeline |
| `navgator diff [id]` | Detailed architecture diff |
| `navgator subgraph --focus <components>` | Extract focused subgraph (no positional arg; `--layer`, `--classification`, `--depth`, `--max-nodes`, `--format json\|mermaid`) |
| `navgator coverage --fields` | Prisma field usage analysis |
| `navgator coverage --typespec` | Prisma vs TypeScript type validation |
| `navgator coverage --fields` | Analyze DB field usage (unused, read-only, write-only) |
| `navgator coverage --typespec` | Validate Prisma types against TypeScript interfaces |
| `navgator portfolio [dir]` | Cross-repo dependency/service map; scans a folder of repos, or reports over registered projects with no `dir` |
| `navgator scan-remote <url>` | Shallow-clone a GitHub repo by URL and scan it (CLI-only, human-initiated) |
| `navgator arch-diff` | Pre-merge architecture diff — current branch vs. canonical (or a named `--base` ref) |
| `navgator registry-log` | Show recent reads and writes of the project registry |
| `navgator doctor` | Registry + gator-memory hygiene report; `--fix` prunes accumulated temp fixtures behind a backup and confirmation |
| `navgator deep-map plan\|ingest\|report\|status` | Tiered mapping — emits work packets for the calling agent to fan out over, then validates and attributes what comes back |

## Agent/Machine Output

All commands that support `--json` also support `--agent`, which wraps output in a stable envelope:

```json
{
  "command": "scan",
  "data": { ... },
  "schema_version": "1.1.0",
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

### Source-Level Code Navigation (Swift, Rust)

NavGator scans compiled-language source directly, not just package manifests. Two stacks are supported and run automatically during `navgator scan`:

- **Swift** — gated on `Package.swift`/Xcode project. Extracts types, protocol conformance (`conforms-to`), observable/actor state, string-keyed deps (`stores`), SwiftUI navigation, LLM calls, and entitlement requirements. Sets project type `swift-app`.
- **Rust** — gated on `Cargo.toml`/`Cargo.lock`. Extracts modules, structs/enums/traits, trait impls (`conforms-to`), the internal `use` graph (`imports`), external crate use (`uses-package`), and LLM API calls (`service-call`). Sets project type `rust-app`. Scanner: `src/scanners/rust/code-scanner.ts`, wired in `src/scanner.ts` under `detectCargo`.

These components/connections join the same graph as everything else, so `explore`, `trace`, `impact`, and `diagram` operate on Swift/Rust symbols identically. `navgator status` shows the detected project stack on its `Project:` line.

### Runtime Topology

NavGator annotates components with runtime identity — service names, connection endpoints, and deployment targets extracted from code and config. This enables backward tracing from runtime failures to code: "which code produces to this BullMQ queue?" or "what database engine does this Prisma schema connect to?"

The `navgator status` command shows a RUNTIME TOPOLOGY section with all detected bindings.

### LLM Use Case Tracking

NavGator tracks distinct LLM use cases, not raw import counts. Instead of "154 service calls," it shows "8 use cases across 3 providers." Deduplication uses a priority cascade: prompt-based grouping (strongest), function name grouping, callType+model grouping, file-based (fallback). Test and dev-only connections are filtered automatically.

The `navgator status` command shows an AI/LLM section with use case count, providers, and a table of distinct use cases.

### Tiered Mapping (`deep-map`)

The scanner answers *what exists*. It cannot answer what a component is for,
whether a design is inefficient, or where the risky coupling is — those are
semantic questions no AST pass reaches. `deep-map` adds those answers without
putting a model inside NavGator.

**NavGator emits work packets; the calling agent runs the models.** There is no
LLM SDK in the dependency tree and there never will be. Each packet carries one
isolated group of components, its induced subgraph, a ready-to-send prompt, and
a response schema. The host fans out subagents over them; NavGator ingests,
validates, attributes, and reports.

| Tier | What it is | Cost |
|---|---|---|
| 0 | The existing scan. Components, connections, file map, PageRank, Louvain communities, rule checks. **Sole authority on what exists.** | Free, offline, reproducible |
| 1 | Wide, shallow pass. One cheap agent per component group — purpose, responsibilities, concerns. | Capped at `--max-packets` (default 12) |
| 2 | Deep pass on escalated components only. Specific inefficiencies and coupling risks with `file:symbol` evidence. | Capped at `--max-deep` (default 4), opt-in via `--tier 2` |
| 3 | One synthesis pass over everything ingested. Cross-component issues. | One packet, opt-in via `--tier 3` |

Groups come from Louvain communities restricted to project-authored components;
oversized communities split by breadth-first search so each part stays connected.
Escalation is a weighted score over centrality, cross-cluster bridging,
direction and reachability faults, and LLM-call surface — degree is
represented once, by PageRank, and the degree-derived rules are excluded from
the violation count so one property cannot wear three weights. A rule that fires
on more than half the components scored is withheld from the violation count as
well, and named in the manifest: a flag present on most of the population cannot
rank that population. Every escalated component prints the numbers that
escalated it.

**Findings never enter the graph.** They live in `.navgator/deep-map/`, carry
`tier`, `packet_id`, `source: 'llm'`, and are joined to components only at read
time. A finding naming a component tier 0 did not find is rejected and counted;
so is one whose evidence resolves to no real file. Delete
`.navgator/deep-map/` and every other command still works.

```
.navgator/deep-map/
├── latest.json                          { run_id }
└── runs/<run_id>/
    ├── manifest.json                    partition, escalation, caps, cost
    ├── packets/<id>.json                written by NavGator
    ├── packets/<id>.result.json         written by the calling agent
    ├── findings.jsonl                   validated, attributed
    └── ingest.json                       accept/reject accounting
```

Because the host runs the models, NavGator cannot prove a fan-out happened.
`navgator deep-map status` reports which packets have results, which is what
makes a skipped fan-out visible rather than silent.

### Lessons System

NavGator accumulates architectural lessons in `.navgator/lessons/lessons.json`. Lessons are patterns that caused issues — they're matched against future changes during `/navgator:review`. Categories: api-contract, data-flow, component-communication, llm-architecture, infrastructure, typespec, database-structure.

Record lessons manually with `/navgator:review learn "description"`. Lessons are validated periodically against current documentation via `/navgator:review --validate`.

### Lessons: Per-Project vs Global (Three-Tier Data Model)

NavGator uses a four-tier data model so architecture details stay local to each
repo while transferable patterns and durable history become shareable across
projects.

**Tier 1 — Per-project architecture** (`<project>/.navgator/architecture/`)
Full scan output includes canonical `components.full.jsonl` and
`connections.full.jsonl` records plus derived `index.json`, `graph.json`,
`file_map.json`, `prompts.json`, `connections.jsonl`, `reverse-deps.json`, and
`NAVSUMMARY.md`. With
`--per-entity-files`, also `components/` and `connections/`. Project-specific.
Never shared.

**Tier 2 — Per-project lessons** (`<project>/.navgator/lessons/lessons.json`)
Patterns discovered in *this* project. Recorded via `/navgator:review learn` or
surfaced by `/navgator:review`. Scoped to this repo by default.

**Tier 3 — Global lessons** (`~/.navgator/lessons/global-lessons.json`)
Cross-project patterns — approaches, architectural connections, config insights
that apply across your work. Each entry includes `source_project`, `applies_to`
tags, and `promoted_at` so you can trace provenance.

**Promotion is opt-in and non-destructive.** When you promote a local lesson to
global, the local lesson stays in place but gets marked `promoted: true`. The
global lesson gets a full copy plus traceability fields. There is no automatic
cross-project application — global lessons are for recall and reference.

**Tier 4 — gator-memory** (`~/.navgator/memory/`)
The durable narrative: which projects exist, when they entered, and what
materially changed. Tiers 1–3 answer *what is here* and *what patterns apply*;
none of them answer *what happened over time*. Populated automatically on every
scan — no setup, no dependency, no network.

```
~/.navgator/memory/
├── index.json            materialized rollup — written only by rebuildMemoryIndex()
├── events.jsonl          append-only chronology — size-rotated, one generation
└── projects/<slug>.json  DURABLE per-project record — the source of truth
```

`projects/<slug>.json` is authoritative. Each event is also folded into its
project's `milestones[]`, so deleting `index.json` or `events.jsonl` keeps every
project's identity, counters, and most recent milestones. The milestone list is
capped (oldest evicted), so for a long-lived project the older chronology lives
only in `events.jsonl` until rotation drops it — that cap is what bounds a
single project's file. Slug is
`kebab(basename)-<8 hex of sha256(path)>`, so two directories named `web` stay
distinct.

Four event kinds: `project.registered`, `project.scanned`,
`architecture.changed`, `project.removed`. **Routine scans emit nothing** — a
`patch`-significance rescan produces no event. That is the difference between
this and `registry-journal.jsonl`: the journal records every operation and must
therefore rotate; this records only what is worth remembering.

Bounded by construction: milestones capped per project (oldest evicted),
`events.jsonl` rotated to one generation, and `navgator doctor --fix` removes
records for pruned projects. Fail-open by construction: a broken memory store
can never break a scan or a registry write.

Project removal is **reconciled on read**, not mirrored on write — the dashboard
deletes through a separately compiled unit that cannot import the memory store,
so any record missing from the live registry is reported as orphaned and
repaired by `doctor --fix`, regardless of which surface deleted it.

**Optional mirror to build-loop-memory.** Default OFF. When enabled in
`~/.navgator/config.json` *and* the target exists on disk, each project's memory
is exported one-way to
`<target>/projects/<name-slug>/architecture/navgator-memory.{json,md}`:

```json
{ "memory": { "mirror": { "enabled": true, "target": "~/dev/git-folder/build-loop-memory" } } }
```

If the target does not exist, the mirror is a silent no-op — no warning, no
error. For almost every user that tree does not exist, and that is the normal
case. NavGator never creates the target root (its absence *is* the signal) and
never touches `snapshot.json`, `graph.json`, or `INDEX.jsonl` — those belong to
build-loop's own tooling.

Full design rationale: `docs/plans/2026-08-03-gator-memory.md`.

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
| `--commit` | Auto-commit scan output to the nested `.navgator/.git` for temporal queries (~180ms overhead) |
| `--scip` | Run the SCIP indexer for compiler-accurate cross-file edges (requires `tsconfig`; ~500ms cold) |
| `--single-stack` | Disable multi-stack auto-discovery — scan only the project root |
| `--per-entity-files` | Also write one JSON per component and per connection alongside the canonical `*.full.jsonl` records |
| `--json` | Output scan results as JSON (stats, changes, git info) |
| `--agent` | Wrap output in agent envelope (implies `--json`) |

`--sandbox` is a global flag and goes before the subcommand: `navgator --sandbox scan`. It sets `NAVGATOR_SANDBOX=1`, declaring an environment that restricts network, interactive prompts, and child processes. `CODEX=1` (plus read-only filesystem) and `CI=true` are auto-detected.

**Degradation contract.** Restrictions disable only the SCIP overlay, the one capability that needs a child process. AST scanning and prompt analysis run in-process and still run; a restriction never forces `--quick`. A scan that lost a capability says so — human output prints a `!! DEGRADED SCAN !!` banner naming the restrictions and the disabled capabilities, and `--json`/`--agent` output carries the same three fields under `degraded` (`restrictions`, `disabled_capabilities`, `message`). A complete scan omits `degraded` and prints no banner.

### Schema Version

Versioned JSON outputs use schema version `1.1.0`. The `file_map.json` is wrapped as `{ schema_version, generated_at, files: { ... } }`; each line in the canonical `*.full.jsonl` files is a complete architecture record.

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
├── components.full.jsonl  ← Canonical complete component records
├── connections.full.jsonl ← Canonical complete connection records
├── index.json          ← Derived index and counts
├── graph.json          ← Derived connection graph (lossy)
├── file_map.json       ← File path → component ID lookup
├── prompts.json        ← Full prompt content + LLM associations
├── hashes.json         ← File change detection
├── timeline.json       ← Architecture change history (diffs between scans)
├── connections.jsonl   ← Compact connection projection (lossy)
├── reverse-deps.json   ← Derived: file → importers index (fast incremental walk)
├── components/         ← One JSON per component (opt-in: --per-entity-files)
└── connections/        ← One JSON per connection (opt-in: --per-entity-files)
```

## Key Principle

Instead of trying to "remember" architecture details, reload the externalized source of truth. NAVSUMMARY.md is cheap to read and gives you the full picture. Drill into detail files only when needed.
