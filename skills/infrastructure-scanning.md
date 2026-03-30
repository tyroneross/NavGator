---
name: infrastructure-scanning
description: Detect and analyze infrastructure components — Prisma models, env vars, queues, crons, deploy configs, field usage, and type validation
---

# Infrastructure Scanning

NavGator detects infrastructure components beyond packages and services.

## Quick Commands

| Command | What it does |
|---------|-------------|
| `navgator scan` | Detect all infrastructure (Prisma, env vars, queues, crons, deploy) |
| `navgator scan --field-usage` | Analyze which Prisma model fields are actually used in code |
| `navgator scan --typespec` | Compare Prisma model types against TypeScript interfaces |
| `navgator coverage --fields` | Standalone field usage report |
| `navgator coverage --typespec` | Standalone type validation report |
| `navgator status` | Shows INFRASTRUCTURE and RUNTIME TOPOLOGY sections with counts |

## What Gets Detected

**Prisma** — Models, fields, relations, indexes, table mappings. Field usage analysis identifies unused, read-only, and write-only fields across the codebase.

**Environment Variables** — From `.env` files and `process.env` references. Categorized as database, auth, api-key, service, infra, or app-config.

**Queues** — BullMQ/Bull queue definitions with producer/consumer topology and concurrency settings.

**Cron Jobs** — From vercel.json, railway.json, and node-cron patterns with human-readable schedule descriptions.

**Deploy Configs** — Vercel, Railway, Heroku, Procfile, and nixpacks configurations with service definitions.

**TypeSpec Validation** — Compares Prisma model field types against TypeScript interface definitions, flagging mismatches (e.g., `DateTime` vs `string` instead of `Date`).

**Runtime Topology** — Annotates components with runtime identity extracted from code and config:
- Database engine, host, and port from `DATABASE_URL` and Prisma `datasource` blocks
- Redis endpoints from BullMQ queue configs and env vars
- Queue-to-Redis backing store mappings with producer/consumer relationships
- Deploy service names from Railway, Vercel, Heroku (Procfile), and Nixpacks configs
- Cron handler linkage — scheduled jobs mapped to their handler functions and platform

Run `navgator status` to see the RUNTIME TOPOLOGY section. Enables backward tracing: "which code produces to queue X?" or "what database engine does this schema connect to?"
