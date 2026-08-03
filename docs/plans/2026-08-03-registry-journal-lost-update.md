# Registry operation journal + lost-update detection

**Run**: bl-navgator-20260803-registry-journal
**Goal (user, verbatim)**: "each read and write needs to be tracked and saved for future reference."
**Closes**: `.build-loop/followup/nav-20260803-9-registry-route-serialization.md` (audit f3, medium)

## Problem

`~/.navgator/projects.json` has three reader surfaces and two writer surfaces:

| Site | Ops | Serialized? |
|---|---|---|
| `src/projects.ts` (`registerProject`, `updateProjectMeta`, `listProjects`) | load, save | in-process mutex only |
| `web/app/api/projects/route.ts` (GET, POST add/remove) | load, save | **no** |
| `web/lib/server/coverage.ts` (`loadRegisteredProjectPaths`, sync) | load | read-only |

Each individual write is atomic (temp + rename). The **load-mutate-save cycle** is not.
Measured on the real 541-project registry: two concurrent POST `{action:'add'}` for distinct
paths lost one registration in **300 of 300 rounds**.

Nothing records that a registry op happened, so a lost update leaves no trace at all.

## Deliverables

1. Append-only JSONL journal of every registry read and write, bounded by size rotation.
2. Monotonic `revision` on the registry file; compare-and-swap on write, with re-read-merge
   and a journaled `conflict` event when the disk revision moved under a writer.
3. Coverage of every reader/writer site across both compilation units.
4. A concurrency oracle that provokes the race, plus mutation-verification.
5. `navgator registry-log` read surface.

## Design

### Journal record (bounded — no payloads)

```jsonc
{"ts":1754200000000,"actor":"web-route","pid":4122,"op":"save","rev":58,
 "entries":542,"delta":1,"digest":"9f2a1c7d4b0e6a83","note":"add"}
```

| Field | Meaning |
|---|---|
| `ts` | epoch ms |
| `actor` | `cli` \| `mcp` \| `web-route` (env `NAVGATOR_JOURNAL_ACTOR` overrides; else argv-detected) |
| `pid` | writing process |
| `op` | `load` \| `save` \| `register` \| `update` \| `remove` \| `conflict` |
| `rev` | revision observed (reads) or written (writes) |
| `entries` | project count observed / resulting |
| `delta` | writes only: entry-count change |
| `digest` | writes only: 16-hex sha256 prefix of the serialized registry |
| `base` / `found` | conflict only: revision loaded vs revision found at save time |
| `note` | ≤120 chars, bounded |

Location: `<registry-dir>/registry-journal.jsonl` — **derived from the registry path**, not
hardcoded to `~`, so tests against a tmp registry never touch the real one.

Rotation: before append, if the file is ≥ `NAVGATOR_REGISTRY_JOURNAL_MAX_BYTES`
(default 5 MB), rename to `registry-journal.1.jsonl`, replacing any prior rotation.
Bounded at 2 files ≈ 10 MB worst case. Disable entirely with
`NAVGATOR_REGISTRY_JOURNAL=0`.

Journaling is **fail-open**: any journal error is swallowed. A broken journal must never
break a registry operation.

### Versioned writes (CAS)

`ProjectRegistry` gains `revision?: number`. Backward-compatible:

- v2 file with no `revision` → loads as revision `0`. No migration write required.
- v1 file → existing v1→v2 migration runs first, unchanged, then revision defaults to 0.
- Field is additive; `version` stays `2`.

Write path becomes a compare-and-swap, expressed as a **replayable mutation closure**:

```
mutateRegistry(op, mutate) :
  1. registry = load()                     -> journal {op:'load'}
  2. result   = mutate(registry)           (pure, in-memory)
  3. diskRev  = re-read revision           -> journal {op:'load', note:'cas-check'}
  4. if diskRev != base:
       journal {op:'conflict', base, found:diskRev}
       registry = load(); result = mutate(registry)   // re-read-merge, replay
       (bounded: 5 attempts, then last-writer-wins on the merged result)
  5. registry.revision = diskRev + 1
  6. atomic save                           -> journal {op:<op>, rev, entries, delta, digest}
```

Expressing the mutation as a closure is what makes step 4 a *merge* rather than a clobber:
the same intent is re-applied to the winner's registry, so no entry is dropped.

**Honest scope**: step 3→6 still has a sub-millisecond cross-process TOCTOU window; POSIX
gives no atomic CAS on a rename. What changes is that the window is (a) ~1000× smaller than
a full load-mutate-save, and (b) *detectable* — the next writer sees an unexpected revision
and journals it. Silent loss becomes recorded loss. In-process loss is fully eliminated by
the mutex on each side.

### Twin implementations

The web app compiles separately (`web/tsconfig.json`, own `node_modules`, `@/` alias). Per
the precedent set by `web/lib/server/atomic-write.ts`, the journal is mirrored rather than
imported across the boundary, and both copies are held to one shared contract by
`src/__tests__/registry-concurrency-oracle.test.ts` — the same arrangement
`src/__tests__/web-atomic-write-concurrency.test.ts` uses today.

## Chunks

| # | Files owned | Depends on |
|---|---|---|
| C1 | `src/registry-journal.ts` (new) | — |
| C2 | `src/projects.ts` | C1 |
| C3 | `web/lib/server/registry-journal.ts` (new), `web/lib/server/registry-store.ts` (new), `web/app/api/projects/route.ts`, `web/lib/server/coverage.ts` | C1 contract |
| C4 | `src/cli/commands/misc.ts`, `src/cli/index.ts` | C1 |
| C5 | `src/__tests__/registry-journal.test.ts`, `src/__tests__/registry-concurrency-oracle.test.ts` (new) | C1–C3 |
| C6 | `README.md`, `CLAUDE.md` | C4 |
| C7 | `src/registry-lock.ts`, `web/lib/server/registry-lock.ts` (new, added post-critic) | — |
| C8 | `src/index.ts` (barrel re-exports), `dist/**` (rebuilt in sync) | C1, C2, C4 |

`modifies_api`: C1 (new module), C2 (`loadRegistry` return shape gains `revision`).
`risk_reason`: persistence contract — new file in the user's home dir, schema field on a
shared registry with an out-of-tree writer (the running dashboard).

## Alternatives considered

1. ~~**Cross-process file lock** — rejected for v1 because `scan()` already holds a lease and
   calls `registerProject` from inside it.~~ **ADOPTED after plan-critic; the rejection was a
   rationalization and every clause of it was wrong.** The scan lease is on
   `<project-root>/.navgator/scan.lock`, not on `~/.navgator/projects.json` — a different
   resource, and the registry lock is a leaf, so there is no ordering cycle.
   `acquireScanLease` is non-blocking (returns `retryable`), and `src/scan-lock.ts:162-253`
   exists specifically to make stale locks non-wedging. This repo already ships a
   general-purpose cross-process mutation mutex on that primitive
   (`withDirtyLedgerMutationLock`, src/freshness/dirty-ledger.ts:136).

   The lock is also not optional, which is the part the original plan got materially wrong:
   **CAS alone cannot prevent lost updates.** Two writers starting in the same tick both read
   revision R before either saves, so both pass their own CAS check and both write R+1 — one
   entry lost, and neither writer sees a mismatch to journal. That is silent loss, which
   acceptance criterion 1 forbids. Mutual exclusion is the mechanism; CAS is the detector.

   `acquireScanLease` itself was still not reused, for two reasons that survive checking:
   the dashboard compiles separately and cannot import `src/`, so the protocol must be
   simple enough to mirror byte-for-byte (a lock only one contender takes is not a lock);
   and `acquireScanLease` is synchronous, with a retry helper that parks the thread on
   `Atomics.wait` — which inside the Next.js server would stall every concurrent request.
   Hence `src/registry-lock.ts` + `web/lib/server/registry-lock.ts`: `open(path,'wx')` plus a
   JSON record and a TTL steal, fail-open, mirrored on both sides.
2. **Share one implementation across `src/` and `web/`** — rejected; the web app has its own
   compilation unit and dependency tree, and the codebase already made this call for
   `atomic-write.ts`. Duplication risk is answered by the shared oracle, not by a fragile
   cross-boundary import.
3. **Journal full payloads / per-entry diffs** — rejected; the registry is 425 KB, so payload
   journaling would produce hundreds of MB. Digest + entry-count delta answers "did this
   write change what I expected" at ~150 bytes per record.
4. **Bump registry `version` to 3** — rejected; `revision` is additive and optional, and a
   version bump would make files written by a new CLI unreadable-as-expected by an older
   dashboard build. Backward compatibility is a stated constraint.

## Falsifier

If the oracle passes with the fix reverted, the oracle proves nothing. Four mutants, each
naming the test it must break. All four were run; all four were convicted.

| Mutant | Reverted mechanism | Result |
|---|---|---|
| a | `withRegistryLock` in `src/projects.ts` | 1 failed — "the CLI mutex still keeps both concurrent registrations" |
| b | `withRegistryLock` in `web/lib/server/registry-store.ts` | 1 failed — "the dashboard mutex still keeps both concurrent registrations" |
| c | `withRegistryFileLock` in both lock modules | 6 failed — every cross-unit lost-update test |
| d | CAS detection (`if (diskRevision !== base)` -> `if (false)`) | 2 failed — the conflict-journaling tests |

Mutants a and b **survived the first round**: with the file lock in place, neutralizing
either in-process mutex broke nothing, because the file lock serializes same-process writers
too. That is a real finding, not a test defect — it means the mutexes only matter on the
degraded path where the file lock fails open. `src/__tests__/registry-degraded-lock.test.ts`
runs exactly that path (the lock module is mocked to report "not acquired" and run the body
anyway), after which both mutants convict. Without it the mutexes would have been uncovered
code, and two `MUTANT:` annotations in the oracle claimed coverage the tests did not provide.

## Evidence from the real registry, not just the oracle

The journal proved its own case within minutes of existing. `scripts/measure-registry-collisions.mjs`
reads the journal back and counts bursts where two or more processes published the SAME
revision with DIFFERENT digests — each one means N-1 writers were overwritten.

| Window | Writes | Collisions | Entries lost | Conflicts journaled |
|---|---|---|---|---|
| CAS only, no file lock | 295 | 9 | **13** | **0** |
| After the file lock landed | 144 | 0 | 0 | 0 |

The zero in the last column of the first row is the whole argument for the lock: thirteen real
registrations were lost on this machine and the compare-and-swap reported nothing, because
every writer loaded the same revision in the same tick and each one passed its own check.
The measurement requires the burst window — a registry restored from a backup rolls the
revision counter back and re-issues revisions, which reads as dozens of phantom collisions if
you group by revision alone. That false positive was hit and corrected while measuring.

## Acceptance criteria

1. Concurrent read-modify-write from multiple writers loses **zero** entries — same-process
   (CLI side and dashboard side) and cross-compilation-unit — proven by tests that fail when
   the fix is reverted. Residual loss is possible only on the degraded path where the file
   lock could not be acquired; that path is journaled as `UNLOCKED`, and the in-process
   mutex still covers same-process writers within it.
2. Every reader and writer site appends a journal record; a `conflict` record is written
   whenever a writer's base revision moved.
3. A v2 registry file with no `revision` field loads without error and without data loss;
   the v1→v2 migration still works.
4. `navgator registry-log` reads recent journal entries; no new MCP tool, no new slash
   command, so host manifests and the 13/4/6/12 surface counts are unchanged.
5. Full suite green; `npm run typecheck` clean; `dist/` rebuilt in sync.
