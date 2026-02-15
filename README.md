# NavGator

**Architecture Connection Tracker for Claude Code**

> Know your stack before you change it

NavGator tracks architecture connections across your entire stack—packages, services, databases, queues, and infrastructure—so Claude knows what else needs to change when you modify one part of the system.

## Features

- **Component Detection**: Packages (npm, pip), frameworks, databases, queues, infrastructure
- **Connection Mapping**: API → Database, Frontend → API, Queue → Handler, Service calls
- **Impact Analysis**: "What's affected if I change X?"
- **Change Detection**: SHA-256 file hashing tracks what changed since last scan
- **Mermaid Diagrams**: Visual architecture diagrams
- **Claude Code Integration**: Hooks, skills, and slash commands

## Installation

### As a CLI Tool

```bash
# Install globally
npm install -g @tyroneross/navgator

# Or use with npx
npx @tyroneross/navgator scan
```

### As a Claude Code Plugin

After installing globally, use the `/gator:install` command inside Claude Code, or run the install script:

```bash
# Install for all projects (user scope)
bash scripts/install-plugin.sh --global

# Install for current project only
bash scripts/install-plugin.sh --project
```

Or link manually:

```bash
ln -s $(npm root -g)/@tyroneross/navgator ~/.claude/plugins/gator
```

Restart Claude Code after installing. All `/gator:*` commands will be available.

## Quick Start

### 1. Set Up NavGator

```bash
navgator setup
```

This runs the initial scan and offers to link NavGator as a Claude Code plugin (if Claude Code is installed).

### 2. Scan Your Project

```bash
# Full scan (packages + connections)
navgator scan

# Quick scan (packages only, faster)
navgator scan --quick

# With AI prompt detection
navgator scan --prompts --verbose
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

When installed as a Claude Code plugin, all commands are available as `/gator:*` slash commands:

| Command | Description |
|---------|-------------|
| `/gator:scan` | Scan project architecture |
| `/gator:status` | Show architecture summary |
| `/gator:impact <component>` | Analyze what's affected by a change |
| `/gator:connections <component>` | Show all connections for a component |
| `/gator:diagram` | Generate architecture diagram |
| `/gator:export` | Export architecture to markdown or JSON |
| `/gator:check` | Run health checks (outdated packages, vulnerabilities) |
| `/gator:ui` | Launch the web dashboard |
| `/gator:update` | Update NavGator to the latest version |
| `/gator:install` | Install/reinstall the plugin (choose scope) |

### Hooks

NavGator includes hooks that integrate with Claude Code:

**SessionStart**: Checks if architecture data is stale (>24h) and suggests running `/gator:scan`.

**PreToolUse (Edit/Write)**: Before modifying architecture-critical files, reminds to check impact with `/gator:impact`.

**PostToolUse (Bash)**: Detects package manager commands (`npm install`, `pip install`, etc.) and reminds to update architecture with `/gator:scan`.

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
| `--clear` | Clear existing data before scan |
| `--ast` | Use AST-based scanning (requires `ts-morph`) |

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

## Storage

Data is stored in `.claude/architecture/` within your project:

```
.claude/architecture/
├── SUMMARY.md           ← Hot context (read first)
├── SUMMARY_FULL.md      ← Full version if compressed
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
| `NAVGATOR_PATH` | Custom storage path | `.claude/architecture` |
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
