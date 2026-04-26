# Scorecard — NavGator Run 3 (Scanner Precision Fixes)

Date: 2026-04-24
Branch: salvage/audit-improvements
Builds on: 3fb8204 (Run 2)

## Per-deliverable status

| ID | Deliverable | Status | Evidence |
|---|---|---|---|
| D1 | env-scanner.ts (Option A) | shipped | Source-only env vars no longer emit components or env-dependency connections; ScanWarning still surfaces them. 5 new tests in env-scanner.test.ts. |
| D2a | verifiers.ts WRONG_ENDPOINT regex | shipped | `symbolAppearsIn()` helper handles path-style symbols (`./foo-bar`) via plain `includes`, identifier-style via `\b...\b`. 4 new tests in audit-verifiers.test.ts. |
| D2b | prisma-calls.ts symbol fidelity | shipped | Connection symbol preserves source casing (`prisma.articleEmbedding`, not lowercased). Raw-SQL connections store the literal table name (`rss_sources`) instead of synthetic `$queryRaw(rss_sources)` wrapper. 2 new tests in prisma-calls.test.ts. |
| D3 | atomize-ai re-scan | shipped | defect_rate **0.0** (was 0.0421). verdict **accept** (was reject). |
| D4 | All existing tests pass | shipped | 404/404 (393 prior + 11 new). `npm run build:cli` exit 0. |

## E2E result on atomize-ai (1844 source files, full scan)

```
plan: AQL
n: 200, c: 10
sampled: 380
defects: 0
defect_rate: 0.0%
verdict: accept
llm_skipped: true (CLI mode)
```

By class (post-fix):
- HALLUCINATED_COMPONENT: 0/100  (was 8/100)
- WRONG_ENDPOINT:         0/100  (was 8/100)
- HALLUCINATED_EDGE:      0/100  (was 0/100)
- STALE_REFERENCE:        0/40   (was 0/40)
- DEDUP_COLLISION:        0/2281 (was 0/2467 — graph shrunk slightly because phantom env components dropped)
- MISSED_EDGE:            0/40 (LLM-skipped in CLI)

## Files modified

| File | Diff |
|---|---|
| `src/scanners/infrastructure/env-scanner.ts` | +28 / -16 — Option A header doc; skip emission for `definedIn.length === 0`; simplified config_files / status / tags |
| `src/audit/verifiers.ts` | +35 / -7 — `isIdentifierLike()`, `symbolAppearsIn()` helpers; WRONG_ENDPOINT now uses them |
| `src/scanners/connections/prisma-calls.ts` | +24 / -5 — track `originalCase` per model; raw-SQL connection now stores `tableName` literal as symbol |
| `src/__tests__/env-scanner.test.ts` | +75 / 0 — 5 tests for scanEnvVars: defined+ref emits, source-only skip, no orphan connection, warning still emitted, no placeholder regression |
| `src/__tests__/audit-verifiers.test.ts` | +52 / 0 — 4 path-style / identifier-boundary tests |
| `src/__tests__/prisma-calls.test.ts` | +33 / 0 — 2 casing-preservation tests |

## Test totals

- Before Run 3: 393 tests
- After Run 3: **404 tests** (+11, all pass)
- 29 test files (no new files; extended existing)

## Hard-constraint check

1. Zero new runtime npm deps — package.json untouched.
2. No external LLM API.
3. Audit infrastructure unchanged: sampler.ts, spc.ts, audit/index.ts untouched. Only verifiers.ts (defect detection helpers) and two scanners changed.
4. Bit-identical full-scan output on bench-repo: characterization snapshot has zero diff. Bench-repo's env vars are all defined in `.env.example`, so D1 Option A doesn't drop any of them.
5. No regression on Run 1.x or Run 2: 393 prior tests still pass.
6. No scope creep: no parallel workers, no model tiering, no hook auto-invoke, no Python AST helper, no new MCP tools / agents / commands.

## Anything blocking commit

Nothing.

Suggested commit message:

```
fix(scanner): env + import precision — atomize-ai audit accepts at 0% defects (run 3)

D1 env-scanner: Option A — drop phantom components for source-only env vars
   (was: config_files: ['runtime-injected'] placeholder triggered 8 audit
   HALLUCINATED_COMPONENT defects). ScanWarning still surfaces the vars.

D2a verifiers: WRONG_ENDPOINT regex — \b...\b only for identifier-style
   symbols; path-style symbols ('./entity-analysis-service', '@scope/pkg')
   use plain content.includes() since \b doesn't match around . / @ chars.

D2b prisma-calls: preserve source casing in code_reference.symbol
   (prisma.articleEmbedding, not prisma.articleembedding); raw-SQL
   connections now store the literal table name as the symbol so the
   audit verifier can find it in source.

E2E on atomize-ai: 4.21% defect rate → 0%; verdict reject → accept.
404 tests pass (393 + 11 new). Bench-repo characterization snapshot
unchanged. Zero new deps.
```

## Verification recipe (reproducible)

```bash
cd ~/dev/git-folder/NavGator
npm test                              # 404 pass
npm run build:cli                     # exit 0

cd ~/dev/git-folder/atomize-ai
node ~/dev/git-folder/NavGator/dist/cli/index.js scan --full
python3 -c "
import json
with open('.navgator/architecture/timeline.json') as f:
  e = json.load(f)
for ent in reversed(e['entries']):
  a = ent.get('audit')
  if a:
    print(a['verdict'], a['defect_rate'], a['by_class'])
    break
"
# → accept 0.0 (all classes 0 defects)
```
