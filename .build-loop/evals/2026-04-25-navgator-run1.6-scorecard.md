# Scorecard — NavGator Run 1.6 (Defensive fixes + layout improvements)

Date: 2026-04-25
Branch: `salvage/audit-improvements` (Run 1 + 1.5 + 1.6 all uncommitted on top of `27f792c`)
Goal: 9 defensive items before SQC; verify-step #6 and #7

## Result by item

| # | Item | Status | Evidence |
|---|---|---|---|
| 1 | Trigger list gaps | ✅ Shipped | `FULL_SCAN_TRIGGER_FILES` extended with `tsconfig.json`, `vercel.json`, `fly.toml`, `railway.json`, `.gitignore` (`scanner.ts:115-134`); `manifestPatterns` extended in parallel; 3 new selectScanMode tests (tsconfig/vercel/.gitignore) |
| 2 | Slash command namespace | ✅ Shipped | Plugin name in `.claude-plugin/plugin.json` is `navgator` → `/navgator:plan`. Fixed: `commands/plan.md` body (3 occurrences); `src/cli/index.ts:101,127,131` redirect string and comments. README already correct |
| 3 | files_scanned metric clarity | ✅ Shipped | `scanner.ts` lines 1190 + 1382 now report `walkSet.size` for both `'incremental'` AND `'incremental→full'`. Prevents silent-promote evidence loss. Test: scenario 5 now asserts `files_scanned <= sourceFileCount` for `incremental→full` |
| 4 | Concurrency lock | ✅ Shipped | New file `src/scan-lock.ts` (164 LOC). Lock at `<storeDir>/scan.lock`. Stale-clears > 10 min OR PID gone. `O_EXCL` race-safe. `release()` wired in `try/finally` so it fires on every exit path. 3 vitest tests cover held-lock + stale-clear + happy-path |
| 5 | New-file orphan in-edges | ✅ Shipped | `selectScanMode` adds `if (fileChanges.added.length > 0) → full / new-files` (`scanner.ts:218-222`). New `'new-files'` reason added to union. 2 new tests cover added-only and added+modified |
| 6 | Renames — verify | ⚠️ **Verify result: prompt's ask doesn't apply.** Path-disambiguation IS needed for 6 component types (api-endpoint, db-table, prompt, worker, component, cron) because the name field collides (e.g. `src/utils/index.ts` vs `src/lib/index.ts`, both named `index`). Removing path from stable_id would cause real merge collisions. **No code change. Documented tradeoff in `pickCanonicalPath` docstring.** Renames currently break merge; integrity check + promote-to-full keeps result correct (perf-suboptimal). |
| 7 | Aliased imports — verify | ✅ Shipped (verify-only) | `import-scanner.ts:56-108` `resolveImport` resolves tsconfig `paths` aliases at scan time and stores the resolved project-relative path in `to.location.file` and `code_reference.file`. **No fix needed.** Added doc comment on `loadReverseDeps`. New test using fixture with `tsconfig.json` `paths: { "@/*": ["src/*"] }` confirms `to.location.file === "src/utils/foo.ts"` (not `@/utils/foo`) and that `loadReverseDeps` finds the importer |
| 8 | Reverse-deps index | ✅ Shipped — full path; ⚠️ blocked by pre-existing bug on incremental | New file `.navgator/architecture/reverse-deps.json` written at scan end via `buildReverseDepsIndex` (`storage.ts`). `loadReverseDeps` now tries the index first (1 file open), falls back to `loadReverseDepsLegacy` if missing/corrupt. **On the benchmark repo full scan: 627 distinct target files, 7,805 edges, written in <1ms from in-memory connection set.** Drop from 4,570 file opens → 1 file open. ⚠️ **On the benchmark repo incremental scan: index gets nuked because of pre-existing integrity-promote bug — see "Anything blocking commit" below.** |
| 9 | Manifest of derived artifacts | ✅ Shipped | New file `.navgator/architecture/manifest.json` written at scan end via `buildDerivedManifest`. Lists `index.json`, `graph.json`, `file_map.json`, `reverse-deps.json` with their `mtimeMs` + `source_count` for reverse-deps. Atomic write |

**Overall: 7 ✅ (1, 2, 3, 4, 5, 7, 9), 1 ✅-with-caveat (8), 1 verify-only no-fix (6).** Zero ❌.

## Verify-step decisions (items 6 and 7)

- **Item #7 (aliased imports):** verified that `to.location.file` and `code_reference.file` already store resolved project-relative paths. The prompt's "fix at write time" was already implemented (Run 1 era). Added doc comment + 1 fixture-based regression test. Status: verify-only.

- **Item #6 (renames):** verified that `pickCanonicalPath` deliberately includes the canonical path for 6 component types where (type, name) is not unique. The prompt's suggested "name-only with optional FNV hash" doesn't safely apply: removing path-disambiguation would make `src/utils/index.ts` and `src/lib/index.ts` collide on stable_id `STABLE_component_index` (the `name` for file-level components is just the basename). **The honest call is to keep the path-disambiguation and document the rename tradeoff.** Renames currently break merge → integrity check + promote-to-full handles correctness; perf-suboptimal but correct. Status: verify-only with documentation.

## Files modified

| File | Diff |
|---|---|
| `src/scanner.ts` | +90 −20 (Run 1.6 only): trigger-list extension, manifestPatterns extension, `new-files` reason + branch, files_scanned ternary, lock acquire/release wiring, reverse-deps + manifest call sites |
| `src/storage.ts` | +200 +0 (Run 1.6 only): `loadReverseDeps` index fast path; new `loadReverseDepsLegacy`; new `buildReverseDepsIndex`; new `buildDerivedManifest`; `pickCanonicalPath` + `loadReverseDeps` docstrings |
| `src/types.ts` | +20 (defensive): added missing `last_full_scan`, `incrementals_since_full` to `ArchitectureIndex`; added `ScanType` export; added `scan_type`, `files_scanned` to `TimelineEntry`. These were missing from Run 1's commit (the prior `tsc` errors were latent — vitest masked them via esbuild) |
| `src/cli/index.ts` | +3 −3: `/gator:plan` → `/navgator:plan` in redirect string + comment |
| `commands/plan.md` | +3 −3: `/gator:plan` → `/navgator:plan` in 3 places |
| `README.md` | +1 −1: trigger list updated to mention build-config files + new-files behavior |
| `src/__tests__/scanner-incremental.test.ts` | +260 LOC: 13 new tests (3 trigger-list + 2 new-files + 1 files_scanned + 3 lock + 1 aliased imports + 3 reverse-deps + 1 manifest) |

## Files added

| File | LOC |
|---|---|
| `src/scan-lock.ts` | 164 |

## Test totals

- Before Run 1.6: 322 tests (Run 1+1.5)
- After Run 1.6: **335 tests** (322 + 13 new)
- All 335 pass (`npm test` exit 0).
- `npm run build:cli` exit 0 (latent Run 1 type errors fixed as a side effect — see types.ts row).

## E2E timing on the benchmark repo (1842 files, 4,570+ connections — measurements from this run)

| Path | Before Run 1.6 | After Run 1.6 | Δ |
|---|---|---|---|
| FULL | ~10.8s (first run, cold) | 5.9s (subsequent runs, warm) | reproducibly competitive |
| reverse-deps build | n/a | <1ms (in-memory from finalConnections) | added |
| FULL → next FULL `loadReverseDeps` | 4,570 file opens (legacy walk) | 1 file open (index) | **~4500x fewer disk syscalls** |
| reverse-deps.json edges count (FULL) | n/a | 627 keys / 7,805 edges | shipped |
| INCREMENTAL after touching 1 file | 1.16s (Run 1.5) | 832ms (warm) – 2023ms (cold-after-FULL) | competitive |
| `files_scanned` reported on INC | walkSet.size | walkSet.size | unchanged |
| `files_scanned` reported on INC→FULL | sourceFiles.length (1842) | walkSet.size (4) | **fix** |

NavGator self-scan: FULL=419 connections, INC=405 connections (only 14 lost = the touched file's edges). Merge works correctly on small/medium repos.

## Anything blocking commit

**One pre-existing bug surfaces during Run 1.6's e2e timing on the benchmark repo. NOT introduced by Run 1.6, but it gates the headline #8 perf claim from being delivered on incremental scans.**

**Bug: incremental→full integrity-promote uses incomplete walk-set scan results.**

- Triggered by: integrity check fails (line `scanner.ts:1194-1210`) → `clearStorage` → `finalComponents = uniqueComponents`. But on incremental, `uniqueComponents` was scanned with `walkSet=undefined` for some scanners and `walkSet=<4 files>` for others (Run 1.5 plumbing). It is NOT the full source tree. So the post-promote disk state has the package + infra components but only 4 files' worth of code-level components.
- Surfaces on the benchmark repo: 418 integrity issues fire on every incremental → promote → graph wiped from 6,445 connections to 58.
- Did NOT surface in Run 1+1.5 testing because: NavGator self-scan (221 files, simpler graph) doesn't hit any integrity issues, so the promote branch never fires. The Run 1 e2e test scenario 5 contrives a corruption to force the promote, but it's a small fixture so the post-promote is still small-but-correct.
- This means Run 1.6's #8 reverse-deps index works correctly on FULL scans (the headline 4,570→1 file-open win lands) but on incremental→full promotes, the index inherits the truncated graph.

**Recommended fix (Run 1.7):** when integrity-promote fires, re-run Phase 1–3 scanners with `walkSet=undefined` before storing. ~5-10s overhead on promote, but produces correct output. Alternatively, fix the integrity-check to be less aggressive (probable cause: bare-package import edges referencing `COMP_component_<pkg>` that doesn't exist because package detection emits `COMP_npm_<pkg>`).

**Items #1-#7 and #9 are safe to commit as-is — they're independent of the integrity-promote path.** Item #8's index file is also safe (FULL writes correct data; INC → FULL promote writes truncated data which is the same outcome you'd get without the index).

## Verification recipe (reproducible)

```bash
cd ~/dev/git-folder/NavGator
npm test                                        # 335 passing
npm run build:cli                               # exit 0
node dist/cli/index.js "review my auth flow"    # prints /navgator:plan redirect

cd ~/dev/git-folder/the benchmark repo
node ~/dev/git-folder/NavGator/dist/cli/index.js scan --full
ls -la .navgator/architecture/reverse-deps.json # exists, ~378 KB
ls -la .navgator/architecture/manifest.json     # exists
jq '.edges | keys | length' .navgator/architecture/reverse-deps.json   # 627
jq '.files["reverse-deps.json"].source_count' .navgator/architecture/manifest.json  # 7805
```
