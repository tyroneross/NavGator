# AGENTS.md — NavGator

Universal AI agent guidance for Claude Code, Codex, Cursor, Copilot, Gemini CLI, and any other AI coding agent working in this repository.

---

## What This Project Is

NavGator (`@tyroneross/navgator`) is an architecture tracking plugin for Claude Code and Codex. It maps dependencies, analyzes impact, and visualizes your stack before you make changes. It ships as an npm package plus explicit host surfaces for Claude and Codex.

- **npm package:** `@tyroneross/navgator` (v0.9.1 release target)
- **Plugin name:** `navgator`
- **Runtime:** Node.js >= 20.19.0, TypeScript (ES2022, NodeNext modules)
- **License:** Apache-2.0

---

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

Without `--with-mcp`, no MCP server is registered on either host. See the
CLI-command mapping in [README.md](README.md#migrating-off-the-mcp-tools).

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

---

## Repository Layout

```
NavGator/
├── src/                        # TypeScript source
│   ├── scanner.ts              # Top-level scan orchestrator
│   ├── scanners/               # Detection modules
│   │   ├── packages/           # npm/pip/SPM/Cargo package detection
│   │   ├── connections/        # Connection inference
│   │   ├── infrastructure/     # Env vars, queues, cron, deploy configs
│   │   ├── prompts/            # LLM prompt extraction
│   │   ├── swift/              # Swift/SPM detection
│   │   └── xcode/              # Xcode project detection
│   ├── mcp/
│   │   ├── server.ts           # MCP server (JSON-RPC 2.0 over stdio)
│   │   └── tools.ts            # MCP tool definitions
│   ├── impact.ts               # Blast-radius / impact analysis
│   ├── trace.ts                # Data-flow tracing
│   ├── llm-dedup.ts            # LLM use-case deduplication
│   ├── rules.ts                # Architecture rule checks
│   ├── diagram.ts              # Mermaid diagram generation
│   ├── storage.ts              # Read/write .navgator/architecture/
│   ├── resolve.ts              # Component name resolution
│   ├── config.ts               # Feature flags and project config
│   ├── git.ts                  # Branch/commit tracking
│   └── types.ts                # Shared TypeScript types
├── dist/                       # Compiled output (do not edit)
│   └── mcp/server.js           # MCP server entry point
├── skills/                     # 6 Claude Code skills
│   ├── architecture-scan/      # Auto-scan triggers
│   ├── architecture-export/    # Export/diagram generation
│   ├── navgator-setup/         # First-run setup guidance
│   ├── impact-analysis/        # Impact query guidance
│   ├── code-review/            # Architecture-aware review
│   └── infrastructure-scanning/   # Infrastructure detection skill
├── commands/                   # 15 slash command definitions
│   ├── dead.md, deep-map.md, feedback.md, gator.md, impact.md, lessons.md, llm-map.md
│   ├── map.md, plan.md, promote-lesson.md, review.md
│   ├── scan.md, schema.md, test.md, trace.md
├── hooks/
│   └── hooks.json              # Empty by default; no automatic hooks enabled
├── agents/
│   ├── architecture-advisor.md     # Stack decisions + migration planning
│   ├── architecture-investigator.md  # SRE-style read-only investigation
│   ├── architecture-planner.md     # Graph freshness + CLI orchestration
│   └── external-resolver.md        # External dependency freshness resolution
├── .claude-plugin/
│   └── plugin.json             # Claude plugin manifest (name: navgator)
├── .codex-plugin/
│   └── plugin.json             # Codex plugin manifest (name: navgator)
├── mcp-optin/                  # Opt-in MCP manifests, installed only with --with-mcp
│   ├── claude.mcp.json
│   ├── codex.mcp.json
│   └── README.md
├── web/                        # Optional Next.js UI
└── scripts/
    └── install-plugin.sh       # Global plugin installer
```

---

## Development Commands

```bash
npm install          # Install dependencies
npm run build        # Full build: TypeScript + Next.js web UI
npm run build:cli    # TypeScript only (faster)
npm test             # Run test suite (vitest)
npm run dev          # Watch mode for TypeScript
npm run mcp          # Start MCP server directly (opt-in escape hatch; not registered by default)
npm run clean        # Remove dist/ and web/.next/
```

Build output goes to `dist/`. `dist/mcp/server.js` is the MCP server entry point; it is always built but registered on neither host unless the installer runs with `--with-mcp`.

---

## Plugin Architecture

### Plugin Manifests

Claude remains authoritative for host-specific behavior. The repo also ships an additive Codex surface.

Claude surface uses `.claude-plugin/plugin.json` for metadata and Claude's
default-path discovery for runtime capabilities:
- Commands: `./commands/`
- Agents: `./agents/`
- Skills: `./skills/`
- Hooks: `./hooks/hooks.json` (empty by default; do not redeclare in the manifest)
- MCP servers: none by default. `bash scripts/install-plugin.sh --global --with-mcp` registers `mcp-optin/claude.mcp.json`.

`scripts/install-plugin.sh` materializes a dependency-complete package, adds
that local directory as the `navgator` marketplace, and installs and enables
`navgator@navgator` through the Claude CLI. Without `--with-mcp` no MCP process
is registered; with it, the installer also verifies the installed cache's MCP
process before reporting success. A filesystem symlink alone is not a
registered Claude plugin.

Codex surface (`.codex-plugin/plugin.json`) points to:
- Skills: `./skills/`, driving the `navgator` CLI
- MCP servers: none by default. `bash scripts/install-codex-plugin.sh --user --with-mcp` registers `mcp-optin/codex.mcp.json`.
- Interface metadata for Codex UI

Codex does not discover Claude's `commands/` or `agents/` directories. Run
`scripts/install-codex-plugin.sh` to materialize the npm package at a non-empty
local marketplace path. By default no MCP server is registered; pass
`--with-mcp` to also install `mcp-optin/codex.mcp.json`, retargeted to Codex's
deterministic versioned cache with no fixed `cwd`, so installed code is
cache-owned while scan scope follows the active task workspace. The script
registers the path; the user must still install/enable `navgator` in the Codex
plugin browser and start a new task. Passing `--with-mcp` and then re-running
without it fully reverts the registration: the default branch removes
`.codex-plugin/mcp.json`, deletes the manifest's `mcpServers` key, and strips the
same two artifacts from Codex's versioned cache. Reinstallation alone reverts
neither — `npm install --install-links` of an already-materialized same version
prunes no extraneous file and restores no mutated manifest — so opt-in without
that branch would be a one-way door.

#### Resolving the navgator binary on Codex

Codex loads `skills/` and nothing else. The manifest declares no binary, the host
exports no PATH entry, and nothing sets `NAVGATOR_HOME`. Binary resolution is
therefore prose in the skills (`navgator` on PATH → `npx --no-install navgator` →
`node "$NAVGATOR_HOME/dist/cli/index.js"`), and only the first two rungs can
resolve on this host: rung 3's `NAVGATOR_HOME` is defined structurally only for
Claude, which exports `${CLAUDE_PLUGIN_ROOT}`. Neither installer puts `navgator`
on PATH — `npm install --prefix` leaves the shim at
`<runtime-root>/node_modules/.bin/navgator`, which no host reads.

A Codex user without `navgator` on PATH therefore has every rung fail.
`scripts/install-codex-plugin.sh` checks `command -v navgator` after
materialization, reports the resolved PATH binary's path, version, and realpath
source when present, and otherwise prints a REQUIRED next step that exports the
already-materialized `<runtime-root>/node_modules/.bin`. It does not recommend
replacing a newer local runtime with an older registry release. It warns rather
than hard-fails: registration itself succeeded and is not rolled back by exiting
non-zero, and the fix applies afterwards without re-running the installer. The
Claude installer reports the same reachability, but its message says the plugin
works regardless — `${CLAUDE_PLUGIN_ROOT}` keeps rung 3 live there.

### MCP Server (opt-in, off by default)

JSON-RPC 2.0 over stdio. Entry: `dist/mcp/server.js`. Not registered on either
host unless the installer runs with `--with-mcp` (see Agent interface policy
below); `npm run mcp` starts it directly as a manual escape hatch.

12 tools exposed:

| Tool | Purpose |
|------|---------|
| `scan` | Detect components and connections; returns delta from last scan |
| `status` | Architecture summary with runtime topology and LLM use cases |
| `impact` | Blast-radius analysis for a named component |
| `connections` | All inbound/outbound connections for a component |
| `diagram` | Generate Mermaid diagram (full, component, layer, or summary) |
| `trace` | Data-flow trace forward and backward through the graph |
| `summary` | Executive summary for agent consumption |
| `review` | Architectural integrity review (drift, lessons, violations) |
| `explore` | Deep dive on one component: connections, runtime identity, impact severity, trace paths, layer position |
| `rules` | Rule checks: orphans, layer violations, cycles, hotspots |
| `portfolio` | Cross-repo dependency/service map; scans a local folder of repos, or reports over already-registered projects with no `dir` |
| `arch_diff` | Pre-merge architecture diff — current branch vs. canonical (or a named `base` ref) |

**`scan_remote` is deliberately not an MCP tool.** `navgator scan-remote <url>` runs `git clone` against a caller-supplied URL — exposing that as an agent-invokable tool would put a network fetch on a prompt-injection-reachable path (a malicious doc or tool output could smuggle a URL that gets cloned and scanned without a human in the loop). It ships CLI-only, human-initiated, and stays that way until a URL allowlist exists. `portfolio` and `arch_diff` were added instead because they operate over local paths only, with no equivalent network-fetch surface. Do not "fix" this omission by adding a `scan_remote` MCP tool without first landing an allowlist.

### Slash Commands (15)

| Command | Purpose |
|---------|---------|
| `/navgator:dead` | Find orphaned components — unused packages, models, queues, infra |
| `/navgator:deep-map` | Plan, ingest, and report semantic findings outside the authoritative graph |
| `/navgator:feedback` | Prepare and file a source-grounded NavGator issue |
| `/navgator:gator` | Main router — dispatches to the right subcommand based on intent |
| `/navgator:impact` | Blast-radius analysis before modifying a component |
| `/navgator:lessons` | List, search, promote, and manage architecture lessons |
| `/navgator:llm-map` | Map all LLM use cases by purpose, provider, and connection |
| `/navgator:map` | Map full architecture — components, connections, topology, LLM use cases |
| `/navgator:plan` | Plan an architecture change or investigation (delegates to architecture-planner agent) |
| `/navgator:promote-lesson` | Scan per-project lessons and propose cross-project patterns for global promotion |
| `/navgator:review` | Architectural integrity review — connections, drift, lessons |
| `/navgator:scan` | Quick scan — refresh component and connection tracking |
| `/navgator:schema` | Show readers vs writers per database model |
| `/navgator:test` | End-to-end architecture test — verify components, connections, no orphans |
| `/navgator:trace` | Trace data flow forward and backward through the architecture |

### Skills (6)

`architecture-scan`, `architecture-export`, `navgator-setup`, `impact-analysis`, `code-review`, `infrastructure-scanning`

Skills have different auto-trigger patterns — check each `SKILL.md` before modifying trigger conditions.

### Hooks

`hooks/hooks.json` is intentionally empty. NavGator should be invoked explicitly through the CLI, slash commands, or opt-in MCP tools instead of adding automatic scan reminders to every session.

### Agents (4, Claude only)

**`architecture-advisor`** — Stack decisions, migration planning, dependency compatibility. Tools: Bash, Read, Glob, Grep, WebSearch. Uses NavGator data to produce: Current State, Impact Analysis, Recommendation, Change Sequence, Verification.

**`architecture-investigator`** — SRE-style read-only investigation across 5 phases: Overview, Identify, Trace, Rules, Synthesize. Read-only during phases 1–4. Every finding cites specific tool output. Tools: Bash, Read, Glob, Grep.

**`architecture-planner`** — Graph freshness check + CLI orchestration for architecture-aware questions. Reads `index.json` + `hashes.json`, runs `navgator scan --auto` if stale so configuration changes can trigger a required full refresh, then dispatches `navgator impact|trace|connections|review|dead|rules --agent` and returns a structured report. Triggers on phrasings like "review architecture for X", "blast radius of Y", "how does A connect to B".

**`external-resolver`** — Isolated external-boundary freshness resolver for packages and services. Updates NavGator's cache and returns structured drift evidence without mutating the architecture graph directly.

---

## Storage Model (Three-Tier Context + Home Stores)

Architecture data lives in `<project-root>/.navgator/architecture/`.

| Tier | Files | When to read |
|------|-------|-------------|
| Tier 1 — Hot | `NAVSUMMARY.md` (max ~150 lines) | Always first. Concise overview, AI routing table, delta |
| Tier 2 — Records and index | `components.full.jsonl`, `connections.full.jsonl`, `index.json`, `graph.json`, `file_map.json`, `prompts.json` | Complete records plus programmatic lookups and traversal |
| Tier 3 — Optional detail | `components/COMP_*.json`, `connections/CONN_*.json` | Opt-in stable per-record paths for external tooling |

Versioned JSON outputs use `schema_version: "1.1.0"`. Agent-mode output (`--agent` flag) wraps responses in a stable envelope with `command`, `data`, `schema_version`, and `timestamp`.

### Full Storage Structure

```
.navgator/architecture/
├── NAVSUMMARY.md          # Hot context — read first
├── NAVSUMMARY_FULL.md     # Full version if NAVSUMMARY was compressed
├── components.full.jsonl  # Canonical complete component records
├── connections.full.jsonl # Canonical complete connection records
├── index.json             # Derived component counts, types, layers, stats
├── graph.json             # Derived graph projection (lossy)
├── file_map.json          # Derived file path → component ID lookup
├── prompts.json           # LLM prompt content + provider associations
├── hashes.json            # File change detection
├── timeline.json          # Change history (diffs between scans)
├── connections.jsonl      # Compact connection projection (lossy)
├── reverse-deps.json      # Derived file → importers index
├── components/            # Optional COMP_*.json (--per-entity-files)
└── connections/           # Optional CONN_*.json (--per-entity-files)
```

The `*.full.jsonl` files are the canonical consolidated store. Per-entity directories are disabled by default and duplicate those records when enabled. Graph and compact formats are derived views and may omit fields.

Lessons accumulate in `.navgator/lessons/lessons.json`.

### Home-scoped stores (`~/.navgator/`)

Everything above is per-project and regenerable by rescanning. Four things live
in the user's home directory instead:

```
~/.navgator/
├── projects.json              # The registry — journaled + locked writes only
├── registry-journal.jsonl     # Forensic op log (digests, not identity; rotates)
├── lessons/global-lessons.json# Promoted cross-project patterns
└── memory/                    # gator-memory — durable narrative
    ├── index.json             #   materialized rollup (rebuildMemoryIndex only)
    ├── events.jsonl           #   append-only chronology, size-rotated
    └── projects/<slug>.json   #   DURABLE per-project record — source of truth
```

**gator-memory** answers *what happened over time* — which projects exist, when
they entered, what materially changed. Populated automatically on scan; no
setup, no dependency, no network. Only meaningful events are recorded
(`project.registered`, `project.scanned`, `architecture.changed`,
`project.removed`); a `patch`-significance rescan writes nothing.

**Rules for anything touching these:**

- Never write `projects.json` directly. Every mutation goes through
  `registerProject` / `updateProjectMeta` / `removeProject` / `pruneProjects`,
  which route via `mutateRegistry` (in-process mutex + cross-process file lock
  + compare-and-swap + journal record).
- Never put a shared-rollup write on the capture path. `index.json` is written
  only by `rebuildMemoryIndex()`, because `scanPortfolio` runs concurrent
  workers that all reach `registerProject`.
- Memory writes are fail-open and must stay outside both locks and outside
  `registerProject`'s registry try/catch.
- `~/.navgator/config.json` is the home-scoped config (`src/home-config.ts`);
  absent file means all defaults. Distinct from `src/config.ts`, which is
  project/storage-scoped and env-only.

`navgator doctor` reports hygiene across all of these. Design rationale:
`docs/plans/2026-08-03-gator-memory.md`.

---

## Tiered mapping (`deep-map`) — invariants

`src/deep-map/` adds a semantic layer on top of the scan without putting a model
inside NavGator. Four invariants hold it up; breaking any of them breaks the
feature's reason to exist.

1. **No model runs here.** No LLM SDK, no network call, no subprocess to a
   runtime. `plan` emits packets, `ingest` validates results the calling agent
   wrote. If you find yourself wanting to call a model from this directory, the
   design has gone wrong.
2. **Tier 0 is the only authority on what exists.** Ingest rejects any finding
   whose `component_id` is absent from the scan, and any whose evidence resolves
   to no path in `file_map.json`. Rejections are counted, never coerced.
3. **Findings never enter `.navgator/architecture/`.** They live under
   `.navgator/deep-map/runs/<run_id>/` and join to components at read time only.
   `rm -rf .navgator/deep-map` must leave every other command working.
4. **Degree is scored once.** PageRank is a degree-family centrality, and
   `hotspot-module`, `high-fan-out`, `shallow-module`, and
   `single-point-of-failure` are thresholded degree. `DEGREE_DERIVED_RULE_IDS`
   subtracts them from the violations signal, and raw fan-in/fan-out is not a
   signal at all. Adding one back would make the published weights a fiction.

Two implementation notes that are easy to get wrong:

- **Build a group's edges by filtering connections, not by traversal.**
  `extractSubgraph` at depth 1 collects one-hop neighbours outside the group and
  then truncates in component-array order, which can drop genuine members before
  any filter runs — on a four-member group ordered after its neighbours that
  returned zero of four internal edges.
- **Split an oversized community by breadth-first search, not by rank.** Rank
  slicing puts a community's top-N nodes in one part and the rest in another,
  sharing most of their edges, which destroys the isolation the split exists to
  create.

---

## What NavGator Detects

The scanner (`src/scanner.ts` + `src/scanners/`) detects:

- **Packages:** npm, pip, SPM, and Cargo — dependency trees and version info
- **Prisma models:** schema parsing, relations, indexes, field-level usage
- **Environment variables:** `.env` files and `process.env` references in source
- **Queues:** BullMQ/Bull producers and consumers
- **Cron jobs:** `vercel.json`, `railway.json`, `node-cron` patterns
- **Deploy configs:** Vercel, Railway, Heroku service definitions
- **Swift/Xcode:** Package.swift, `.pbxproj`, Podfile, `.entitlements`, `Info.plist`
- **LLM prompts:** Prompt content extraction with provider associations
- **Markdown content:** Opt-in `--content` scanning for document components, Obsidian wikilinks, internal Markdown links, and typed frontmatter relationships; `.navgatorignore` controls corpus boundaries

---

## LLM Use Case Tracking

NavGator tracks **distinct use cases**, not raw import counts. Instead of "154 service calls," it reports "8 use cases across 3 providers."

Deduplication priority cascade (source: `src/llm-dedup.ts`):
1. Prompt-based grouping (strongest signal)
2. Function name grouping
3. callType + model grouping
4. File-based grouping (fallback)

Test and dev-only connections are filtered automatically.

---

## Runtime Topology

NavGator annotates components with runtime identity: service names, connection endpoints, and deploy targets extracted from code and config. Enables backward tracing from a runtime failure to the source code that produces it. `navgator status` shows a RUNTIME TOPOLOGY section.

---

## Change Guidance

| Area | Location | Notes |
|------|----------|-------|
| Component/connection detection | `src/scanners/` | Changes affect what gets detected during scan |
| Connection graph + impact | `src/impact.ts`, `src/trace.ts` | Graph traversal logic |
| LLM use-case dedup | `src/llm-dedup.ts` | Dedup cascade; test against real project outputs |
| NAVSUMMARY generation | `src/storage.ts` or scanner output | Keep output under 150 lines for hot context budget |
| MCP tools | `src/mcp/tools.ts` | Add new tools here; server.ts handles transport |
| Skills | `skills/*/SKILL.md` | 6 skills with different auto-trigger patterns |
| Commands | `commands/*.md` | Slash command prompt definitions |
| Hooks | `hooks/hooks.json` | Empty by default; changes affect all plugin consumers |
| Rule checks | `src/rules.ts` | Orphan, cycle, layer violation, hotspot detection |

---

## Key Constraints

- **NAVSUMMARY.md must stay under ~150 lines.** It is hot context — read at session start. Bloating it defeats the tier model.
- **The CLI is the preferred interface for agents** — run `navgator scan|explore|trace|impact|rules --agent` rather than reading JSON files directly. MCP is opt-in only (see Agent interface policy above).
- **Storage path is `.navgator/`**, not `.claude/`. Migration logic exists for legacy paths.
- **`--agent` flag** wraps any command output in a stable JSON envelope for machine consumption.
- **Node.js >= 20.19.0 required.** `package.json` declares this floor and both installers hard-fail below it. It satisfies the packaged Next.js dashboard's Node 20.9+ requirement. TypeScript compiles to ES2022 with NodeNext module resolution.
- **`ts-morph` is an optional dependency** — scanner functionality degrades gracefully without it.
