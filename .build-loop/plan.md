# NavGator Run 2 — SQC Audit Layer Plan

Date: 2026-04-25
Branch: salvage/audit-improvements
Builds on: 4f0f06b (Run 1.7) → e0bab6e (v0.7.0 release tag)

## Goal
Add a self-measurement layer to NavGator: every scan samples its own output, runs deterministic verifiers, optionally requests an LLM-judge spot-check (only in MCP mode), and tracks defect-rate drift across runs via EWMA. Audit failure does NOT fail the scan; the next scan auto-promotes if EWMA breaches.

## Deliverables (D1-D7)

### D1 — `src/audit/sampler.ts` (~150 LOC, zero deps)
- `binomialCDF(n, p, c)` — log-gamma–stable CDF for OC-curve calc.
- `chooseAQLPlan(lotSize)` → `{ n, c, plan: 'AQL' }`. Lookup table per MIL-STD-105E general inspection level II (single sampling, AQL=2.5%): N≤90→n=13/c=1, 91-150→n=20/c=1, 151-280→n=32/c=2, 281-500→n=50/c=3, 501-1200→n=80/c=5, 1201-3200→n=125/c=7, 3201-10000→n=200/c=10, 10001+→n=315/c=14.
- `sprtNext(observations[], p0, p1, alpha, beta)` → `{verdict, logLR}`. A=(1-β)/α, B=β/(1-α).
- `cochranSize(p, e, z, populationSize?)` with FPC `n_adj = n / (1 + (n-1)/N)`.
- `neymanAllocate(n, strataSizes[], strataStdDevs[])` → per-stratum n[]; rounds up; preserves sum=n.
- Constants: Z₀.₉₅=1.645, Z₀.₉₇₅=1.96, Z₀.₉₉₅=2.576.

### D2 — `src/audit/verifiers.ts` (~250 LOC)
Six classes; first 5 deterministic (free), 6th LLM-dependent:

| Class | Verifier impl |
|---|---|
| HALLUCINATED_COMPONENT | `fs.access` on each `source.config_files[]`; for code components (api-endpoint, prompt, worker), grep symbol `code_reference.symbol` in file |
| HALLUCINATED_EDGE | both `from.component_id` & `to.component_id` resolve in `index.components.by_*` |
| WRONG_ENDPOINT | for connection's source file, grep target name; if no match, defect |
| STALE_REFERENCE | hash file via SHA-256, compare with `hashes.json[relativePath].hash` |
| DEDUP_COLLISION | scan finalComponents for dup `(type, name, primary-config-file)` triples |
| MISSED_EDGE (LLM) | when in MCP mode, sample N source files and emit a "needs LLM verification" structured payload; `audit.llm_skipped: true` in CLI mode |

Each returns `{ class, sampledCount, defectCount, samples: SampleEvidence[] }` where `SampleEvidence = { id, ok, reason? }`.

### D3 — Stratified sample selection
`selectAuditSample(allFacts, planN, strataKey, priorDefectRates?)`:
- Default strata: `package`, `infra`, `connection-imports`, `connection-services`, `connection-llm`, `connection-prisma`, `__other`.
- StrataKey: function `(fact) => stratum`.
- StdDev per stratum: `√(p(1-p))` from `priorDefectRates[stratum]`; default p=0.5 worst-case.
- Neyman; sample without replacement.

### D4 — `src/audit/index.ts` — orchestrator
- `runAudit(scanResult, config, root, opts)` returns `AuditReport`.
- Plan: AQL default; SPRT once `index.audit_history?.length >= 3`; Cochran when prior breach detected (auto-promote signal).
- Stratify, run all 6 verifiers in parallel (Promise.all), aggregate.
- Wire into `scanner.ts` AFTER line 1324 `storeConnections`, BEFORE Phase 5 line 1330 timeline build. Stored on `timelineEntry.audit?: AuditReport` (new optional field).
- New CLI flags: `--no-audit`, `--audit-plan=aql|sprt|cochran`.
- New `ScanOptions` fields: `noAudit?: boolean`, `auditPlan?: 'aql'|'sprt'|'cochran'`.

### D5 — `src/audit/spc.ts` (~80 LOC)
- `EwmaState { lambda, L, mean, variance, n, points: number[] }`.
- `updateEwma(state, value)` returns `{ state, breach: boolean, ucl: number, lcl: number }`.
- λ=0.2, L=2.7 (Hawkins-Wu small-shift defaults).
- Per-stratum EWMA persisted in `index.json.ewma?: Record<stratum, EwmaState>`.
- On breach: set `audit.drift_breach = true` on timeline entry; NEXT scan reads `index.ewma[*].breach_pending` and auto-promotes to `mode='full' + auditPlan='cochran'`.

### D6 — Tests (4 new files)
1. `audit-sampler.test.ts` — Cochran p=0.5,e=0.05,Z=1.96 → 384 unbounded; FPC N=2000 → **322** (textbook); AQL lookups; SPRT A=19, B=0.0526 within ±1e-3; binomialCDF(80,0.025,4) ≥ 0.99.
2. `audit-verifiers.test.ts` — 6 verifiers each with positive + negative fixture.
3. `audit-spc.test.ts` — EWMA recurrence: λ=0.2, after 10 stable obs z in band; shift breaches.
4. `scanner-audit.test.ts` — integration on tiny fixture project; assert `timeline.audit` present.

### D7 — Docs
- README "Scan modes" → "Audit" subsection (≤80 lines).
- `agents/architecture-planner.md` — note planner can read `timeline.audit.defect_rate`.

## Hard constraints
1. Zero new runtime npm deps.
2. No external LLM API (CLI mode → `llm_skipped: true`).
3. Audit MUST NOT fail the scan or rewrite the graph; only updates EWMA + sets `drift_breach`.
4. Bit-identical full-scan output (chars-snapshot intact).
5. `atomicWriteJSON` for any audit file write.
6. No regression on Run 1+1.5+1.6+1.7.
7. Reject scope creep — defer to `.build-loop/issues/run2-deferred-<topic>.md`.

## Phase 3 EXECUTE — parallel subagent dispatch

- **Subagent A (sampler+spc):** `src/audit/sampler.ts`, `src/audit/spc.ts`, `audit-sampler.test.ts`, `audit-spc.test.ts`.
- **Subagent B (verifiers):** `src/audit/verifiers.ts`, `audit-verifiers.test.ts`.
- **Subagent D (docs):** README + planner agent.

A, B, D run in parallel.

- **Subagent C (orchestrator + scanner wiring):** `src/audit/index.ts`, edit `src/scanner.ts`, `src/types.ts`, `src/cli/commands/scan.ts`. Writes `scanner-audit.test.ts`. Spawned AFTER A+B complete (consumes their exports).

## Phase 4 REVIEW
critic → validate (npm test, build, e2e atomize-ai) → fact-check → simplify → scorecard.

## Out-of-scope (auto-defer)
- Parallel verifier workers, model tiering, hook auto-invoke, Python AST, Phase 5/6 incremental opt.
