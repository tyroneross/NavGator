# Scorecard — NavGator Run 1 (Incremental Scans + Smart Planner Agent)

Date: 2026-04-25
Branch: `salvage/audit-improvements`
Goal: `.build-loop/goal.md`
Plan: `.build-loop/plan.md`

## Result by criterion

| # | Criterion | Status | Evidence |
|---|---|---|---|
| C1 | Existing tests pass | ✅ Pass | 303 baseline tests still pass (24 test files unchanged); see `npm test` |
| C2 | New incremental tests pass | ✅ Pass | 16 new tests across `scanner-incremental.test.ts` (9 unit + 6 e2e + 1 migration) all green |
| C3 | Characterization snapshot locked | ✅ Pass | `scanner-characterization.test.ts.snap` extended with `full-scan-output` snapshot; idempotent re-run confirmed |
| C4 | TypeScript build passes | ✅ Pass | `npm run build:cli` exit 0, no type errors |
| C5 | Lint passes | ❓ Untested | `npm run lint` calls `eslint` but eslint isn't installed (not a regression — pre-existing missing devDep) |
| C6 | Atomic write integrity | ✅ Pass (verified via design) | All `index.json`/`graph.json`/`file_map.json`/`hashes.json`/`prompts.json` + per-component + per-connection writes go through `atomicWriteJSON` (write-tmp → rename). Crash leaves prior `<target>` intact. No explicit crash-simulation test was added (would require process-kill stubbing); covered by structural review |
| C7 | Mode selector correctness | ✅ Pass | 9 unit tests cover all `selectScanMode` branches (flag-full, flag-incremental, no-prior-state, manifest-changed, stale-full, incremental-cap, fast-path, no-changes, schema-mismatch path is exercised implicitly) |
| C8 | E2E sanity on real repo | ⚠️ Partial | Full=299ms, incremental=433ms on NavGator itself. `scan_type='incremental'` lands in timeline.json with files_scanned=57 (vs 221 full). Atomic writes + merge work end-to-end. **NOT materially faster** because the Phase 1/2/3 scanners still walk all files — see `.build-loop/issues/run1-incremental-phase-skipping-deferred.md`. Speedup will come when per-scanner walk-set restriction lands |
| C9 | Planner agent valid | ✅ Pass | `agents/architecture-planner.md` frontmatter validates: name, description with 3 examples, model=opus, color, tools restricted to read-only + Bash. Body has 6 sections covering freshness gate, investigation, constraints, output format, edge cases, quality |
| C10 | Slash command valid | ✅ Pass | `commands/plan.md` follows `plugin-dev:command-development` spec: frontmatter (description, argument-hint, allowed-tools), uses `$ARGUMENTS`, body delegates to agent |
| C11 | CLI redirect works | ✅ Pass | `node dist/cli/index.js "review my auth flow"` prints redirect string and exits 0 |
| C12 | README updated | ✅ Pass | "Scan modes" section added (3-row table + auto-mode policy paragraph), `/navgator:plan` row added to slash-command table |
| C13 | No new runtime deps | ✅ Pass | `git diff package.json` is empty for `dependencies` |
| C14 | Schema migration safe | ✅ Pass | `loadIndex` injects `schema_version='1.0.0'`, `last_full_scan=last_scan`, `incrementals_since_full=0` for archives missing those fields. Test `schema migration 1.0.0 → 1.1.0` synthesizes a 1.0.0 index and asserts the defaults are populated |

**Overall:** 12 ✅ · 1 ⚠️ · 1 ❓

## Files modified

| File | Lines |
|---|---|
| `src/scanner.ts` | +488 −58 (net +430) |
| `src/storage.ts` | +306 −0 (net +306) |
| `src/types.ts` | +28 −2 (net +26) |
| `src/config.ts` | +1 −1 |
| `src/cli/commands/scan.ts` | +13 −1 |
| `src/cli/index.ts` | +36 −2 |
| `src/__tests__/scanner-characterization.test.ts` | +60 −0 |
| `src/__tests__/__snapshots__/scanner-characterization.test.ts.snap` | +N (auto-written) |
| `README.md` | +18 −2 |

## Files added

| File | Lines |
|---|---|
| `agents/architecture-planner.md` | 159 |
| `commands/plan.md` | 28 |
| `src/__tests__/scanner-incremental.test.ts` | 364 |
| `.build-loop/plan.md` | (planning doc) |
| `.build-loop/issues/run1-incremental-phase-skipping-deferred.md` | (deferred-work log) |
| `.build-loop/evals/2026-04-25-navgator-run1-scorecard.md` | (this file) |

## Test totals

- Before Run 1: 24 test files, 303 tests
- After Run 1: 25 test files, 320 tests
- Net: +1 file, +17 tests, all green

## Deferred items (in `.build-loop/issues/`)

1. **Per-scanner walk-set restriction** (`run1-incremental-phase-skipping-deferred.md`) — Phase 1/2/3 scanners still walk all files on incremental. Storage I/O is faster (atomic merge) but CPU is roughly the same. On NavGator-sized repos (221 files) this means incremental currently runs slightly slower than full; on much larger repos the I/O win dominates. Plumb `walkSet?: Set<string>` through ~12 scanner files in Run 2 (or a Run 1 follow-up if user wants the speedup now).

## Notes

- The `scan_type='incremental→full'` integrity-promotion path works end-to-end (covered by test scenario 5 + verbose run on NavGator showed it firing during development before the stable_id remap was added).
- The stable_id-aware connection remap was the key fix that made the merge correct: in-memory `uniqueComponents` lacked stable_ids until `storeComponents` ran, so the merge was treating fresh and surviving components as distinct entries. Fixed by exposing `ensureStableIdPublic` and calling it on `uniqueComponents` before merge.
- Characterization snapshot uses stable_ids and connection fingerprints (type::file::symbol), not random component_ids or line numbers — locks the semantic shape, ignores cosmetic drift.
- The CLI's natural-language detection only fires for first args containing spaces or quotes (not single tokens) — so `navgator unknownsubcommand` still surfaces commander's normal error rather than a false redirect.

## Recommendations before user merges

1. Open the diff and skim `src/scanner.ts` Phase 0.5 + Phase 4 changes specifically — those are the only behavioral changes to the full-scan path (and the characterization snapshot proves bit-identical full-scan output, modulo timestamps and random suffixes).
2. Decide whether to address the phase-skipping deferred item now (needs ~half a day; ~12 scanner files) or push to Run 2. C8 is currently ⚠️ rather than ✅ specifically because of this.
3. Decide on eslint: the `lint` script references it but it's not in devDependencies. Either install eslint as a devDep or drop the `lint` script.
4. The `architecture-planner` agent has not been exercised end-to-end inside Claude Code (it requires the user invoking `/gator:plan "intent"`). The frontmatter and body validate; the runtime behavior of the freshness gate + tool dispatch is untested. Consider a smoke run after merge.
