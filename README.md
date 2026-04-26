# NavGator

**Architecture Connection Tracker for Claude Code and Codex**

> Know your stack before you change it

NavGator tracks architecture connections across your entire stack—packages, services, databases, queues, and infrastructure—so your coding agent knows what else needs to change when you modify one part of the system.

## Features

- **Component Detection**: Packages (npm, pip), frameworks, databases, queues, infrastructure
- **Connection Mapping**: API → Database, Frontend → API, Queue → Handler, Service calls
- **Impact Analysis**: "What's affected if I change X?"
- **Change Detection**: SHA-256 file hashing tracks what changed since last scan
- **Mermaid Diagrams**: Visual architecture diagrams
- **Claude Code Integration**: Hooks, skills, agents, and slash commands
- **Codex Integration**: Skills, MCP tools, and native marketplace metadata

## Installation

### As a CLI Tool

```bash
# Install globally
npm install -g @tyroneross/navgator

# Or use with npx
npx @tyroneross/navgator scan
```

### As a Claude Code Plugin

Install the Claude surface directly from this repo:

```bash
# Install for all projects (user scope)
bash scripts/install-plugin.sh --global

# Install for current project only
bash scripts/install-plugin.sh --project
```

Or link manually:

```bash
ln -s $(npm root -g)/@tyroneross/navgator ~/.claude/plugins/navgator
```

Restart Claude Code after installing. All `/navgator:*` commands will be available.

### As a Codex Plugin

Install the Codex surface directly from this repo:

```bash
# Install for your Codex user account
bash scripts/install-codex-plugin.sh --user

# Or refresh repo-local workspace metadata only
bash scripts/install-codex-plugin.sh --workspace
```

This repo now includes native Codex metadata in:

- `.codex-plugin/plugin.json`
- `.agents/plugins/marketplace.json`

Claude remains the authoritative host for hooks, slash commands, and agent wiring. Codex uses the additive plugin surface for skills and MCP tools.

## Quick Start

### 1. Set Up NavGator

```bash
navgator setup
```

This runs the initial scan and then you can install the Claude or Codex surface explicitly from the scripts above.

### 2. Scan Your Project

```bash
# Full scan (packages + connections)
navgator scan

# Quick scan (packages only, faster)
navgator scan --quick

# With AI prompt detection
navgator scan --prompts --verbose

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
| `/navgator:map` | Map full architecture — components, connections, runtime topology, and LLM use cases |
| `/navgator:plan "<intent>"` | Plan an architecture change or investigation. Delegates to the `architecture-planner` agent, which checks graph freshness, runs an incremental scan if stale, then dispatches the right read-only NavGator tools and aggregates findings |
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

### Hooks

NavGator includes hooks that integrate with Claude Code:

**SessionStart**: Checks if architecture data is stale (>24h) and suggests running `/navgator:scan`.

**PreToolUse (Edit/Write)**: Before modifying architecture-critical files, reminds to check impact with `/navgator:impact`.

**PostToolUse (Bash)**: Detects package manager commands (`npm install`, `pip install`, etc.) and reminds to update architecture with `/navgator:scan`.

**Stop**: After significant changes, reminds to rescan.

## CLI Reference

### `navgator scan`

Scan project and update architecture tracking.

| Option | Description |
|--------|-------------|
| `-q, --quick` | Packages only, skip code analysis |
| `-c, --connections` | Focus on connection detection |
| `-p, --prompts` | Enhanced AI prompt scanning with full content |
| `-v, --verbose` | Detailed output |
| `--auto` | Auto-pick scan mode (default — see Scan modes below) |
| `--full` | Force a full scan (clear all and rebuild) |
| `--incremental` | Force an incremental scan (walk only changed files + reverse-deps) |
| `--clear` | Alias for `--full` (legacy) |
| `--ast` | Use AST-based scanning (requires `ts-morph`) |
| `--field-usage` | Analyze Prisma model field usage across codebase |
| `--typespec` | Validate Prisma types against TypeScript interfaces |
| `--track-branch` | Capture git branch/commit in scan output |
| `--json` | Output scan results as JSON |
| `--agent` | Wrap output in agent envelope (implies `--json`) |

#### Scan modes

NavGator supports three scan modes. By default (`--auto`), the scanner picks one based on what changed since the last scan and how stale the cached graph is.

| Mode | When it runs | Behavior |
|------|--------------|----------|
| `full` | first scan, or any of: `--full`/`--clear`, manifest or build-config changed (e.g. `package.json`, `prisma/schema.prisma`, `tsconfig.json`, `vercel.json`, `fly.toml`, `railway.json`, `.gitignore`), a new source file was added, `last_full_scan > 7 days ago`, or `incrementals_since_full ≥ 20` | Clears `.navgator/architecture/` and rebuilds the entire graph |
| `incremental` | a code file changed and none of the full-scan triggers fire | Walks only changed files plus their reverse-dependencies, merges results into the existing graph by stable_id, runs an integrity check |
| `noop` | nothing changed since the last scan | Updates `last_scan`, writes a `noop` timeline entry, leaves the graph untouched |

If an incremental scan fails its integrity check, NavGator automatically promotes it to a full scan and records `scan_type: 'incremental→full'` in the timeline. Atomic file writes ensure that a crashed scan leaves the prior `.navgator/architecture/` intact.

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
| `--json` | Output as JSON |

### `navgator impact <component>`

Show what's affected by changing a component.

| Option | Description |
|--------|-------------|
| `--json` | Output as JSON |

### `navgator connections <component>`

Show all connections for a component.

| Option | Description |
|--------|-------------|
| `--incoming` | Only incoming connections |
| `--outgoing` | Only outgoing connections |
| `--json` | Output as JSON |

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
| `--json` | Output as JSON |

### `navgator rules`

Check architecture rules and report violations.

| Option | Description |
|--------|-------------|
| `--json` | Output as JSON |

Built-in rules: orphan components, database isolation, frontend-direct-db, circular dependencies, hotspot modules, high fan-out, layer violations.

### `navgator subgraph <component>`

Extract a focused subgraph around a specific component.

| Option | Description |
|--------|-------------|
| `--depth <n>` | Include connections up to N hops away (default: 2) |
| `--json` | Output as JSON |

## What Gets Detected

### Components

| Type | Examples |
|------|----------|
| **Packages** | npm, pip, cargo, go, gem, composer |
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
├── NAVSUMMARY.md           ← Hot context (read first)
├── NAVSUMMARY_FULL.md      ← Full version if compressed
├── components/           # Individual component JSON files
│   ├── COMP_npm_react_a1b2.json
│   └── COMP_service_stripe_c3d4.json
├── connections/          # Connection records
│   └── CONN_service_call_e5f6.json
├── index.json           # Quick lookup index
├── graph.json           # Full connection graph
├── file_map.json        # File path → component ID lookup
├── prompts.json         # AI prompt content + associations
├── hashes.json          # File hashes for change detection
└── snapshots/           # Point-in-time backups
```

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

MIT

## Contributing

Contributions welcome! Please read the contributing guidelines first.

## Links

- [GitHub Repository](https://github.com/tyroneross/navgator)
- [Issue Tracker](https://github.com/tyroneross/navgator/issues)
- [Claude Code](https://claude.ai/claude-code)

## Codex

This package now ships an additive Codex plugin surface alongside the existing Claude Code package. Claude remains the authoritative runtime for hooks, slash commands, and agents. Codex support is explicit and parallel rather than inferred from the Claude surface.

Package root for Codex installs:
- the repository root (`.`)

Primary Codex surface:
- manifest: `./.codex-plugin/plugin.json`
- workspace marketplace metadata: `./.agents/plugins/marketplace.json`
- skills from `./skills`
- MCP config from `./.mcp.json`

Recommended Codex flows:

```bash
# user-wide install
bash scripts/install-codex-plugin.sh --user

# repo-local workspace metadata
bash scripts/install-codex-plugin.sh --workspace
```

The Codex package is additive only: Claude-specific hooks, slash commands, and agent wiring remain unchanged for Claude Code.
