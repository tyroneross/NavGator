# AGENTS.md — NavGator

Universal AI agent guidance for Claude Code, Codex, Cursor, Copilot, Gemini CLI, and any other AI coding agent working in this repository.

---

## What This Project Is

NavGator (`@tyroneross/navgator`) is an architecture tracking plugin for Claude Code and Codex. It maps dependencies, analyzes impact, and visualizes your stack before you make changes. It ships as an npm package plus explicit host surfaces for Claude and Codex.

- **npm package:** `@tyroneross/navgator` (v0.9.1 release target)
- **Plugin name:** `navgator`
- **Runtime:** Node.js >= 20.11.0, TypeScript (ES2022, NodeNext modules)
- **License:** Apache-2.0

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
├── commands/                   # 13 slash command definitions
│   ├── dead.md, gator.md, impact.md, lessons.md, llm-map.md
│   ├── map.md, plan.md, promote-lesson.md, review.md
│   ├── scan.md, schema.md, test.md, trace.md
├── hooks/
│   └── hooks.json              # Empty by default; no automatic hooks enabled
├── agents/
│   ├── architecture-advisor.md     # Stack decisions + migration planning
│   ├── architecture-investigator.md  # SRE-style read-only investigation
│   ├── architecture-planner.md     # Graph freshness + MCP-tool orchestration
│   └── external-resolver.md        # External dependency freshness resolution
├── .claude-plugin/
│   └── plugin.json             # Claude plugin manifest (name: navgator)
├── .codex-plugin/
│   ├── plugin.json             # Codex plugin manifest (name: navgator)
│   └── mcp.json                # Codex-relative MCP process config
├── web/                        # Optional Next.js UI
├── scripts/
│   └── install-plugin.sh       # Global plugin installer
└── .mcp.json                   # MCP server registration
```

---

## Development Commands

```bash
npm install          # Install dependencies
npm run build        # Full build: TypeScript + Next.js web UI
npm run build:cli    # TypeScript only (faster)
npm test             # Run test suite (vitest)
npm run dev          # Watch mode for TypeScript
npm run mcp          # Start MCP server directly
npm run clean        # Remove dist/ and web/.next/
```

Build output goes to `dist/`. The MCP server entry point after build is `dist/mcp/server.js`.

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
- MCP servers: `./.mcp.json` (do not redeclare the default path in the manifest)

`scripts/install-plugin.sh` materializes a dependency-complete package, adds
that local directory as the `navgator` marketplace, installs and enables
`navgator@navgator` through the Claude CLI, and verifies the installed cache's
MCP process before reporting success. A filesystem symlink alone is not a
registered Claude plugin.

Codex surface (`.codex-plugin/plugin.json`) points to:
- Skills: `./skills/`
- MCP servers: `./.codex-plugin/mcp.json`
- Interface metadata for Codex UI

Codex does not discover Claude's `commands/` or `agents/` directories. Run
`scripts/install-codex-plugin.sh` to materialize the npm package at a non-empty
local marketplace path. The installer makes the MCP server entry absolute,
targets Codex's deterministic versioned cache, and removes the package-relative
`cwd`, so installed code is cache-owned while scan scope follows the active task
workspace. The script registers the path; the user
must still install/enable `navgator` in the Codex plugin browser and start a new
task.

### MCP Server

JSON-RPC 2.0 over stdio. Entry: `dist/mcp/server.js`.

10 tools exposed:

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
| `explore` | Full detail on a specific component (type, layer, files, metadata) |
| `rules` | Rule checks: orphans, layer violations, cycles, hotspots |

### Slash Commands (13)

| Command | Purpose |
|---------|---------|
| `/navgator:dead` | Find orphaned components — unused packages, models, queues, infra |
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

`hooks/hooks.json` is intentionally empty. NavGator should be invoked explicitly through slash commands, MCP tools, or the CLI instead of adding automatic scan reminders to every session.

### Agents (4, Claude only)

**`architecture-advisor`** — Stack decisions, migration planning, dependency compatibility. Tools: Bash, Read, Glob, Grep, WebSearch. Uses NavGator data to produce: Current State, Impact Analysis, Recommendation, Change Sequence, Verification.

**`architecture-investigator`** — SRE-style read-only investigation across 5 phases: Overview, Identify, Trace, Rules, Synthesize. Read-only during phases 1–4. Every finding cites specific tool output. Tools: Bash, Read, Glob, Grep.

**`architecture-planner`** — Graph freshness check + MCP-tool orchestration for architecture-aware questions. Reads `index.json` + `hashes.json`, runs `navgator scan --auto` if stale so configuration changes can trigger a required full refresh, then dispatches `impact`, `trace`, `connections`, `review`, `dead`, `rules` and returns a structured report. Triggers on phrasings like "review architecture for X", "blast radius of Y", "how does A connect to B".

**`external-resolver`** — Isolated external-boundary freshness resolver for packages and services. Updates NavGator's cache and returns structured drift evidence without mutating the architecture graph directly.

---

## Storage Model (Three-Tier Context)

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
- **MCP tools are the preferred interface for agents** — use `scan`, `explore`, `trace`, `impact`, `rules` rather than reading JSON files directly.
- **Storage path is `.navgator/`**, not `.claude/`. Migration logic exists for legacy paths.
- **`--agent` flag** wraps any command output in a stable JSON envelope for machine consumption.
- **Node.js >= 20.11.0 required.** This is the tested compatibility floor and satisfies the packaged Next.js dashboard's Node 20.9+ requirement. TypeScript compiles to ES2022 with NodeNext module resolution.
- **`ts-morph` is an optional dependency** — scanner functionality degrades gracefully without it.
