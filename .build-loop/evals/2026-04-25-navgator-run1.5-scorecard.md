# Scorecard — NavGator Run 1.5 (per-scanner walk-set plumbing)

Date: 2026-04-25
Branch: `salvage/audit-improvements` (Run 1 changes preserved, uncommitted)
Goal: plumb `walkSet?: Set<string>` through every source-walking scanner so incremental mode is materially faster than full

## Result by criterion

| # | Criterion | Status | Evidence |
|---|---|---|---|
| C1 | Existing tests pass (320) | Pass | `npm test` → 322 passed (320 prior + 2 new). All Run 1 tests green |
| C2 | Build passes | Pass | `npm run build:cli` exit 0, no type errors |
| C3 | Walk-set plumbed in N scanners | Pass | 10 scanner functions updated (see list below) |
| C4 | Characterization snapshot still passes | Pass | Bit-identical full-scan output verified — `walkSet=undefined` short-circuits to unmodified glob result in every scanner |
| C5 | New test asserts walk-set restriction | Pass | 2 new tests in `scanner-incremental.test.ts`: spy on `fs.promises.readFile` confirms restricted reads < full reads; empty walk-set in `scanWithAST` returns empty result without errors |
| C6 | CLI redirect still works | Pass | `node dist/cli/index.js "review my auth flow"` prints redirect, exit 0 |
| C7 | No new runtime deps | Pass | `git diff package.json` empty |
| C8 | Run 1 changes preserved | Pass | `clearForFiles`, `mergeByStableId`, atomic writes, mode selector, planner agent, slash command, CLI redirect, schema 1.1.0 — all intact |
| C9 | Incremental >= 40% faster on NavGator self-scan | **Fail (honest)** | full=309ms, incremental=367ms over 3 runs (median). Incremental is ~19% **slower**. Bottleneck is NOT scanner CPU — see analysis below |

**Overall: 8 Pass, 1 Fail (with documented root cause).** No iterate — the goal explicitly asked for honest data over hitting the target dishonestly.

## Why <40% (and why incremental is currently slower)

Profiled both modes via `dist/scanner.js` direct invocation (median of 3 runs):

| Phase | Full (ms) | Incremental (ms) | Δ |
|---|---|---|---|
| Mode + walk-set + reverseDeps load | 82 | 68 | -14 (faster, prior state already on disk) |
| Phase 1-3 scanners (where walkSet helps) | 9 | 7 | -2 (modest) |
| Phase 3.5 classify connections | 73 | 30 | **-43** (fewer connections) |
| Phase 4 storage writes | 2 | 1 | 0 |
| Phase 5 architecture diff | 53 | 100 | **+47** |
| Phase 6 hash save | 99 | 123 | **+24** |
| **Total** | **309** | **367** | **+58 (slower)** |

The walk-set restriction does its job — Phase 1-3 scanner CPU drops from 9ms to 7ms and Phase 3.5 classification drops from 73ms to 30ms (combined savings ~45ms). But Phase 5 (architecture diff against prior state) and Phase 6 (saving hashes after merging old + new) each cost an extra ~24-47ms in incremental mode, swallowing the savings.

Honest take: on this 221-file repo the scanner CPU is too small for walk-set restriction to matter. Incremental's fixed-cost overhead (loading prior connections to compute reverseDeps, computing the diff against prior state, merging stable_ids, regenerating file_map and hashes covering all files for next run) is in the same league as the savings. The **walk-set plumbing IS correct and IS reducing scanner CPU** — the wall-time win simply doesn't surface until the repo is large enough that scanner CPU dominates the fixed costs.

Where this WILL win:
- Repos with thousands of source files (where Phase 1-3 scanner walks dominate the budget)
- ts-morph-heavy projects that run `scanWithAST` (currently disabled at default; --useAST enables it). ts-morph parsing of every TS file is the largest CPU cost in NavGator scanning, so restricting to walk-set has the biggest impact there.
- Swift codebases with hundreds of `.swift` files (scanSwiftCode reads all of them)

Where it does NOT win on NavGator's 221-file self-scan:
- Default regex-only mode runs in ~9ms total for Phase 3 scanners — nothing to optimize.
- Phase 5/6 dominate, and they're inherently incremental-only work.

## Files modified

| File | Diff |
|---|---|
| `src/scanner.ts` | +13 -3 (incWalkSet helper + 11 call-site updates) |
| `src/scanners/connections/ast-scanner.ts` | +18 -10 (scanWithAST + scanDatabaseOperations) |
| `src/scanners/connections/llm-call-tracer.ts` | +9 -2 |
| `src/scanners/connections/prisma-calls.ts` | +6 -1 |
| `src/scanners/connections/service-calls.ts` | +9 -3 |
| `src/scanners/infrastructure/cron-scanner.ts` | +13 -7 (scanCronJobs + findCodeCrons) |
| `src/scanners/infrastructure/env-scanner.ts` | +12 -5 (scanEnvVars + findEnvReferences) |
| `src/scanners/infrastructure/field-usage-analyzer.ts` | +12 -5 (scanFieldUsage + collectSourceFiles) |
| `src/scanners/infrastructure/queue-scanner.ts` | +11 -4 (scanQueues + findQueueDefinitions) |
| `src/scanners/prompts/detector.ts` | +9 -3 (scanProject) |
| `src/scanners/prompts/index.ts` | +3 -2 (scanPrompts wrapper) |
| `src/scanners/swift/code-scanner.ts` | +9 -2 (scanSwiftCode) |
| `src/__tests__/scanner-incremental.test.ts` | +52 -1 (2 new walk-set tests, vi import) |

12 source files changed in `src/`, 1 test file extended.

## Scanners deferred (and why — per plan)

| Scanner | Reason |
|---|---|
| `scanDeployConfig` | Manifest-driven (vercel.json/railway.json). Mode selector forces full when these change. No source walk |
| `scanPrismaSchema` | Reads only `prisma/schema.prisma`. Mode selector forces full on schema change |
| `scanInfrastructure` (orchestrator) | Delegates to the manifest detectors above |
| `scanTypeSpecValidation` | Opt-in feature flag, rarely used. Could be added later |
| `packages/{npm,pip,swift}.ts` | Manifest readers. Mode selector forces full on lockfile/manifest change |
| `pbxproj-parser`, `storyboard-scanner` | Bound by Xcode project file membership, not source-file walk |
| `scanPromptLocations` (in service-calls.ts) | Exported but not invoked from active scanner.ts call path |

## Anything blocking commit

Nothing functional. The walk-set plumbing is correct, bit-identical for full scans (regression-locked by characterization snapshot), and verified by 2 new unit tests. The only thing not delivered is the >=40% wall-time speedup — the goal explicitly permitted honest data with bottleneck analysis instead.

Recommendations for the user:
1. The walk-set work is done correctly and ships value on larger repos and `--useAST` mode. NavGator's 221-file self-scan is below the size where this kind of optimization can win.
2. To see incremental speedup on NavGator itself, the next investment is in Phase 5/6 (diff against prior state, hash save) — both currently rebuild full-graph state regardless of walk-set. Consider lazy/partial diff and per-file hash updates instead of full hashes.json regeneration. Out of scope for Run 1.5.
3. Run 1 + Run 1.5 changes are 13 source files modified, 0 deps added, all tests green. Safe to commit when ready.

## Verification recipe (reproducible)

```bash
cd ~/dev/git-folder/NavGator
npm test                                      # 322 passing
npm run build:cli                             # exit 0
rm -rf .navgator/architecture
node dist/cli/index.js scan --full            # FULL_BASELINE ~309ms internal
echo "// touch" >> src/types.ts
time node dist/cli/index.js scan              # INCREMENTAL ~367ms internal
git checkout src/types.ts
```
