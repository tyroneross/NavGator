# NavGator Remaining Gaps (Post-0.4.2)

## Resolved This Session
- ✅ Queue-consumes: 0 → 17 (Worker detection with variable resolution)
- ✅ Deploy entry points: Dockerfile CMD parsing, Procfile worker linking
- ✅ LLM dedup: 154 → 9 use cases (purpose inference, generic symbol filtering)
- ✅ NAVSUMMARY quality: production-first sorting, runtime topology section
- ✅ CWD mismatch warning in list command

## Still Open

### High Priority

1. **Cross-component path tracing (#4)**
   - `navgator trace` finds 0 paths because connections use `FILE:` prefixed IDs
   - trace.ts BFS only follows registered component IDs, not FILE: nodes
   - Fix: extend traceDataflow() to treat FILE: nodes as pass-through, following connections from any FILE: endpoint to the next registered component
   - This is the #1 feature for debugging cross-platform issues

2. **Component naming inconsistency (#3)**
   - Railway appears as "Railway", "Railway Config", "Railway (infra)"
   - BullMQ appears as "BullMQ" and "bullmq@5.61.0"
   - Fix: merge components with the same underlying identity, or add aliases to resolveComponent()

3. **Connection count inflation (#1)**
   - 2,251 total connections but only ~50 are architecturally meaningful
   - imports (1,059) and env-dependency (942) dominate
   - Fix: show weighted counts in status: "Architecture: 50 | Code: 1,059 imports | Config: 942 env"

### Medium Priority

4. **Env var warning noise (#6)**
   - 161 warnings for framework-injected vars (NEXT_RUNTIME, BASE_URL)
   - Fix: suppress list for known framework vars, or severity levels

5. **Dead code detection (#8)**
   - orphan-component rule exists in rules.ts but not surfaced in status
   - 3 queues (prefetch, query-analysis, search-processing) have no producers/consumers
   - Fix: add "Potential dead code: N orphaned components" to status output

6. **Schema-to-code mapping (#9)**
   - 32 schema-relation connections but no API route → table mapping
   - Would need Prisma client call detection (prisma.article.findMany → articles table)
   - Significant new scanner work

### Lower Priority

7. **Dashboard testing (#10)** — untested, separate concern
8. **Temporal awareness (#11)** — history/diff commands exist but need integration
