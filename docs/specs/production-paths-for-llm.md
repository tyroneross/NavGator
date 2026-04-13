# Spec: `PRODUCTION_PATHS.md` Generator

**Status:** Proposal
**Author:** 2026-04-12 — derived from subagent miss pattern observed in atomize-ai investigation
**Related:** `atomize-ai/.claude/memory/incidents/INC_20260412_subagent_miss.json`, `atomize-ai/.navgator/lessons/subagent-investigation-protocol.md`

## Problem

LLM subagents tasked with investigating code behavior in large projects regularly produce confident-but-wrong reports because they:

1. **Extrapolate from keyword grep** without reading full function bodies
2. **Pick up matches in archive/deprecated/backup paths** without distinguishing them from live code
3. **Assume invocation context** (e.g., "runs automatically during ingestion") without verifying via caller analysis
4. **Don't use existing NavGator commands** even when they exist, because the subagent's prompt didn't require it

NavGator's existing `NAVSUMMARY.md` is a component-level architectural overview. It doesn't tell an LLM "these are the live entry points, these paths are noise to ignore, here's the data flow for the top N features."

Two concrete misses observed in Atomize AI:

- Subagent claimed `embedding-service.ts` lacked a DB-fallback for empty content. The fallback was at lines 120-129 with a "CRITICAL FIX" comment. Subagent grep'd the caller and the guard, skipped the middle.
- Subagent claimed entity deduplication "runs automatically during ingestion." It runs only from a manual script. No caller grep was performed.

Both would have been prevented by: (a) a hot-path map the subagent reads first, (b) a rule that every behavior claim cites file:line + quoted code, (c) an explicit "ignore these paths" list.

## Proposal

Add a new NavGator command and output file:

```
npx navgator paths
```

Generates `.navgator/architecture/PRODUCTION_PATHS.md` — a hot-path map optimized for LLM consumption. The file is always less than 250 lines, structured as a set of sections LLMs can skim quickly.

## Output Structure

```markdown
# Production Paths — <project-name>

**Generated:** <ISO timestamp>
**Source of truth for LLM investigators.** Read this before making claims about runtime behavior.

## 1. LIVE ENTRY POINTS

### API Routes (auto-detected from `app/api/**/route.ts`, `pages/api/**`, or framework equivalent)
| Route | Method | Handler | Calls |
|-------|--------|---------|-------|
| /api/intelligent-search | POST | app/api/intelligent-search/route.ts | IntelligentQueryEngine, prisma.article, pgvector |
...

### Cron Jobs (auto-detected from `vercel.json`, `railway.json`, node-cron)
| Schedule | Route/Script | Purpose | Triggers |
|----------|--------------|---------|----------|
| */15 * * * * | /api/cron/refresh-rss | Ingest new articles | kg-summaries-groq, kg-entity-extraction |
...

### Workers (auto-detected from `Dockerfile`, `railway.json` service configs, `process.json`)
| Service | Entry Point | Consumes Queues | Connects To |
|---------|-------------|-----------------|-------------|
| bullmq-worker | scripts/start-hybrid-workers.ts | kg-embeddings, kg-summaries-groq | OpenAI, Groq, Postgres |
...

### Scripts (manual — NOT automatic)
Explicitly labeled so subagents don't mistake them for automation.
| Script | Purpose | Destructive? |
|--------|---------|--------------|
| scripts/deduplicate-entities.ts | Merge duplicate entities | Yes — deletes rows |
...

## 2. IGNORE THESE PATHS

Auto-detected dormant/archive/backup paths. Subagents should treat grep matches in these paths as noise, not evidence.

- `_archive/**` (detected: 12 files)
- `docs/archive/**` (detected: 34 files)
- `docs/*/archive/**` (detected: 18 files)
- `**/*.bak` (detected: 2 files — listed below)
- `**/*.backup*` (detected: 0)
- `**/*.phase*-backup-*` (detected: 1 file)
- `.bookmark/archive/**` (detected: 8 files)
- `prisma/migrations/*/rollback.sql` (informational only)

### Specific backup files present (safe to ignore)
- `app/api/intelligent-search/summary/route.ts.bak`
- `lib/knowledge-graph/intelligent-query-engine.ts.bak`
- `lib/knowledge-graph/intelligent-query-engine.ts.phase1-backup-20251010-232611`

## 3. CRITICAL DATA PATHS (read these for features involving user data)

For each user-facing feature, trace the full stack entry-to-DB.

### Search (intelligent search)
```
user → POST /api/intelligent-search
     → lib/knowledge-graph/intelligent-query-engine.ts (searchWithVectors)
     → prisma.$queryRaw using pgvector `<=>` operator
     → article_embeddings (read) + articles (read) + entities (read)
response: ranked articles + entity context
```

### Article Ingestion
```
Vercel cron /api/cron/refresh-rss
     → lib/services/rss-ingestion-service.ts
     → prisma.article.create (write)
     → BullMQ enqueue: kg-embeddings, kg-summaries-groq, kg-entity-extraction
     → Railway bullmq-worker consumes
         → lib/services/embedding-service.ts (writes article_embeddings)
         → lib/ai/groq-summary-service.ts (writes summaries)
         → lib/knowledge-graph/extraction-service.ts (writes entities, entity_mentions)
```

(Generate 3-7 of these for the top critical features — detected from API routes with highest connection counts.)

## 4. HOT FILES (must read full body before claiming behavior)

Files with complex branching logic where LLMs are most likely to misread by skipping context.

| File | Why | Current LOC |
|------|-----|-------------|
| lib/services/embedding-service.ts | Has conditional DB fallback for empty content (line ~120) that's easy to miss | 400 |
| lib/services/entity-deduplication-service.ts | Manual-only script, not automated — always verify caller context | 517 |
| lib/knowledge-graph/intelligent-query-engine.ts | Multiple index paths, fallback chains, feature flags | 4000+ |
...

## 5. VALIDATION CHEATSHEET

How to verify a feature works end-to-end:
1. Entry point — which route/cron/worker triggers it?
2. Handler — which service does it call?
3. Data flow — which tables does it read/write? (`navgator schema <model>`)
4. Side effects — which queues? (`navgator trace <service>`)
5. Observability — where does it log?
6. Live data — does the outcome appear in DB?

## 6. SUBAGENT DO / DO NOT

### DO
- Cite file:line for every factual claim
- Quote the actual code (3-10 lines) when claiming a function's behavior
- Read the full function body, not just grep matches
- Run `navgator connections <component>` before claiming what calls a service
- Classify each caller: [live] / [manual] / [test] / [archive]

### DO NOT
- Cite code from archive/bak paths (ignore them)
- Assume invocation context ("runs during X") without listing specific callers
- Summarize a function's behavior from its imports or a single guard clause
- Use "the code silently X" without quoting the exact silent line
```

## Detection Rules

### Archive/dormant path detection
- Directory names matching `/archive|_archive|deprecated|old|_old|legacy/i`
- File extensions `.bak`, `.backup`, `.orig`, `.old`
- Filename patterns `*-backup-*`, `*.phase*-backup-*`, `*-deprecated.*`
- Files with `// @deprecated` or `/* DEPRECATED */` markers in first 20 lines

### Hot files detection
Score each file by:
- Connection count (high fan-in) × 2
- Feature flag count (`process.env.ENABLE_*` references)
- Conditional branch depth (ternaries + ifs in function bodies)
- Comment markers: "CRITICAL", "IMPORTANT", "DO NOT", "TODO", "FIXME"
Top N files become "hot files."

### Critical data paths
For each API route or cron with > 2 incoming connections from the overall graph, trace the outgoing service calls (2-3 hops). Format as a text tree.

## Implementation Sketch

```typescript
// CLI: src/cli/paths.ts
export async function generatePaths(opts: { outDir: string }) {
  const graph = await loadGraphJson(opts.outDir);
  const fileMap = await loadFileMap(opts.outDir);

  const liveEntryPoints = await detectLiveEntryPoints(graph, {
    nextjsRoutes: /app\/api\/.*\/route\.(ts|js)$/,
    pagesRoutes: /pages\/api\/.*\.(ts|js)$/,
    crons: ['vercel.json', 'railway.json'],
    workers: ['Dockerfile', 'railway.json', 'package.json'],
    manualScripts: /scripts\/.*\.ts$/,
  });

  const ignoredPaths = await detectIgnoredPaths(fileMap, IGNORE_PATTERNS);

  const criticalDataPaths = await traceCriticalPaths(graph, {
    minIncomingConnections: 2,
    maxTraceDepth: 3,
  });

  const hotFiles = await scoreHotFiles(fileMap, {
    weights: { fanIn: 2, featureFlags: 1.5, conditionalDepth: 1, markers: 1 },
    topN: 15,
  });

  await writeMarkdown(`${opts.outDir}/PRODUCTION_PATHS.md`, {
    liveEntryPoints,
    ignoredPaths,
    criticalDataPaths,
    hotFiles,
  });
}
```

## Rollout

1. Add `paths` command to `src/cli/` — generates the markdown
2. Wire into existing `scan` workflow — `npx navgator scan` also regenerates `PRODUCTION_PATHS.md`
3. Update NavGator CLAUDE.md to instruct LLMs: "Read `PRODUCTION_PATHS.md` BEFORE claiming runtime behavior"
4. Add to skills list (`llm-investigation-rules.md`) — a skill that pins subagent behavior to the rules in Section 6

## Open Questions

1. **Heuristics for "live entry point" detection** — Next.js App Router is unambiguous; Next.js Pages Router too; but `server.ts`, Express, Fastify, Hono all have different idioms. How does NavGator detect entry points across frameworks?
2. **False positives in archive detection** — `docs/archive/important-history.md` might be linked from a live route. We should not claim a file is archive unless both the path pattern matches AND there are zero live incoming connections.
3. **Hot file scoring** — is 15 the right N? Probably depends on project size. Consider `--top N` flag.
4. **Update cadence** — should `PRODUCTION_PATHS.md` be regenerated on every `scan`, or only with `--full`? Each scan runs it = freshest data; only-full = faster scans.

## Success Criteria

A subagent dispatched to investigate "does feature X work correctly?" in a project with `PRODUCTION_PATHS.md`:

1. Reads `PRODUCTION_PATHS.md` first (required by updated NavGator CLAUDE.md)
2. Identifies the live entry point from Section 1
3. Traces through Section 3's critical path
4. Cites file:line with quoted snippets per Section 6's rules
5. Does NOT cite matches from paths in Section 2

Measurable effect: the two misses observed in Atomize AI (embedding-service.ts fallback, entity-dedup invocation context) would not recur.
