# Plan — NavGator Run 1.7 (bug fixes)

## Problem A — integrity-promote graph truncation

**Root cause:** When integrity check fails on incremental, `scanner.ts:1207-1208` reuses the just-scanned `uniqueComponents`/`uniqueConnections`. But on incremental, those scanners ran with `incWalkSet` restriction, so the in-memory result is walk-set-only, not full-tree.

**Fix path: recursive re-entry via `scan()` itself.**

- When integrity fails, release the lock, then call `scan(root, { ...options, clearFirst: true, mode: 'full', incremental: false })` and return its result with `scan_type` overridden to `'incremental→full'` in stats and timeline (Run 1.6 #3 contract).
- Recursive over inline pipeline-extraction: ~30 LOC vs ~500 LOC refactor; reuses tested code path verbatim.
- Lock dance: release before recursive call; re-acquire inside recursive `scan()`.

**Test:** force integrity failure via bogus on-disk connection record, run incremental scan, assert post-scan graph >= full-scan baseline.

## Problem B — `imports` edges to dropped file components

**Root cause (diagnosed on atomize-ai):** 410 of the 418 missing-endpoint connections are NOT bare-package issues. They're `imports` edges whose target file-component was dropped by `scanner.ts:1037-1045` dedup-by-name. `lib/prisma.ts` produces file-component named `prisma`; Prisma database scanner ALSO produces a component named `prisma` (higher confidence). Dedup-by-name drops the file component. Import-scanner already emitted edges referencing the dropped id.

Distribution:
- 392 → `COMP_component_prisma_c3se` (file `lib/prisma.ts` collides with Prisma DB)
- 12  → `COMP_component_redis_z5xv` (file collides with Redis infra)
- 8   → `COMP_npm_*` (genuine bare-package mismatch — different cause, deferred)

**Fix:** change dedup key from `component.name` to `${component.type}|${component.name}`. ~3 LOC. Different types should never collide.

Safe because:
- Same-type same-name still dedupes (semantic preserved).
- Cross-type same-name now both kept — which is what the downstream stable_id merge expects (Run 1.6 verify #6).

**Defer:** the 8 genuine bare-package mismatches go to `.build-loop/issues/run1.7-package-edge-typing.md`. Different cause (likely id reassignment between package-detection runs); needs separate investigation, out of scope.

**Test:** fixture with same-name different-type components → both kept; same-name same-type → still dedupes (regression).

## Execute plan

Single subagent, sequential edits, three new tests in `scanner-incremental.test.ts`. No parallel — both fixes touch the same file regions, and the changes are small enough that sequential is faster than coordination.

## Review plan

- Critic on diff
- `npm test` (335+ pass), `npm run build:cli` exit 0
- E2E on atomize-ai: full scan → touched-file incremental → post-scan counts within ±5% of full-scan baseline (2452 components, 6445 connections)
- Confirm 0 missing-endpoint edges target `COMP_component_prisma*` or `COMP_component_redis*` (both fixed by B)
- Fact-check + simplify + report
