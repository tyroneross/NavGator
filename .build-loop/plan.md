# Plan — NavGator Run 3 (Scanner Precision Fixes)

Date: 2026-04-24
Branch: salvage/audit-improvements (continues Run 2)
Builds on: 3fb8204

## Goal
Reduce atomize-ai audit defect rate from 4.21% (16/380) to ≤2% (≤8/380), achieving `verdict: accept`.

## Diagnosis (from defect_evidence on atomize-ai)

### D1 — HALLUCINATED_COMPONENT (8 defects)
Root cause: `env-scanner.ts:417` emits `config_files: ['runtime-injected']` (a literal placeholder string) for env vars referenced only in source. The audit verifier checks file existence on disk and the placeholder isn't a real file → defect.

Examples: QUERY_ARTICLE, GROQ_API_KEY_BACKUP, TREND_ANALYSIS_PROMPT, PRISMA_CONNECTION_TIMEOUT, KG_BACKFILL_SKIP_RECENT, BACKUP_GCS_BUCKET, OTEL_API_KEY_STAGING, TEST_RUN_ID.

**Fix (Option A)**: Don't emit components for source-only env vars. Keep the ScanWarning. Drop the env-dependency connections that target them. No downstream consumer depends on these phantom nodes (verified: dead.ts and status.ts only iterate `definedIn>0` cases).

Why not Option B: source-only env vars carry no graph signal once their `env-dependency` connections are dropped. Option B (mark `confidence: low` + verifier change) adds code surface for visibility that the warning already provides.

### D2 — WRONG_ENDPOINT (8 defects)
Two root causes:

**(a) Verifier regex bug — `\b` fails on path-style symbols (6 defects).** All 6 import-stratum defects use path-style symbols (`./entity-analysis-service`, `./test-utilities`, `../fixtures/factories`, `./classify-model`, `./article-volume-chart`, `./ui`).

`verifiers.ts:251` builds `new RegExp('\\b' + escapeRegex(symbol) + '\\b')`. The `\b` token is a word-boundary; `.` and `/` are non-word characters, so `\b./entity-analysis-service\b` fails to match `'./entity-analysis-service'` even though `content.includes(symbol)` returns true.

Verified empirically:
```
/\b\.\/entity-analysis-service\b/.test("from './entity-analysis-service'") → false
"from './entity-analysis-service'".includes("./entity-analysis-service") → true
```

**Fix at verifier (preferred, surgical):** when symbol contains non-identifier chars (`.`, `/`, `-`, `@`, `$`), drop the `\b` and use `content.includes(symbol)`. When symbol is a pure identifier, keep `\b` for false-positive resistance against keywords like `import`, `default`.

**(b) Scanner symbol case-mismatch — prisma-calls (2 defects).** `prisma-calls.ts:169` stores `symbol: \`prisma.${modelKey}\`` where `modelKey = call.modelName.toLowerCase()`. So `prisma.articleEmbedding` from source becomes `prisma.articleembedding` in graph. The lowercased symbol can't be found in the source.

Verified: source has `prisma.articleEmbedding`. Stored symbol `prisma.articleembedding` (lowercase). targetName `ArticleEmbedding` not in source either (camelCase model name in code is `articleEmbedding`).

**Fix at scanner (preserve fidelity):** store the original case-preserved model name in `code_reference.symbol`. Track first-seen original casing per model. Keep lowercased lookups for `modelMap` (existing logic at line 138, line 128).

## Deliverables

### D1 — env-scanner.ts
Modify `src/scanners/infrastructure/env-scanner.ts`:
- When `envVar.definedIn.length === 0`: skip component creation entirely.
- Skip `env-dependency` connections targeting that env var (they have no target component).
- Keep the existing ScanWarning at line 487 (already surfaces these).
- Add header comment block documenting the rationale.

Test: `src/__tests__/env-scanner.test.ts` — add 1 test asserting source-only env vars produce no component, no env-dependency connection, but do produce a warning.

### D2a — verifiers.ts WRONG_ENDPOINT regex
Modify `src/audit/verifiers.ts:218-277`:
- Add `isIdentifierLike(s)`: returns true if `s` matches `^[A-Za-z_$][\w$]*$`.
- For symbol matching: if identifier-like, keep `\b...\b`. Else use `content.includes(symbol)`.
- Same logic for targetName matching.

Tests in `src/__tests__/audit-verifiers.test.ts`:
- Path-style symbol `'./foo-bar'` passes when present in source.
- Identifier symbol `foo` keeps `\b` guarding — `foobar` content does NOT match `foo` symbol.

### D2b — prisma-calls.ts symbol fidelity
Modify `src/scanners/connections/prisma-calls.ts`:
- Track first-seen original casing per model in the loop at line 109-121: `originalCase = match[1]` (already captured from regex; just remember it).
- At line 169, use the original case-preserved name for the symbol, not the lowercased key.

Test: extend `src/__tests__/scanner-integration.test.ts` or add a focused test asserting `code_reference.symbol` for a `prisma.articleEmbedding` call preserves source casing.

### D3 — atomize-ai re-scan
After D1+D2 ship and tests pass, run full scan. Capture new audit block. Target: `defect_rate ≤ 0.02`, `verdict: 'accept'`.

### D4 — All existing tests pass
393 → 393+3-5 tests.

## Hard constraints
1. Zero new runtime npm deps.
2. No external LLM API.
3. Audit infrastructure (sampler, spc, audit/index) untouched. Only verifiers (one regex fn) + scanners (env, prisma) change.
4. Characterization test (bench-repo) may need a one-line update for env-scanner change. Document in commit.
5. No regression on Run 1.x / Run 2.
6. No scope creep.

## Execution dependency graph

D1 (env-scanner), D2a (verifier), D2b (prisma-calls) are independent — different files, different tests. Phase 3 dispatches three subagents in parallel.

## Risks
- Bench-repo characterization snapshot may need update for env-scanner change. If asserts on counts: update; if asserts on content shape only: no change.
- D2a regex change could over-match if path-style symbols share substrings. Mitigation: negative-case tests.
- D2b: deterministic first-seen-wins for casing. Acceptable.

## Done criteria
- [ ] All 393+ tests green.
- [ ] `npm run build:cli` exit 0.
- [ ] atomize-ai full-scan: `defect_rate ≤ 0.02`, `verdict: 'accept'`, HALLUCINATED_COMPONENT ≤ 2, WRONG_ENDPOINT ≤ 2.
- [ ] No DEDUP_COLLISION or HALLUCINATED_EDGE regression.
