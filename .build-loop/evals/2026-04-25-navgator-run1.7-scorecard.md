# Scorecard — NavGator Run 1.7 (Bug fix on top of Run 1+1.5+1.6)

Date: 2026-04-25
Branch: `salvage/audit-improvements`
Builds on: commit `06b0ca8` (Run 1+1.5+1.6 foundation)
Goal: fix integrity-promote graph truncation (Problem A) + dedup-key collision (Problem B)

## Result

| # | Item | Status | Evidence |
|---|---|---|---|
| A | Integrity-promote graph truncation | ✅ Fixed | Recursive re-entry via `scan(root, {mode:'full', clearFirst:true, _promotedFromIncremental:true})`. Outer scan releases lock before re-entry; inner scan acquires cleanly. Inner labels timeline `scan_type='incremental→full'`. E2E on atomize-ai: post-promote graph is 2463 components / 6445 connections — identical to clean full-scan baseline. **No truncation.** |
| B | Dedup-key cross-type collision | ✅ Fixed at root | Dedup key changed from `component.name` to `${type}\|${name}\|${primary-config-file}` in `scanner.ts:1037-1066`. Different types coexist (was: collided); same-type same-name from different paths coexist (e.g. `app/proxy.ts` and `proxy.ts`); same-type same-name same-file still dedupes. atomize-ai missing-endpoint count: **418 → 0**. |
| C | Latent merge-orphan disk files | ✅ Fixed (uncovered by A+B) | `clearForFiles` only deletes disk files whose `source.config_files` overlap walk-set, so npm/database/infra components survived but new fresh versions got new random `component_id`s, doubling on-disk components. Pre-fix this was masked by always-failing integrity check (`clearStorage` on promote wiped orphans). Post-fix, added an orphan-purge pass after merge in `scanner.ts` (~25 LOC inline helper). atomize-ai INC: 2891 → 2462 components (proper count). |

## Files modified

| File | Diff | Notes |
|---|---|---|
| `src/scanner.ts` | +147 / −20 | Recursive re-entry promote (Problem A); dedup-key fix (Problem B); orphan-disk-files purge (latent C); files_scanned ternary updated to use `decision.mode` (the effective scan mode) instead of `scanType` (the user-visible label) so a recursive promote with walkSet still populated reports `sourceFiles.length` |
| `src/types.ts` | +37 | Added `ScanType` export, `last_full_scan` + `incrementals_since_full` on `ArchitectureIndex`, `scan_type` + `files_scanned` on `TimelineEntry`. **These were claimed shipped in Run 1.6 scorecard but not actually committed** — vitest masked the latent `tsc` errors via esbuild. Adding them is required for `npm run build:cli` to exit 0. |
| `src/__tests__/scanner-incremental.test.ts` | +183 | 3 new tests: (1) integrity-promote no-truncation E2E with disk-corruption fixture; (2) Problem B fixture with `lib/prisma.ts` + npm package `prisma` — both kept; (3) regression that single-source-file dedup still works |

## Files added

| File | LOC |
|---|---|
| `.build-loop/issues/run1.7-package-edge-typing.md` | 39 — open issue placeholder; resolved as side-effect of Problem B fix; documented for future regressions |

## Test totals

- Before Run 1.7: **335** tests (Run 1+1.5+1.6 baseline)
- After Run 1.7: **338** tests (335 + 3 new) — all pass
- `npm run build:cli` exit 0
- All 25 test files pass

## E2E result on atomize-ai (1842 source files)

| Path | Before Run 1.7 | After Run 1.7 |
|---|---|---|
| FULL scan | 2452 components / 6445 connections / 418 orphan endpoints | **2463 / 6445 / 0** |
| INCREMENTAL (touched 1 file, no integrity fail) | not reachable — always failed integrity | **2462 / 6457 / 0** |
| INC→FULL promote (forced via corrupted connection) | 58 components / 58 connections (truncated) / `scan_type='incremental→full'` | **2463 / 6445 / 0** matches FULL baseline · `scan_type='incremental→full'` · `files_scanned=1842` |

`files_scanned` reporting on the recursive-re-entry promote: now uses `decision.mode === 'incremental'` as the gating predicate (not `scanType`), so the inner full scan reports `sourceFiles.length` (1842) instead of misleading walk-set size of the still-populated `changedSet` (1).

## Hard-constraint check

- Zero new runtime npm deps ✅ (`package.json` untouched)
- No external LLM API ✅
- All 335 baseline tests still pass ✅ (now 338)
- No regression in Run 1+1.5+1.6 functionality ✅ — atomic writes intact (storage.ts unmodified), lockfile intact (scan-lock.ts unmodified), walk-set plumbing intact, characterization snapshot still relevant (full-scan output bit-identical), planner agent untouched
- No scope creep ✅ — Phase 5/6 optimizations, SQC audit, parallel workers, EWMA all skipped

## Anything blocking commit

Nothing. Default flow: user reviews and commits. Suggested commit message:

```
fix(scanner): integrity-promote no longer truncates graph; dedup keys by (type, name, file) (run 1.7)

- Problem A: recursive re-entry on integrity failure preserves full graph
- Problem B: dedup-by-name collided cross-type (lib/prisma.ts ↔ Prisma DB)
- Fix latent merge-orphan: orphan-purge after incremental merge

E2E on atomize-ai (1842 files): integrity-promote now produces 2463 components /
6445 connections — identical to full-scan baseline (was: truncated to 58/58).

338 tests pass (335 + 3 new). Zero new deps.
```

## Verification recipe (reproducible)

```bash
cd ~/dev/git-folder/NavGator
npm test                                  # 338 pass
npm run build:cli                         # exit 0

cd ~/dev/git-folder/atomize-ai
rm -rf .navgator/architecture
node ~/dev/git-folder/NavGator/dist/cli/index.js scan --full
ls .navgator/architecture/components | wc -l    # 2463
ls .navgator/architecture/connections | wc -l   # 6445

# Forced integrity-promote: corrupt one connection, touch one file
python3 -c "
import json,glob
for f in glob.glob('.navgator/architecture/connections/CONN_*.json'):
    with open(f) as h: d=json.load(h)
    if 'types/contracts/api' not in d.get('code_reference',{}).get('file',''):
        d['to']['component_id']='COMP_bogus_zzz'
        with open(f,'w') as h: json.dump(d,h,indent=2); break
"
echo '// touch' >> types/contracts/api.ts
node ~/dev/git-folder/NavGator/dist/cli/index.js scan
# scan_type=incremental→full · files_scanned=1842
ls .navgator/architecture/components | wc -l    # 2463 — IDENTICAL to baseline
ls .navgator/architecture/connections | wc -l   # 6445 — IDENTICAL to baseline
git checkout types/contracts/api.ts
```
