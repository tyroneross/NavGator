# Deferred: phase-level incremental scanner skipping

Goal D2 originally specified:

> For incremental: skip Phase 1 unless a manifest is in walk-set; Phase 2 (infra) re-runs only if its source files overlap walk-set; Phase 3 (connections) walks only walk-set files.

## Current state (2026-07-09)

The old note said every scanner still walked the full project and that
`clearForFiles(walkSet)` made the merge correct. Both statements became stale.

Implemented now:

- Connection, field-usage, environment, queue, cron, Swift, Rust, prompt, and
  related code scanners receive the incremental walk-set. The import scanner
  receives the complete source universe so unchanged local targets still
  resolve, then its returned connections are filtered to walk-set origins.
- Incremental storage partitions the prior canonical state in memory by
  normalized source ownership, then merges rescanned state. Correctness no
  longer depends on per-entity files or `clearForFiles` deleting records.
- `clearForFiles` is retained only as physical cleanup for the optional legacy
  per-entity layout.
- Package/lockfile and root or nested `tsconfig.json`/`jsconfig.json` changes
  are tracked and force a full scan where module/dependency resolution can
  change globally.
- Incremental-to-full integrity promotion reuses the active owner-safe scan
  lease, so promotion does not create a second writer window.

## Still deferred

True phase-level scheduling remains incomplete. Package and some infrastructure
detectors still run during an otherwise incremental scan even when none of
their owning manifests/config files changed. Completing this is a performance
optimization, not a storage-correctness prerequisite.

Before skipping more work, each remaining detector needs an explicit source
ownership contract and a focused equivalence test proving:

1. Incremental output normalized by stable identity equals a subsequent full
   scan.
2. Deletions disappear from returned state and every canonical derived file.
3. Manifest/config changes bypass the skip and trigger the required rescan.
4. Full-scan characterization output remains unchanged.

## Follow-up candidates

- Package scanners: skip unless their owning manifest/lockfile changed.
- Prisma and deploy scanners: skip unless their schema/deploy config changed.
- Remaining infrastructure aggregators: declare exact config ownership before
  phase scheduling is tightened.

Whole-generation transactional persistence is tracked separately; this item
does not claim atomicity beyond the existing per-file atomic writes.
