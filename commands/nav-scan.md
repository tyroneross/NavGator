---
description: "Scan project architecture and update connection tracking"
allowed-tools: ["Bash", "Read", "Glob", "Grep"]
---

# NavGator Architecture Scan

Scan the current project to detect and track architecture components and their connections.

## What Gets Scanned

**Components:**
- Packages (npm, pip, cargo, go, gem, composer)
- Frameworks (Next.js, React, Django, FastAPI, etc.)
- Databases (PostgreSQL, MongoDB, Redis, Supabase)
- Queues (BullMQ, Celery, SQS)
- Infrastructure (Railway, Vercel, Docker)
- External services (Stripe, OpenAI, Twilio)

**Connections:**
- API → Database (which endpoints touch which tables)
- Frontend → API (which components call which endpoints)
- Queue → Handler (which jobs trigger which code)
- Service calls (where external APIs are used)
- AI prompts (where Claude/OpenAI calls live, with file:line)

## Run the Scan

```bash
npx @tyroneross/navgator scan
```

## Options

- `--quick`: Only scan package files, skip code analysis
- `--connections`: Focus on connection detection
- `--verbose`: Show detailed detection output

## After Scanning

Review the detected architecture:
- Total components found
- Connections mapped
- Any potential issues (outdated packages, missing connections)

Use `/nav-status` to see a summary, or `/nav-impact <component>` to see what's affected by a specific component.
