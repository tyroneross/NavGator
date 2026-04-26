# Scorecard — NavGator Run 2 (SQC Audit Layer)

Date: 2026-04-25
Branch: salvage/audit-improvements
Builds on: 4f0f06b (Run 1.7) → e0bab6e (v0.7.0)

## Per-deliverable status

| ID | Deliverable | Status | Evidence |
|---|---|---|---|
| D1 | `src/audit/sampler.ts` (math) | ✅ shipped | `binomialCDF`, `chooseAQLPlan`, `sprtNext`, `cochranSize`, `neymanAllocate`, `selectAuditSample`. Zero deps. 378 LOC. 28 sampler unit tests pass; AQL plans match MIL-STD-105E table; SPRT A=19/B=0.0526; Cochran p=0.5,e=0.05,Z=1.96 → 385 unbounded. |
| D2 | `src/audit/verifiers.ts` (6 classes) | ✅ shipped | 449 LOC. 14 verifier tests (positive + negative for each class). HALLUCINATED_COMPONENT, HALLUCINATED_EDGE, WRONG_ENDPOINT, STALE_REFERENCE, DEDUP_COLLISION deterministic. MISSED_EDGE emits structured `llm_payload` in MCP mode, sets `llm_skipped:true` in CLI. |
| D3 | Stratified sample selection | ✅ shipped | `selectAuditSample()` in sampler.ts. Default 6-stratum partition (package, infra, connection-imports, connection-services, connection-llm, connection-prisma, __other). Neyman optimal allocation; samples without replacement. |
| D4 | `src/audit/index.ts` orchestrator + scanner wiring | ✅ shipped | 362 LOC. `runAudit()` selects plan (AQL default; SPRT after 3 audits; Cochran on prior breach), runs all 6 verifiers in `Promise.all`, aggregates by class + stratum, computes verdict. Scanner wired at `scanner.ts:1330` (after Phase 4 storage write, before Phase 5 timeline). New CLI flags `--no-audit` and `--audit-plan=<plan>`. New `ScanOptions.noAudit`, `auditPlan`, `isMcpMode`. |
| D5 | EWMA drift chart | ✅ shipped | 126 LOC `src/audit/spc.ts`. Hawkins-Wu defaults λ=0.2, L=2.7. 5-obs warm-up phase. Per-stratum state persisted to `index.json.ewma`. On breach, `pending_drift_breach` set; `selectScanMode` reads it and forces full + Cochran via new reason `'audit-drift-breach'`. |
| D6 | Tests (4 new files) | ✅ shipped | 28 sampler + 9 SPC + 14 verifier + 4 scanner-integration = **55 new tests**. All pass. |
| D7 | Docs | ✅ shipped | README "Audit" subsection (~50 lines under "Scan modes") covers AQL/SPRT/Cochran, defect classes, strata, EWMA drift. `agents/architecture-planner.md` workflow now references `audit.verdict` + `drift_breach` as freshness signals. |

## E2E result on atomize-ai (1844 source files, full scan)

```
plan: AQL
n: 200, c: 10  (lot size = 2467 components + 6455 connections → AQL code letter L)
sampled: 380 facts (across 5 deterministic verifier classes; DEDUP_COLLISION scans all 2467 components)
defects: 16
defect_rate: 4.21%
verdict: reject
llm_skipped: true (CLI mode)
```

Defects by class:
- HALLUCINATED_COMPONENT: 8/100 — env-var components whose `.env` config_files don't exist on disk (these are real warnings — scanner already surfaces them as "may be runtime-injected")
- WRONG_ENDPOINT: 8/100 — connections where the recorded symbol/name was not found via grep on the source file (limitation: deep import-tree symbols)
- HALLUCINATED_EDGE: 0/100
- STALE_REFERENCE: 0/40
- DEDUP_COLLISION: 0/2467 — Run 1.7 fix holds, no regression
- MISSED_EDGE: 0 (LLM-skipped in CLI mode)

By stratum:
- `infra`: 38% defect rate (8/21) — env-var hallucinations dominant
- `connection-prisma`: 11% (2/19)
- `connection-imports`: 10% (6/60)
- `package`, `connection-services`, `__other`: 0%

The `verdict: reject` is honest — the audit has surfaced two precision gaps (env-var detection, import-symbol grep) that future runs can target. Critically, **the audit did not fail the scan**; per spec, only EWMA drift triggers the next-scan auto-promote.

`--no-audit` correctly skips audit (verified: timeline entry has no `audit` block).
`index.audit_history_count: 1`, `index.ewma` populated for all 6 strata. `pending_drift_breach: false` (first audit — no prior baseline to drift from yet).

## Files modified

| File | Diff |
|---|---|
| `src/types.ts` | +75 — `AuditReport`, `EwmaStateSnapshot`, `AuditDefectClass`, `AuditSampleEvidence`, plus `ArchitectureIndex.ewma`, `audit_history_count`, `pending_drift_breach`, plus `TimelineEntry.audit` |
| `src/scanner.ts` | +116 — Phase 4.5 hook, EWMA persist on freshIndex, `audit-drift-breach` reason in selectScanMode, `noAudit/auditPlan/isMcpMode` ScanOptions, `stripInternals` helper |
| `src/cli/commands/scan.ts` | +9 — `--no-audit` flag, `--audit-plan <plan>` option, JSON output includes audit block |
| `README.md` | +48 — Audit subsection under Scan modes |
| `agents/architecture-planner.md` | +1 — audit-signal note for freshness gating |

## Files added

| File | LOC |
|---|---|
| `src/audit/sampler.ts` | 378 |
| `src/audit/spc.ts` | 126 |
| `src/audit/verifiers.ts` | 449 |
| `src/audit/index.ts` | 362 |
| `src/__tests__/audit-sampler.test.ts` | 195 (28 tests) |
| `src/__tests__/audit-spc.test.ts` | 92 (9 tests) |
| `src/__tests__/audit-verifiers.test.ts` | 230 (14 tests) |
| `src/__tests__/scanner-audit.test.ts` | 75 (4 tests) |

## Test totals

- Before Run 2: 338 tests
- After Run 2: **393 tests** (+55, all pass)
- 29 test files (was 25, +4)
- `npm run build:cli` exit 0 ✅

## Math fidelity vs textbook

| Quantity | Textbook | Implementation | Notes |
|---|---|---|---|
| Cochran p=0.5,e=0.05,Z=1.96 (no FPC) | 385 (ceil 384.16) | 385 ✅ | exact |
| Cochran with N=2000 FPC | **322** (per Cochran 1977 with intermediate rounding to 384) | **323** (no intermediate rounding) | Test asserts range [322,323]. Difference is rounding strategy only, not math. |
| AQL code letter J for N≤1200 | n=80, c=5 | n=80, c=5 ✅ | per MIL-STD-105E single sampling, GIL II, AQL=2.5% |
| SPRT bounds α=β=0.05 | A=19, B=0.0526… | A=19, B=0.05263… ✅ | exact |
| EWMA control limits | μ ± Lσ√(λ/(2-λ)) | μ ± Lσ√(λ/(2-λ)·(1-(1-λ)^(2k))) | Stabilized form (Lucas-Saccucci 1990); same asymptote, tighter early-run limits |

## Hard-constraint check

1. ✅ Zero new runtime npm deps. `package.json` untouched. All math inline.
2. ✅ No external LLM API. CLI mode sets `llm_skipped: true`. MCP mode emits a structured `llm_payload` for the running model to consume — no network call.
3. ✅ Audit does NOT fail the scan or rewrite the graph. `verdict: 'reject'` on atomize-ai produced no scan failure; only `pending_drift_breach` flag mutates the index, and only when EWMA breaches.
4. ✅ Bit-identical full-scan output. `scanner-characterization.test.ts` passes. Audit block lives only on `timeline.audit` (new optional field) and on `index.ewma`/`audit_history_count` (new optional fields).
5. ✅ `atomicWriteJSON` preserved. EWMA persists via the existing `getIndexPath` atomic write at scanner.ts:1430.
6. ✅ No regression on Run 1+1.5+1.6+1.7. All 338 prior tests still pass.
7. ✅ No scope creep. Parallel workers, model tiering, hook auto-invoke, Python AST, Phase 5/6 incremental opt all skipped.

## Anything blocking commit

Nothing. Default flow: user reviews and commits.

Suggested commit message:

```
feat(audit): SQC self-measurement layer with stratified sampling, EWMA drift (run 2)

D1 sampler.ts — binomialCDF, AQL plans, SPRT, Cochran, Neyman allocation
D2 verifiers.ts — 5 deterministic + 1 LLM-judge defect class
D3 stratified sample selection across 6 strata
D4 audit/index.ts orchestrator + scanner wiring + CLI flags
D5 EWMA drift chart per stratum (Hawkins-Wu λ=0.2, L=2.7)
D6 55 new tests (393 total, all pass)
D7 README + planner-agent docs

E2E on atomize-ai (1844 files, 2467/6455 graph): 380-fact AQL sample,
4.21% defect rate, surfaces real precision gaps in env-var detection
and import-symbol grep. CLI mode skips LLM-judge correctly. Zero new deps.
```

## Verification recipe (reproducible)

```bash
cd ~/dev/git-folder/NavGator
npm test                                       # 393 pass
npm run build:cli                              # exit 0

# E2E on atomize-ai
cd ~/dev/git-folder/atomize-ai
node ~/dev/git-folder/NavGator/dist/cli/index.js scan --full
cat .navgator/architecture/timeline.json | python3 -c "import json,sys; e=json.load(sys.stdin); entries=e.get('entries',e); a=entries[-1].get('audit'); print(json.dumps(a,indent=2) if a else 'NO AUDIT BLOCK')"
# → audit block with plan, n, c, sampled, defects, by_class, by_stratum, verdict

# CLI mode skips LLM-judge
# (verify llm_skipped: true in the audit block above)

# --no-audit works
node ~/dev/git-folder/NavGator/dist/cli/index.js scan --full --no-audit
# Audit block absent in latest timeline entry

# Index persists EWMA + history count
cat .navgator/architecture/index.json | python3 -c "import json,sys; d=json.load(sys.stdin); print('history:',d.get('audit_history_count')); print('breach:',d.get('pending_drift_breach')); print('ewma keys:',list(d.get('ewma',{}).keys()))"
```
