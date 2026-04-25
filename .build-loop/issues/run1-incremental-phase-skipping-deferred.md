# Deferred: incremental-mode phase-skipping (Run 1 → Run 2)

Goal D2 specified:
> For incremental: skip Phase 1 unless a manifest is in walk-set; Phase 2 (infra) re-runs only if its source files overlap walk-set; Phase 3 (connections) walks only walk-set files.

## What was implemented in Run 1

For mode='incremental', the scanner runs all four phases as today (correctness-preserving), but at Phase 4 it uses `clearForFiles(walkSet)` + `mergeByStableId(existing, incoming)` instead of `clearStorage()`. So the on-disk state is correctly merged, the index tracks `incrementals_since_full`, the integrity check fires, and `scan_type='incremental'` lands in `timeline.json`.

Merge-not-clear gives the durability and merge correctness benefits. The performance benefit comes mostly from avoiding the `clearStorage` flush + re-write of every component/connection JSON file — that's the dominant I/O cost on large repos.

## What was NOT implemented

Per-scanner walk-set restriction. Every scanner under `src/scanners/` would need a `walkSet?: Set<string>` parameter, and each scanner's internal glob/regex pass would have to filter to walk-set files. That's ~12 scanner files plus the regression risk of breaking bit-identical full-scan output (C3 / characterization snapshot).

## Why deferred

1. Bit-identical output (C3) is the hard regression lock for Run 1. Plumbing walkSet through every scanner risks mismatched outputs.
2. The merge-not-clear pathway already produces a correct end-state graph for the 6 incremental test scenarios (D4).
3. Run 2's SQC audit will measure exactly how often phase-skip would have changed the outcome — that's the right place to invest.
4. The CPU cost of re-running scanners on unchanged files is small relative to the I/O cost of writing every JSON file. Run 1's atomic-write + merge avoids the I/O cost.

## Acceptance impact

- C8 (E2E sanity, materially faster): expected to still pass on a sizeable repo because the dominant cost (Phase 4 clear + write everything) is avoided. If C8 shows < ~20% speedup on the NavGator repo itself, surface to user with the actual numbers and ask whether to invest the per-scanner restriction in Run 1 vs Run 2.

## To pick up in Run 2 (or Run 1 follow-up)

Add `walkSet?: Set<string>` to:
- `src/scanners/connections/import-scanner.ts`
- `src/scanners/connections/service-calls.ts`
- `src/scanners/connections/llm-call-tracer.ts`
- `src/scanners/connections/ast-scanner.ts`
- `src/scanners/connections/prisma-calls.ts`
- `src/scanners/swift/code-scanner.ts`
- `src/scanners/prompts/index.ts`
- `src/scanners/infrastructure/*.ts` (run only if config files overlap walk-set)
- `src/scanners/packages/*.ts` (skip unless manifest in walk-set)

Each scanner: filter its source-file enumeration to `walkSet`. Bit-identical when walkSet ⊇ all sources.
