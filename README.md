# NavGator

**Architecture Connection Tracker for Claude Code and Codex**

> Know your stack before you change it

NavGator tracks architecture connections across your entire stack—packages, services, databases, queues, and infrastructure—so your coding agent knows what else needs to change when you modify one part of the system.

## Features

- **Component Detection**: Packages (npm, pip, SPM, Cargo), frameworks, databases, queues, infrastructure
- **Source-Level Code Navigation**: Swift (types, protocol conformance, state/actor isolation, SwiftUI navigation) and Rust (modules, structs/enums/traits, trait impls, `use` graph, LLM calls) — mapped straight from source
- **Connection Mapping**: API → Database, Frontend → API, Queue → Handler, Service calls
- **Impact Analysis**: "What's affected if I change X?"
- **Change Detection**: SHA-256 file hashing tracks what changed since last scan
- **Mermaid Diagrams**: Visual architecture diagrams
- **Claude Code Integration**: 13 slash commands, 4 subagents, 6 skills, and the `navgator` CLI as the default agent surface
- **Codex Integration**: the same 6 skills, driving the `navgator` CLI, through a Codex-specific manifest

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

## Migrating off the MCP tools

Every MCP tool has a direct CLI replacement. `review` and `explore` are new in
this change; every other row already existed.

| MCP tool | CLI replacement |
|---|---|
| `scan` | `navgator scan --agent` (add `--quick` for the fast path) |
| `status` | `navgator status --agent` |
| `impact` | `navgator impact <component> --agent` |
| `connections` | `navgator connections <component> --agent` |
| `diagram` | `navgator diagram` (emits Mermaid text; no `--agent` envelope) |
| `trace` | `navgator trace <component> --agent` |
| `summary` | `navgator summary --agent` |
| `rules` | `navgator rules --agent` |
| `portfolio` | `navgator portfolio [dir] --agent` |
| `arch_diff` | `navgator arch-diff --agent` |
| `review` | `navgator review [--component <c>] --agent` |
| `explore` | `navgator explore <component> [--depth N] --agent` |

## Installation

### As a CLI Tool

Requires Node.js 20.19 or newer.

```bash
# Install globally
npm install -g @tyroneross/navgator

# Or use with npx
npx @tyroneross/navgator scan
```

### As a Claude Code Plugin

After installing the CLI package globally, materialize the package, register its local marketplace, and install it through the Claude Code plugin registry. The absolute package lookup makes these commands work outside the NavGator repository:

```bash
NAVGATOR_PACKAGE="$(npm root -g)/@tyroneross/navgator"

# Install for all projects (user scope)
bash "$NAVGATOR_PACKAGE/scripts/install-plugin.sh" --global

# Install for current project only
bash "$NAVGATOR_PACKAGE/scripts/install-plugin.sh" --project
```

The installer embeds production dependencies before Claude copies the plugin into its cache, then verifies `claude plugin list --json` reports `navgator@navgator` installed and enabled at the requested scope. It is safe to run again when updating. Start a new Claude Code session after installing. Claude loads 13 `/navgator:*` commands, 4 subagents, 6 skills, and the `navgator` CLI. MCP is off by default; re-run with `--with-mcp` only if your client cannot run a shell.

If the older `navgator@rosslabs-ai-toolkit` registry entry is still enabled, the installer stops before claiming success and prints the exact scoped `claude plugin disable` command. Disable the legacy entry and rerun so only one NavGator surface is active.

### As a Codex Plugin

After installing the CLI package globally, materialize the package and register a non-empty local marketplace source. The absolute package lookup makes these commands work outside the NavGator repository:

```bash
NAVGATOR_PACKAGE="$(npm root -g)/@tyroneross/navgator"

# Register in your personal marketplace
bash "$NAVGATOR_PACKAGE/scripts/install-codex-plugin.sh" --user

# Or register in the current workspace marketplace
bash "$NAVGATOR_PACKAGE/scripts/install-codex-plugin.sh" --workspace
```

The script installs the package plus runtime dependencies below the selected marketplace root and writes an idempotent `navgator` entry to `.agents/plugins/marketplace.json`. By default no MCP server is registered — the 6 skills drive the `navgator` CLI directly. Pass `--with-mcp` to also install the opt-in manifest at `mcp-optin/codex.mcp.json`, retargeted to Codex's deterministic versioned plugin cache with no fixed `cwd`. Registration is not installation or enablement. After it finishes:

1. Open the Codex plugin browser.
2. Install and enable `navgator`.
3. Disable the legacy `gator` plugin if it is present.
4. Start a new task so the plugin capabilities are loaded.

Codex reads these package surfaces:

- `.codex-plugin/plugin.json`
- `skills/*/SKILL.md`
- `mcp-optin/codex.mcp.json` (only when installed with `--with-mcp`)

Claude remains the authoritative host for slash commands and subagent wiring. Codex does not load `commands/` or `agents/`; it loads the 6 shared skills, which drive the `navgator` CLI. MCP is off by default; opt in with `--with-mcp` only if your client cannot run a shell. Hooks are disabled by default on both hosts. A source checkout is not a valid self-referential Codex marketplace until the installer materializes the package at a non-empty child path.

## Quick Start

### 1. Set Up NavGator

```bash
navgator setup
```

This runs the initial scan and then you can install the Claude or Codex surface explicitly from the scripts above.

### 2. Scan Your Project

```bash
# Automatic scan (full or incremental based on what changed)
navgator scan

# Quick scan (packages only, faster)
navgator scan --quick

# With AI prompt detection
navgator scan --prompts --verbose

# Markdown/content graph: wikilinks, internal links, typed relationships
navgator scan --full --content

# With infrastructure analysis
navgator scan --field-usage --typespec
```

### 3. Check Status

```bash
navgator status
```

Output:
```
NavGator - Architecture Status

========================================
Last scan: 1/26/2026, 12:44:09 PM (0h ago)
Total components: 15
Total connections: 23

COMPONENTS BY TYPE:
  npm: 8
  service: 4
  database: 2
  infra: 1

CONNECTIONS BY TYPE:
  service-call: 12
  api-calls-db: 8
  frontend-calls-api: 3

INFRASTRUCTURE:
  DB models: 12
  Env vars: 34
  Queues: 3
  Cron jobs: 2
```

### 4. Analyze Impact

Before changing a component, see what's affected:

```bash
navgator impact "Stripe"
```

Output:
```
NavGator - Impact Analysis: Stripe

========================================
Component: Stripe
Type: service
Layer: external
Purpose: Stripe payments

INCOMING CONNECTIONS (3):
These files/components USE this component:

  src/api/payments.ts:45
    Symbol: createPaymentIntent (function)
    Code: await stripe.paymentIntents.create({...})

  src/api/subscriptions.ts:23
    Symbol: createSubscription (function)
    Code: await stripe.subscriptions.create({...})

  src/webhooks/stripe.ts:12
    Symbol: handleWebhook (function)
    Code: stripe.webhooks.constructEvent(...)

========================================
Files that may need changes if you modify Stripe:
  - src/api/payments.ts
  - src/api/subscriptions.ts
  - src/webhooks/stripe.ts
```

### 5. View Connections

```bash
# All connections for a component
navgator connections "BullMQ"

# Only incoming connections
navgator connections "users" --incoming

# Only outgoing connections
navgator connections "users" --outgoing
```

### 6. Generate Diagrams

```bash
# Full architecture diagram
navgator diagram

# Summary (top connected components only)
navgator diagram --summary

# Focus on specific component
navgator diagram --focus "Stripe"

# Specific layer
navgator diagram --layer backend

# Save to file
navgator diagram --output architecture.md --markdown
```

## Claude Code Slash Commands

When installed as a Claude Code plugin, all commands are available as `/navgator:*` slash commands:

| Command | Description |
|---------|-------------|
| `/navgator:gator [intent]` | Route a free-form architecture request to the most specific NavGator command or skill |
| `/navgator:map` | Map full architecture — components, connections, runtime topology, and LLM use cases |
| `/navgator:plan "<intent>"` | Plan an architecture change or investigation. Delegates to the `architecture-planner` agent, which checks graph freshness, runs an auto-mode scan if stale, then dispatches the right read-only NavGator tools and aggregates findings |
| `/navgator:scan` | Quick scan — refresh tracking data |
| `/navgator:trace <component>` | Trace data flow through the system |
| `/navgator:impact <component>` | Analyze what's affected by a change |
| `/navgator:test [instructions]` | Run an end-to-end architecture test |
| `/navgator:review` | Architectural integrity review (connections, flow, drift, lessons) |
| `/navgator:review --all` | Review entire architecture, not just changes |
| `/navgator:review --validate` | Validate lessons against current docs (internet research) |
| `/navgator:review learn "..."` | Record a manual architectural lesson |
| `/navgator:llm-map` | Map LLM use cases by purpose and provider |
| `/navgator:schema [model]` | Show database readers and writers |
| `/navgator:dead` | Find orphaned components and dead code |
| `/navgator:lessons` | Manage project and global architecture lessons |
| `/navgator:promote-lesson` | Find recurring cross-project lesson patterns for promotion |

### Hooks

NavGator does not enable automatic Claude Code hooks by default. Run `/navgator:scan` or `navgator scan --agent` explicitly when architecture data needs to be refreshed.

## CLI Reference

### `navgator scan`

Scan project and update architecture tracking.

| Option | Description |
|--------|-------------|
| `-q, --quick` | Packages only, skip code analysis |
| `-c, --connections` | Focus on connection detection |
| `-p, --prompts` | Enhanced AI prompt scanning with full content |
| `--content` | Add Markdown documents plus wikilink, internal Markdown-link, and typed-frontmatter edges |
| `-v, --verbose` | Detailed output |
| `--auto` | Auto-pick scan mode (default — see Scan modes below) |
| `--full` | Force a full scan (clear all and rebuild) |
| `--incremental` | Force an incremental scan (walk only changed files + reverse-deps) |
| `--clear` | Alias for `--full` (legacy) |
| `--ast` | Use AST-based scanning (requires `ts-morph`) |
| `--field-usage` | Analyze Prisma model field usage across codebase |
| `--typespec` | Validate Prisma types against TypeScript interfaces |
| `--track-branch` | Capture git branch/commit in scan output |
| `--commit` | Auto-commit scan output to the nested `.navgator/.git` for temporal queries (~180ms overhead) |
| `--scip` | Run the SCIP indexer for compiler-accurate cross-file edges (requires `tsconfig`; ~500ms cold) |
| `--single-stack` | Disable multi-stack auto-discovery — scan only the project root |
| `--per-entity-files` | Also write one JSON per component and per connection alongside the canonical `*.full.jsonl` records |
| `--json` | Output scan results as JSON |
| `--agent` | Wrap output in agent envelope (implies `--json`) |

Content scanning is opt-in because a knowledge vault can contain far more documents than a codebase contains modules. Use `.navgatorignore` to exclude immutable raw archives, generated outputs, and other content that should not enter the live dependency graph. `NAVGATOR_CONTENT=1` enables the same scanner for programmatic calls.

#### Restricted environments and degraded scans

`--sandbox` is a global flag: pass it before the subcommand (`navgator --sandbox scan`). It sets `NAVGATOR_SANDBOX=1`, which declares the environment as restricting network access, interactive prompts, and child processes. NavGator also auto-detects a restricted environment from `CODEX=1` (adds a read-only filesystem) and `CI=true`.

Restrictions disable one capability: the SCIP overlay, which shells out to a child process. AST scanning (`--ast`) and prompt analysis (`--prompts`) run in-process and keep running, and a restriction never forces `--quick`. A read-only filesystem is recorded for visibility and disables nothing, because analysis performs no writes.

Any scan that actually lost a capability reports it. Human output prints a banner before the component counts:

```
!! DEGRADED SCAN !!
Scan ran without the SCIP overlay because the environment restricts child processes (noChildProcess).
Restrictions: noChildProcess, readOnlyFs
Disabled: scip
```

`--json` and `--agent` output carry the same facts in a `degraded` field:

```json
{
  "degraded": {
    "restrictions": ["noChildProcess", "readOnlyFs"],
    "disabled_capabilities": ["scip"],
    "message": "Scan ran without the SCIP overlay because the environment restricts child processes (noChildProcess)."
  }
}
```

A complete scan omits `degraded` entirely and prints no banner, so its absence means every capability ran.

#### Scan modes

NavGator supports three scan modes. By default (`--auto`), the scanner picks one based on what changed since the last scan and how stale the cached graph is.

| Mode | When it runs | Behavior |
|------|--------------|----------|
| `full` | first scan, or any of: `--full`/`--clear`, manifest or build-config changed (e.g. `package.json`, `prisma/schema.prisma`, `tsconfig.json`, `vercel.json`, `fly.toml`, `railway.json`, `.gitignore`), a new source file was added, `last_full_scan > 7 days ago`, or `incrementals_since_full ≥ 20` | Clears `.navgator/architecture/` and rebuilds the entire graph |
| `incremental` | a code file changed and none of the full-scan triggers fire | Walks only changed files plus their reverse-dependencies, merges results into the existing graph by stable_id, runs an integrity check |
| `noop` | nothing changed since the last scan | Updates `last_scan`, writes a `noop` timeline entry, leaves the graph untouched |

If an incremental scan fails its integrity check, NavGator automatically promotes it to a full scan and records `scan_type: 'incremental→full'` in the timeline. Each architecture file is replaced atomically, but a scan is not yet a whole-generation transaction; interrupted scans can require a subsequent full refresh.

The mode used for any given scan appears in `.navgator/architecture/timeline.json` under `scan_type`.

#### Audit (Run 2 — SQC self-measurement)

After every scan, NavGator runs a statistical-quality-control audit on its own output. The audit samples a fraction of the just-stored components and connections, runs five deterministic verifiers, optionally requests an LLM-judge spot-check, and tracks defect-rate drift across runs via an EWMA control chart. **Audit failures never fail the scan** — they only update per-stratum EWMA state. The next scan auto-promotes to a tighter inspection if any stratum breaches its control limits.

| Plan | When picked | What it does |
|------|-------------|--------------|
| `AQL` (default) | first three audits, or via `--audit-plan=aql` | MIL-STD-105E single-sampling table at AQL=2.5%. Sample size scales with population (e.g. n=80 c=5 for ~1k facts). |
| `SPRT` | history ≥ 3 audits | Wald 1945 sequential probability ratio test with α=β=0.05, p₀=1%, p₁=5%. Continues sampling until logLR escapes the bounds A=19 / B=0.0526. |
| `Cochran` | prior run breached EWMA, or `--audit-plan=cochran` | Cochran's formula with FPC at 95% CI, ±5% margin. Tightest inspection. |

Six defect classes:

| Class | Verifier | LLM? |
|-------|----------|------|
| HALLUCINATED_COMPONENT | filesystem + symbol existence on `source.config_files` | no |
| HALLUCINATED_EDGE | both endpoint component_ids resolve in graph | no |
| WRONG_ENDPOINT | grep target name/symbol in connection's source file | no |
| STALE_REFERENCE | re-hash file vs `hashes.json` | no |
| DEDUP_COLLISION | scan all components for duplicate `(type, name, primary-config)` triples (regression check on Run 1.7 fix) | no |
| MISSED_EDGE | "list all outgoing edges, set-diff against graph" — emits a structured payload an MCP-side LLM judge can consume | yes (CLI-mode skips) |

In CLI mode the LLM-judge verifier is skipped and `audit.llm_skipped: true` is set. In MCP mode the audit emits a structured payload (`audit.defect_evidence` carries up to 20 sample failures) for the running model.

Per-stratum strata: `package`, `infra`, `connection-imports`, `connection-services`, `connection-llm`, `connection-prisma`, `__other`. Stratified sample selection uses Neyman optimal allocation (more samples → higher-variance strata).

EWMA control chart (Hawkins-Wu defaults λ=0.2, L=2.7) tracks defect-rate drift per stratum across runs. On breach, `pending_drift_breach` is set on the index, and the next `--auto` scan promotes to `mode='full' + audit-plan='cochran'`.

Flags:

| Flag | Purpose |
|------|---------|
| `--no-audit` | Skip the audit pass entirely |
| `--audit-plan <plan>` | Override plan auto-pick: `aql` \| `sprt` \| `cochran` |

Audit output appears on the timeline entry under `audit`:

```json
{
  "plan": "AQL",
  "n": 80, "c": 5, "sampled": 156, "defects": 0,
  "defect_rate": 0,
  "by_class": { "HALLUCINATED_COMPONENT": { "sampled": 40, "defects": 0 }, ... },
  "by_stratum": { "package": { "sampled": 18, "defects": 0, "defect_rate": 0 }, ... },
  "verdict": "accept",
  "llm_skipped": true
}
```

### `navgator status`

Show architecture summary.

| Option | Description |
|--------|-------------|
| `--no-refresh` | Skip the auto-refresh incremental scan that runs when the on-disk graph is older than 5 minutes |
| `--json` | Output as JSON |
| `--agent` | Wrap output in agent envelope (implies `--json`) |

### `navgator impact <component>`

Show what's affected by changing a component.

| Option | Description |
|--------|-------------|
| `--json` | Output as JSON |
| `--agent` | Wrap output in agent envelope (implies `--json`) |

### `navgator connections <component>`

Show all connections for a component.

| Option | Description |
|--------|-------------|
| `--incoming` | Only incoming connections |
| `--outgoing` | Only outgoing connections |
| `--production` | Only production connections |
| `--test` | Only test connections |
| `--json` | Output as JSON |
| `--agent` | Wrap output in agent envelope (implies `--json`) |

### `navgator explore <component>`

Investigate one component: connections, runtime identity, impact severity, data-flow paths, and layer position in a single report.

| Option | Description |
|--------|-------------|
| `--depth <n>` | Max data-flow trace depth (default: 2) |
| `--json` | Output as JSON |
| `--agent` | Wrap output in agent envelope (implies `--json`) |

### `navgator list`

List all tracked components.

| Option | Description |
|--------|-------------|
| `-t, --type <type>` | Filter by type (npm, service, database, etc.) |
| `-l, --layer <layer>` | Filter by layer (frontend, backend, etc.) |
| `--json` | Output as JSON |

### `navgator diagram`

Generate Mermaid architecture diagram.

| Option | Description |
|--------|-------------|
| `-f, --focus <component>` | Center on specific component |
| `-l, --layer <layer>` | Show specific layer only |
| `-s, --summary` | Top connected components only |
| `-d, --direction <dir>` | TB, BT, LR, or RL (default: TB) |
| `--no-styles` | Disable color styling |
| `--no-labels` | Hide connection labels |
| `-o, --output <file>` | Save to file |
| `-m, --max-nodes <n>` | Max nodes to show (default: 50) |
| `--markdown` | Wrap in markdown code block |

### `navgator prompts`

Scan and analyze AI prompts in the codebase.

| Option | Description |
|--------|-------------|
| `-v, --verbose` | Show full prompt content |
| `--json` | Output as JSON |
| `--detail <name>` | Show detailed view of specific prompt |

### `navgator coverage`

Analyze database field usage and type alignment.

```bash
# Field usage analysis (requires Prisma schema)
navgator coverage --fields

# TypeSpec validation (Prisma vs TypeScript types)
navgator coverage --typespec
```

| Option | Description |
|--------|-------------|
| `--fields` | Report unused, read-only, and write-only Prisma model fields |
| `--typespec` | Compare Prisma model types against TypeScript interface definitions |
| `--json` | Output as JSON |

### `navgator trace <component>`

Trace dataflow paths forward and backward through the system.

| Option | Description |
|--------|-------------|
| `--direction <dir>` | forward, backward, or both (default: both) |
| `--depth <n>` | Max trace depth (default: 5) |
| `--max-paths <n>` | Max paths to show (default: 10) |
| `--all` | Show all paths (overrides `--max-paths`) |
| `--production` | Only production paths |
| `--classification <class>` | Filter by semantic classification |
| `--json` | Output as JSON |
| `--agent` | Wrap output in agent envelope (implies `--json`) |

### `navgator rules`

Check architecture rules and report violations.

| Option | Description |
|--------|-------------|
| `--severity <level>` | Filter by severity: `error`, `warning`, `info` |
| `--json` | Output as JSON |
| `--agent` | Wrap output in agent envelope (implies `--json`) |

Built-in rules: orphan components, database isolation, frontend-direct-db, circular dependencies, hotspot modules, high fan-out, layer violations.

### `navgator review`

Architectural integrity review: rule violations, runtime topology, and LLM use cases in one report.

| Option | Description |
|--------|-------------|
| `--component <name>` | Focus the review on one component's impact |
| `--json` | Output as JSON |
| `--agent` | Wrap output in agent envelope (implies `--json`) |

### `navgator subgraph`

Extract a focused subgraph. The command takes no positional argument — name components with `--focus`.

```bash
navgator subgraph --focus AuthService
navgator subgraph --focus AuthService,BillingQueue --depth 3 --format mermaid
```

| Option | Description |
|--------|-------------|
| `--focus <components>` | Comma-separated component names to focus on |
| `--layer <layers>` | Comma-separated layers to include |
| `--classification <class>` | Filter connections by semantic classification |
| `--depth <n>` | BFS depth from focus components (default: 2) |
| `--max-nodes <n>` | Max nodes in subgraph (default: 50) |
| `--format <fmt>` | `json` or `mermaid` (default: json) |
| `--json` | Output as JSON (same as `--format json`) |
| `--agent` | Output wrapped in agent envelope (implies `--json`) |

### `navgator portfolio [dir]`

Scan a folder of repos and build a cross-repo map of shared dependencies and heuristic service calls. With no `dir`, reports status over already-registered projects without scanning anything.

| Option | Description |
|--------|-------------|
| `--depth <n>` | Directory depth to search for repos (default: 1, max: 3) |
| `--concurrency <n>` | Concurrent repo scans (default: 1, max: 4) |
| `--json` | Output as JSON |
| `--agent` | Output wrapped in agent envelope (implies `--json`) |

Cross-repo service-call edges are heuristic (host-match or service-name-match) — never a verified call graph, and always labeled as such.

### `navgator scan-remote <url>`

Shallow-clone a GitHub repo by URL into `~/.navgator/cache/remote` and run the architecture scan against it. CLI-only by design: an MCP-invokable version would put a network fetch (`git clone`) on a prompt-injection-reachable path, so this stays human-initiated (see [AGENTS.md](AGENTS.md)).

| Option | Description |
|--------|-------------|
| `--ref <ref>` | Branch, tag, or commit-ish to check out (overrides a `/tree/<ref>` in the URL) |
| `--refresh` | Force a clean re-clone instead of a shallow fetch + reset of the cached checkout |
| `--json` | Output as JSON |
| `--agent` | Output wrapped in agent envelope (implies `--json`) |

### `navgator arch-diff`

Pre-merge architecture diff: shows how the current branch's architecture differs from the canonical (default-branch) baseline, or a named `--base` ref, before merging.

| Option | Description |
|--------|-------------|
| `--base <ref>` | Diff against this ref's recorded snapshot instead of the canonical baseline |
| `--record` | Also write the current ref's snapshot before diffing |
| `--json` | Output as JSON |
| `--agent` | Output wrapped in agent envelope (implies `--json`) |

### `navgator registry-log`

The project registry (`~/.navgator/projects.json`) has readers and writers living in two separate processes — the CLI/MCP process and the dashboard — so a lost update in one is invisible to the other. This command shows the append-only journal of every read and write of that registry, including any detected lost-update conflicts. Records carry a content digest and an entry-count delta rather than the registry payload itself, and the journal file rotates by size, so it can't grow unbounded.

| Option | Description |
|--------|-------------|
| `--limit <n>` | Most recent N entries (default: 50) |
| `--actor <actor>` | Filter to `cli`, `mcp`, or `web-route` |
| `--op <op>` | Filter to `load`, `save`, `register`, `update`, `remove`, or `conflict` |
| `--conflicts` | Only lost-update conflict records |
| `--json` | Output as JSON |
| `--agent` | Output wrapped in agent envelope (implies `--json`) |

### `navgator deep-map`

Maps a repository in tiers, escalating only where the graph says it is worth it.

The scanner answers *what exists*. It cannot tell you what a component is for,
whether a design is inefficient, or where the risky coupling sits — those need a
model. NavGator does not ship one, and does not want one: there is no LLM SDK in
the dependency tree, and the engine stays offline and reproducible.

So `deep-map` splits the work. **NavGator emits work packets; your coding agent
runs the models.** Each packet carries one isolated group of components, its
induced subgraph, a ready-to-send prompt, and a response schema. Your agent fans
out subagents over them in parallel; NavGator validates, attributes, and reports
what comes back.

```bash
navgator scan --agent                            # tier 0 — the source of truth
navgator deep-map plan --tier 1 --agent          # emit packets; note the run_id it prints
#   ... your agent dispatches one subagent per packet, in parallel,
#   ... writing each result to packets/<packet_id>.result.json
navgator deep-map ingest --run $RUN --agent      # validate + attribute
navgator deep-map plan --tier 2 --run $RUN --agent   # deep pass on escalated components
navgator deep-map plan --tier 3 --run $RUN --agent   # one synthesis pass over the whole run
navgator deep-map report --run $RUN --agent      # findings + what the run cost
navgator deep-map status --run $RUN --agent      # which packets came back
```

| Tier | Pass | Cap |
|---|---|---|
| 0 | The existing scan | free, offline |
| 1 | Wide and shallow — one cheap agent per component group | `--max-packets`, default 12 |
| 2 | Deep — only components the graph escalates | `--max-deep`, default 4, opt-in |
| 3 | One synthesis pass over everything ingested | one packet, opt-in |

**Findings can never change what the scan found.** They live in
`.navgator/deep-map/`, carry their tier and packet, and join to components only
at read time. A finding naming a component that does not exist is rejected and
counted; so is one whose evidence resolves to no real file. Delete
`.navgator/deep-map/` and everything else still works exactly as before.

**Escalation is computed, not guessed.** Centrality, how much a component
bridges across clusters, direction and reachability faults, and LLM-call
surface. Degree is deliberately represented once — by PageRank — and the
degree-derived rules are excluded from the violation count, so one property
cannot quietly supply most of the score. A rule that fires on more than half the
components scored is withheld too and named in the manifest, because a flag
present on most of the codebase ranks nothing. Every escalated component prints
the numbers that escalated it, so you can disagree on evidence.

**Cost is capped and reported.** Tier 1 only by default; tiers 2 and 3 must be
asked for. The manifest carries estimated input tokens per packet, and the
report carries measured output bytes and rejection counts.

| Option | Description |
|--------|-------------|
| `--tier <n>` | `1`, `2`, or `3` (repeatable or comma-separated). Default `1` |
| `--max-packets <n>` | Tier-1 packet cap (default 12) |
| `--max-deep <n>` | Tier-2 packet cap (default 4) |
| `--min-group <n>` | Smallest community that earns its own packet (default 3) |
| `--max-nodes <n>` | Components per packet before splitting (default 60) |
| `--escalate-threshold <n>` | Score floor for tier 2 (default 0.4) |
| `--exclude <glob>` | Exclude paths from mapping (repeatable) |
| `--include-vendored` | Keep `node_modules`-style directories in scope |
| `--run <id>` | Continue an existing run instead of starting a new one. Pass it on every step after the first `plan`, so all three tiers land in one run |
| `--json` / `--agent` | Machine-readable output |

**On vendored code.** Each packet reports the longest common path prefix of its
components. NavGator excludes the unambiguous vendor directories by default, but
no path heuristic separates a copied package from hand-written code reliably —
a monorepo's own `packages/` looks identical from the outside. So it reports the
evidence and leaves the call to you. If a packet's prefix reads
`web/runtime/packages/semver`, re-plan with `--exclude 'web/runtime/**'` rather
than paying an agent to describe someone else's package.

### `navgator doctor`

Reports the health of your registry and gator-memory store, and offers a
guided cleanup of accumulated temp fixtures.

```bash
navgator doctor                        # Read-only report
navgator doctor --json                 # Machine-readable (same data the dashboard uses)
navgator doctor --fix                  # Guided cleanup, with confirmation
navgator doctor --fix --yes            # Skip the prompt (for scripts)
navgator doctor --fix --include-missing # Also remove non-temp paths that are gone
navgator doctor --mirror               # Export to build-loop-memory, if enabled
```

The report covers registered entries, how many point at temp directories or
paths that no longer exist, registration growth, lock conflicts and degraded
writes, gator-memory status, and mirror status.

**Growth is only estimated when there is enough history to support it.** The
journal rotates, so on a fresh install the retained window is short — the
report gives raw counts and says so rather than extrapolating a large,
meaningless daily rate.

**`--fix` is deliberately conservative.** By default it removes only entries
that are *both* under a temp root *and* no longer on disk — the accumulated
test fixtures, never your work. Before anything is deleted it prints the exact
entries, asks for confirmation, and writes a verified
`projects.json.backup-<timestamp>`. It aborts rather than assuming consent if
stdin isn't a terminal and `--yes` wasn't passed. Removals go through the same
locked, journaled write path as every other registry mutation.

A project on an unmounted volume is missing but real, so removing non-temp
missing paths requires the explicit `--include-missing`.

## What Gets Detected

### Components

| Type | Examples |
|------|----------|
| **Packages** | npm, pip, SPM, Cargo |
| **Frameworks** | Next.js, React, Django, FastAPI, Express |
| **Databases** | PostgreSQL, MongoDB, Redis, Supabase, Prisma |
| **Queues** | BullMQ, Celery, SQS, RabbitMQ |
| **Infrastructure** | Railway, Vercel, Docker, Kubernetes, GitHub Actions |
| **Services** | Stripe, OpenAI, Anthropic, Twilio, SendGrid, AWS S3 |
| **AI Prompts** | Claude/OpenAI prompts with full content, variables, purpose |

### Connections

| Type | Description |
|------|-------------|
| `service-call` | Code → External service (Stripe, OpenAI, etc.) |
| `api-calls-db` | API endpoint → Database table |
| `frontend-calls-api` | Frontend component → API endpoint |
| `queue-triggers` | Queue job → Handler function |
| `prompt-location` | AI prompt definition location |
| `prompt-usage` | Code that uses an AI prompt |
| `env-dependency` | Component → environment variable it depends on |
| `schema-relation` | Database model → related model (FK/relation) |
| `cron-triggers` | Cron job → API route handler |
| `queue-produces` | Producer → queue |
| `queue-consumes` | Queue → consumer worker |
| `field-reference` | Database model field → file that references it |
| `runtime-binding` | Component → its runtime service/resource |
| `queue-uses-cache` | Queue system → Redis/cache instance |
| `conforms-to` | Type → protocol/trait it implements (Swift `: Protocol`, Rust `impl Trait for Type`) |
| `imports` | File → module/file it imports (incl. Rust `use crate::…`) |
| `uses-package` | Code → external package/crate (incl. Rust `use <crate>`) |

### Source-Level Code Navigation

Beyond packages and infrastructure, NavGator scans source directly for two compiled-language stacks. Both run automatically during `navgator scan` when the project is detected (`Package.swift` → Swift, `Cargo.toml` → Rust) and feed the same component/connection graph, so `trace`, `impact`, and `diagram` work on them.

| Language | Detected | Produces |
|----------|----------|----------|
| **Swift** (`.swift`) | `Package.swift` / Xcode project | Types, protocol conformance (`conforms-to`), `@Published`/`@Observable` state (`observes`), actor isolation, UserDefaults/Keychain keys (`stores`), SwiftUI navigation, LLM calls, entitlement requirements |
| **Rust** (`.rs`) | `Cargo.toml` / `Cargo.lock` | Modules, structs/enums/traits, trait impls (`conforms-to`), internal `use` graph (`imports`), external crate use (`uses-package`), LLM API calls (`service-call`) |

### Runtime Topology

NavGator annotates architecture components with runtime identity information extracted from code and config:

- **Database connections**: Parses `DATABASE_URL` and Prisma `datasource` to identify database engine (postgres, mysql, etc.), host, and port
- **Redis/cache connections**: Extracts Redis URLs from BullMQ queue configurations and env vars
- **Queue identity**: Maps queue names to their Redis backing store and producer/consumer relationships
- **Deploy services**: Extracts service names from Railway, Vercel, Heroku (Procfile), and Nixpacks configs
- **Cron handlers**: Links scheduled jobs to their handler functions and deployment platform

Use `navgator status` to see the RUNTIME TOPOLOGY section showing all detected runtime bindings.

## Storage

Data is stored in `.navgator/architecture/` within your project:

```
.navgator/architecture/
├── NAVSUMMARY.md              # Hot context (read first)
├── NAVSUMMARY_FULL.md         # Full version if compressed
├── components.full.jsonl      # Canonical complete component records
├── connections.full.jsonl     # Canonical complete connection records
├── index.json                 # Derived lookup index and counts
├── graph.json                 # Derived graph projection (lossy)
├── file_map.json              # Derived file path → component ID lookup
├── connections.jsonl          # Compact connection projection (lossy)
├── prompts.json               # AI prompt content + associations
├── hashes.json                # File hashes for change detection
├── timeline.json              # Scan history
├── reverse-deps.json          # Derived file → importers index
├── components/                # Optional per-component JSON (--per-entity-files)
└── connections/               # Optional per-connection JSON (--per-entity-files)
```

The complete record format uses schema version `1.1.0`. The two `*.full.jsonl` files are the canonical consolidated records. `graph.json`, `index.json`, `file_map.json`, and `connections.jsonl` are compact or indexed views and can omit record fields. Per-entity directories are disabled by default and duplicate the canonical records when explicitly enabled.

### gator-memory — durable history across projects

Everything above is *this* project's current architecture, and it is regenerable
by rescanning. gator-memory is the part that isn't: a durable record of which
projects exist, when they entered, and what materially changed. It lives in your
home directory, is populated automatically on every scan, and needs no setup,
no dependency, and no network.

```
~/.navgator/memory/
├── index.json            # Materialized rollup (regenerable)
├── events.jsonl          # Append-only chronology, size-rotated
├── events.1.jsonl        # Previous generation
└── projects/
    └── <slug>.json       # Durable per-project record — source of truth
```

`projects/<slug>.json` is authoritative. Each event is also folded into its
project's milestone list, so deleting `index.json` or `events.jsonl` keeps every
project's identity, counters, and most recent milestones intact. The milestone
list is capped, though — so for a project with a long history, the older
chronology lives only in `events.jsonl` until rotation drops it. The cap is what
keeps a single project's file from growing without limit.

Only meaningful events are recorded — a project entering or leaving the
registry, and scans whose architecture diff is `major` or `minor`. **A routine
rescan writes nothing.** That is what separates this from
`~/.navgator/registry-journal.jsonl`, which logs every read and write and
therefore has to rotate away its own history.

Growth is bounded in three ways: milestones are capped per project, the event
log rotates to a single previous generation, and `navgator doctor --fix` removes
records for projects that are gone. If the store is ever unwritable or corrupt,
NavGator degrades silently — a broken memory store can never fail a scan.

**Optional: mirror into build-loop-memory.** Off by default. If you keep a
`build-loop-memory` tree, enable a one-way export in `~/.navgator/config.json`:

```json
{
  "memory": {
    "mirror": { "enabled": true, "target": "~/dev/git-folder/build-loop-memory" }
  }
}
```

Each project's memory is then written to
`<target>/projects/<name-slug>/architecture/navgator-memory.{json,md}`. If the
target directory doesn't exist, nothing happens — no warning, no error.
NavGator never creates the target and never touches files it doesn't own.

Design rationale and rejected alternatives: [`docs/plans/2026-08-03-gator-memory.md`](docs/plans/2026-08-03-gator-memory.md).

## AI Prompt Tracking

NavGator includes comprehensive AI prompt detection and tracking. Use `--prompts` flag or the dedicated `prompts` command.

### What Gets Tracked

| Field | Description |
|-------|-------------|
| **Location** | File path, line numbers, containing function |
| **Content** | Full prompt content (up to 2000 chars per message) |
| **Provider** | Anthropic (Claude), OpenAI, Azure, Google |
| **Variables** | Template variables (`{var}`, `{{var}}`, `${var}`) |
| **Purpose** | Extracted from nearby comments |
| **Category** | summarization, classification, extraction, chat, etc. |
| **Usage** | Where the prompt is called (file, line, function) |

### Prompt Categories

NavGator automatically categorizes prompts:

- `chat` - Conversational prompts
- `summarization` - Content summarization
- `extraction` - Data extraction
- `classification` - Categorization tasks
- `code-generation` - Writing code
- `code-review` - Reviewing code
- `agent` - Tool/function use
- `translation` - Language translation

## AST-Based Scanning

The required graph runtime is installed with the npm package: `graphology`, `graphology-communities-louvain`, and `graphology-metrics`. Keep production dependencies when copying or materializing NavGator.

For more accurate connection detection, install `ts-morph`:

```bash
npm install ts-morph
```

Then use the `--ast` flag:

```bash
navgator scan --ast
```

AST scanning provides:
- Accurate import tracking
- Method chain following (`stripe.customers.create()`)
- Higher confidence scores

Without `ts-morph`, NavGator uses regex-based scanning which is faster but may miss some patterns.

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `NAVGATOR_MODE` | Storage mode: `local` or `shared` | `local` |
| `NAVGATOR_PATH` | Custom storage path | `.navgator/architecture` |
| `NAVGATOR_AUTO_SCAN` | Auto-scan on session start | `false` |
| `NAVGATOR_HEALTH_CHECK` | Enable health checks | `false` |
| `NAVGATOR_SCAN_DEPTH` | `shallow` or `deep` | `shallow` |
| `NAVGATOR_CONFIDENCE` | Confidence threshold (0-1) | `0.6` |
| `NAVGATOR_MAX_RESULTS` | Max results per query | `20` |
| `NAVGATOR_DASHBOARD_TOKEN` | Per-launch dashboard session token, set automatically by `navgator ui` — see [Dashboard security boundary](#dashboard-security-boundary) | unset |
| `NAVGATOR_DASHBOARD_BOOTSTRAP` | Per-launch single-use browser handoff nonce, set automatically by `navgator ui` | unset |
| `NAVGATOR_DASHBOARD_INSECURE` | Set to `1` to run the dashboard with **no** session auth (loopback check only). Required by `npm run dev:web`. | unset |

## Dashboard security boundary

### What this actually defends against

Be precise about the actor, because the honest claim is narrower than "the dashboard is protected."

**Stopped:**
- **A different local user.** The session token lives in `~/.navgator/dashboard-session.json` at mode `0600` and in the dashboard server's own environment. Another UID cannot read either, so it cannot authenticate, even though it can reach the loopback port.
- **A process filesystem-sandboxed away from `$HOME` but still granted loopback network access.** This is the common shape for a sandboxed build step or tool: it can open a socket to `127.0.0.1:3000` but cannot read `~/.navgator/`. Before the token, that was enough to read the full architecture graph and every registered project path.
- **A remote page via DNS rebinding.** `web/proxy.ts` rejects any request whose `Host` header doesn't resolve to a loopback hostname (`localhost`, `127.0.0.1`, `::1`). A page at `evil.com` that a browser resolves to `127.0.0.1` still sends `Host: evil.com`, and that is rejected.

**Not stopped:**
- **Anything running as your own UID with normal filesystem access.** A stray `npm postinstall` script, another agent, any same-uid tool can simply `cat ~/.navgator/dashboard-session.json` and then call `/api/*` with the header. The `0600` mode does not separate that attacker from you — you are the same principal to the OS. If a same-uid process is hostile, this boundary is not what saves you.
- **Anything that can read the server's environment** (`/proc/<pid>/environ` on Linux for your own processes, a core dump, a debugger).

### How the credentials work

There are **two** per-launch secrets, and the split is the point.

| Secret | Env var | Carrier | Lifetime |
|---|---|---|---|
| Session token | `NAVGATOR_DASHBOARD_TOKEN` | `~/.navgator/dashboard-session.json` (0600), URL **fragment** at handoff, `x-navgator-token` header thereafter | The server process |
| Bootstrap nonce | `NAVGATOR_DASHBOARD_BOOTSTRAP` | The browser-open URL (`?nvt=`) — the only secret in any argv | Single use, ~5 minutes |

Why two: `ps -axww -o pid,user,command` prints another user's full argv on macOS. A single-secret design put the session token in the browser-open URL, so `ps` handed a full-session credential to every account on the machine. Now the only thing `ps` can capture is a nonce that `web/proxy.ts` burns on first redemption and expires after five minutes. The worst case is a race with your own browser over a few hundred milliseconds, not a session-long credential. The browser is also launched with an argv array (`spawn(cmd, [url])`) rather than a shell string, which removes the second `/bin/sh -c` copy of the URL — hygiene on top of the control, not the control itself.

**The handoff:**
1. `navgator ui` opens `http://localhost:<port>/?nvt=<nonce>`.
2. `web/proxy.ts` validates the nonce in constant time, burns it, and 302-redirects to `/#t=<sessionToken>`. A URL **fragment** is never transmitted to any server and is stripped from `Referer` — the same carrier the OAuth implicit flow uses.
3. A client bootstrap moves the token into `sessionStorage` and immediately clears the fragment with `history.replaceState`, so it does not persist in the URL bar or session history.
4. Every subsequent `/api/*` call sends `x-navgator-token`.

**Why `sessionStorage` and not a cookie.** Cookies are keyed by host and **ignore port** (RFC 6265 §8.5). A `navgator_session` cookie on `localhost` would be sent by the browser to *every* `http://localhost:<anything>` you visit — any Vite dev server, any demo server an npm postinstall started, any other agent's UI — each of which could replay it verbatim. `httpOnly` doesn't help (it stops page JS reading the cookie, not the receiving server) and `SameSite=Strict` doesn't fire (ports are not part of a "site", so `localhost:9999` → `localhost:3000` is same-site). `sessionStorage` is keyed by scheme + host + **port**, which is the boundary that has to hold. The dashboard sets no cookie at all.

**Enforcement details:**
- The proxy matcher is **deny-by-default** (`/((?!_next/static|_next/image|favicon.ico).*)`) with a small explicit allowlist for the app shell and static assets, so a route added later is authenticated unless someone deliberately exempts it.
- A missing or wrong token gets a `401`, distinct from the `403` used for loopback/origin failures, so the two failure classes are distinguishable in logs.
- Token comparison is constant-time (length-checked first, then an XOR accumulator), so guessing can't use response timing.
- After validating, the proxy stamps `x-navgator-proxy-verified: 1` onto the forwarded request and strips any inbound copy on every path. Route guards read that stamp — not the client-supplied token header — so a garbage `x-navgator-token` can never make a request *more* privileged.
- The token is withheld from every CLI subprocess the dashboard spawns (`navgator scan` and anything it spawns in turn).
- `navgator ui` unlinks the session file on `SIGINT`/`SIGTERM`.

**Non-browser clients.** A local operator or automation that can read the 0600 session file calls the API directly with `x-navgator-token` — no browser, no bootstrap. That file is now the only way to obtain the session token, since it no longer travels through any URL.

**Degraded dev mode is explicit opt-in.** `NAVGATOR_DASHBOARD_INSECURE=1` runs the dashboard with loopback-only enforcement and prints a one-time warning; `npm run dev:web` sets it. Without it, an unset `NAVGATOR_DASHBOARD_TOKEN` **fails closed** with a `401` rather than silently degrading, and a set-but-empty token is a hard failure rather than a fallback. Degraded mode does not stamp `x-navgator-proxy-verified`, so origin-less mutations stay rejected even there. The child server's stdout and stderr are forwarded to your terminal so the warning is actually visible.

## Example Workflows

### Adding a New Integration

```bash
# 1. Check current architecture
navgator status

# 2. Install package
npm install stripe

# 3. Update architecture
navgator scan --quick

# 4. Implement integration
# ... write code ...

# 5. Full rescan to detect new connections
navgator scan
```

### Before Database Migration

```bash
# 1. Check what uses the table
navgator impact "users"

# 2. Review affected files
navgator connections "users" --incoming

# 3. Generate diagram for documentation
navgator diagram --focus "users" --output migration-plan.md --markdown

# 4. Make changes to each affected file
# 5. Rescan to verify
navgator scan
```

### Understanding a New Codebase

```bash
# 1. Full scan
navgator scan --verbose

# 2. See overall architecture
navgator diagram --summary

# 3. List all services
navgator list --type service

# 4. Understand a specific component
navgator impact "Supabase"
```

## Dependencies

**Required:**
- `commander` - CLI framework
- `glob` - File pattern matching

**Optional:**
- `ts-morph` - AST-based scanning (install separately)

## License

Apache-2.0

## Contributing

Contributions welcome! Please read the contributing guidelines first.

## Links

- [GitHub Repository](https://github.com/tyroneross/NavGator)
- [Issue Tracker](https://github.com/tyroneross/NavGator/issues)
- [Claude Code](https://claude.ai/claude-code)

## Codex

This package ships an additive Codex plugin surface alongside the Claude Code surface. Claude remains authoritative for slash commands and subagents. Hooks are disabled by default. Codex support is explicit and parallel rather than inferred from Claude configuration.

Package root for Codex installs:
- the repository root (`.`)

Primary Codex surface:
- manifest: `./.codex-plugin/plugin.json`
- skills from `./skills`, driving the `navgator` CLI
- MCP config from `mcp-optin/codex.mcp.json`, installed only with `--with-mcp`

The installer generates marketplace metadata at user or workspace scope after materializing the package and its dependencies at a non-empty local source path. The repository does not advertise itself through an invalid self-referential marketplace entry.

Recommended Codex flows:

```bash
NAVGATOR_PACKAGE="$(npm root -g)/@tyroneross/navgator"

# personal marketplace registration
bash "$NAVGATOR_PACKAGE/scripts/install-codex-plugin.sh" --user

# current-workspace marketplace registration
bash "$NAVGATOR_PACKAGE/scripts/install-codex-plugin.sh" --workspace
```

After registration, install and enable `navgator` in the Codex plugin browser, disable a legacy `gator` entry if present, and start a new task. Codex loads 6 skills, which drive the `navgator` CLI; Claude-specific slash commands and subagents remain Claude-only. MCP is off by default — re-run the installer with `--with-mcp` only if your client cannot run a shell.
