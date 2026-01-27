---
name: Architecture Awareness
description: Use this skill BEFORE making architectural changes. Triggers on "what packages", "what framework", "dependencies", "tech stack", "what version", "upgrade", "update packages", "add library", "install", "architecture", "what uses", "what calls", "impact of changing", database changes, API modifications, service integrations, or refactoring discussions.
version: 1.0.0
---

# Architecture Awareness Workflow

**Core principle:** Know your stack before you change it.

## CRITICAL: When to Check NavGator

### ALWAYS check NavGator impact BEFORE modifying:

1. **Database schemas/models**
   ```bash
   navgator impact "users-table"  # See which APIs touch this table
   ```

2. **API endpoints**
   ```bash
   navgator connections "api-endpoint"  # See frontend components that call it
   ```

3. **External service integrations** (Stripe, OpenAI, Twilio, etc.)
   ```bash
   navgator impact "Stripe"  # See all files using this service
   ```

4. **Queue workers/job handlers**
   ```bash
   navgator connections "bullmq"  # See what triggers and is triggered by queues
   ```

5. **Shared utilities** (lib/, utils/, helpers/)
   ```bash
   navgator impact "utility-name"  # These often have wide impact
   ```

## Quick Reference

| Situation | Command | Why |
|-----------|---------|-----|
| Before changing DB schema | `navgator impact <table>` | Find all APIs that need updating |
| Before modifying API | `navgator connections <endpoint>` | Find frontend code to update |
| Before touching service code | `navgator impact <service>` | Find all usage locations |
| After npm install | `navgator scan --quick` | Update package tracking |
| After migrations | `navgator scan` | Update schema connections |
| Starting new session | `navgator status` | Check if data is fresh |

## Workflow Examples

### Example 1: Changing a Database Table

**Before:**
```bash
navgator impact "users"
```
This shows:
- Which API endpoints read/write this table
- Which services depend on user data
- File:line locations to update

**Then:** Make your changes knowing what else needs updating.

**After:**
```bash
navgator scan
```

### Example 2: Adding a New Service Integration

```bash
# Check current architecture
navgator status

# Add the package
npm install stripe

# Update architecture
navgator scan --quick

# Start implementing - NavGator now tracks your Stripe calls
```

### Example 3: Refactoring an API Endpoint

```bash
# Before refactoring
navgator connections "api/users"

# Shows:
# - Frontend components calling this endpoint
# - Services that depend on it
# - Exact file:line references

# Now you know what else needs updating when you change the API contract
```

## Session Start Checklist

When starting work on a project:

1. Check if architecture data exists: `navgator status`
2. If missing or stale (>24h): `navgator setup` or `navgator scan`
3. Before any architectural change: `navgator impact <component>`

## What NavGator Tracks

**Components:**
- Packages (npm, pip, cargo, go, gem, composer)
- Frameworks (Next.js, React, Django, FastAPI)
- Databases (PostgreSQL, MongoDB, Redis, Supabase)
- Queues (BullMQ, Celery, SQS)
- Infrastructure (Railway, Vercel, Docker)
- External Services (Stripe, OpenAI, Twilio)

**Connections:**
- API → Database (which endpoints touch which tables)
- Frontend → API (which components call which endpoints)
- Queue → Handler (which jobs trigger which code)
- Service calls (where external APIs are used, with file:line)

## Commands

| Command | Use When |
|---------|----------|
| `navgator setup` | First time scanning a project |
| `navgator scan` | Refresh after changes |
| `navgator scan --quick` | After package install |
| `navgator status` | Check scan freshness |
| `navgator impact <X>` | Before modifying component X |
| `navgator connections <X>` | Understanding how X is connected |
| `navgator diagram` | Generate visual architecture |
| `navgator ui` | Launch visual dashboard |

## Key Principle

**Don't modify architecture-critical code without checking impact first.**

The few seconds to run `navgator impact` can save hours of debugging missed updates.
