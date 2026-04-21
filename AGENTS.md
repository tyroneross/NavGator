# AGENTS.md — NavGator

Universal AI agent guidance for Claude Code, Codex, Cursor, Copilot, Gemini CLI, and any other AI coding agent working in this repository.

---

## What This Project Is

NavGator (`@tyroneross/navgator`) is an architecture tracking plugin for Claude Code and Codex. It maps dependencies, analyzes impact, and visualizes your stack before you make changes. It ships as an npm package plus explicit host surfaces for Claude and Codex.

- **npm package:** `@tyroneross/navgator` (v0.6.1)
- **Plugin name:** `navgator`
- **Runtime:** Node.js >= 20.0.0, TypeScript (ES2022, NodeNext modules)
- **License:** MIT

---

## Repository Layout

```
NavGator/
├── src/                        # TypeScript source
│   ├── scanner.ts              # Top-level scan orchestrator
│   ├── scanners/               # Detection modules
│   │   ├── packages/           # npm/pip/cargo/etc. package detection
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
│   └── infrastructure-scanning.md  # Infrastructure detection skill
├── commands/                   # 9 slash command definitions
│   ├── dead.md, impact.md, llm-map.md, map.md, review.md
│   ├── scan.md, schema.md, test.md, trace.md
├── hooks/
│   └── hooks.json              # Hook definitions (4 hook types)
├── agents/
│   ├── architecture-advisor.md     # Stack decisions + migration planning
│   └── architecture-investigator.md  # SRE-style read-only investigation
├── .claude-plugin/
│   └── plugin.json             # Claude plugin manifest (name: navgator)
├── .codex-plugin/
│   └── plugin.json             # Codex plugin manifest (name: navgator)
├── .agents/plugins/
│   └── marketplace.json        # Repo-local Codex marketplace metadata
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

Claude surface (`.claude-plugin/plugin.json`) points to:
- Hooks: `./hooks/hooks.json`
- Skills: `./skills/`
- Commands: `./commands/`
- MCP servers: `./.mcp.json`

Codex surface (`.codex-plugin/plugin.json`) points to:
- Skills: `./skills/`
- MCP servers: `./.mcp.json`
- Interface metadata for Codex UI

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

### Slash Commands (10)

`/navgator:dead`, `/navgator:impact`, `/navgator:llm-map`, `/navgator:map`, `/navgator:review`, `/navgator:scan`, `/navgator:schema`, `/navgator:test`, `/navgator:trace`

### Skills (6)

`architecture-scan`, `architecture-export`, `navgator-setup`, `impact-analysis`, `code-review`, `infrastructure-scanning`

Skills have different auto-trigger patterns — check each `SKILL.md` before modifying trigger conditions.

### Hooks (4 types)

Defined in `hooks/hooks.json`:

| Hook | Trigger | What it does |
|------|---------|-------------|
| `SessionStart` | Session begins | Checks if architecture data exists and is fresh; runs `status` if so |
| `PreToolUse` | Before `Edit` or `Write` | Runs `explore` on architecture-critical files before edits |
| `PostToolUse` (Bash) | After Bash tool | Triggers `scan` after package installs or DB migrations |
| `PostToolUse` (Write/Edit) | After 3+ file edits or API/schema changes | Triggers `scan` to update architecture tracking |
| `Stop` | Session ends | Prompts `scan` if significant architectural changes were made |

### Agents (2)

**`architecture-advisor`** — Stack decisions, migration planning, dependency compatibility. Tools: Bash, Read, Glob, Grep, WebSearch. Uses NavGator data to produce: Current State, Impact Analysis, Recommendation, Change Sequence, Verification.

**`architecture-investigator`** — SRE-style read-only investigation across 5 phases: Overview, Identify, Trace, Rules, Synthesize. Read-only during phases 1–4. Every finding cites specific tool output. Tools: Bash, Read, Glob, Grep.

---

## Storage Model (Three-Tier Context)

Architecture data lives in `<project-root>/.navgator/architecture/`.

| Tier | Files | When to read |
|------|-------|-------------|
| Tier 1 — Hot | `NAVSUMMARY.md` (max ~150 lines) | Always first. Concise overview, AI routing table, delta |
| Tier 2 — Index | `index.json`, `graph.json`, `file_map.json`, `prompts.json` | Programmatic lookups, impact traversal |
| Tier 3 — Detail | `components/COMP_*.json`, `connections/CONN_*.json` | On-demand drill-down for a specific component or connection |

All JSON files include `schema_version: "1.0.0"`. Agent-mode output (`--agent` flag) wraps responses in a stable envelope with `command`, `data`, `schema_version`, and `timestamp`.

### Full Storage Structure

```
.navgator/architecture/
├── NAVSUMMARY.md          # Hot context — read first
├── NAVSUMMARY_FULL.md     # Full version if NAVSUMMARY was compressed
├── index.json             # Component counts, types, layers, stats
├── graph.json             # Full connection graph
├── file_map.json          # file path → component ID (O(1) lookup)
├── prompts.json           # LLM prompt content + provider associations
├── hashes.json            # File change detection
├── timeline.json          # Change history (diffs between scans)
├── components/            # COMP_*.json — one per component
└── connections/           # CONN_*.json — one per connection
```

Lessons accumulate in `.navgator/lessons/lessons.json`.

---

## What NavGator Detects

The scanner (`src/scanner.ts` + `src/scanners/`) detects:

- **Packages:** npm, pip, cargo, go modules — dependency trees and version info
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
| Hooks | `hooks/hooks.json` | 4 hook types; changes affect all plugin consumers |
| Rule checks | `src/rules.ts` | Orphan, cycle, layer violation, hotspot detection |

---

## Key Constraints

- **NAVSUMMARY.md must stay under ~150 lines.** It is hot context — read at session start. Bloating it defeats the tier model.
- **MCP tools are the preferred interface for agents** — use `scan`, `explore`, `trace`, `impact`, `rules` rather than reading JSON files directly.
- **Storage path is `.navgator/`**, not `.claude/`. Migration logic exists for legacy paths.
- **`--agent` flag** wraps any command output in a stable JSON envelope for machine consumption.
- **Node.js >= 20.0.0 required.** TypeScript compiles to ES2022 with NodeNext module resolution.
- **`ts-morph` is an optional dependency** — scanner functionality degrades gracefully without it.
