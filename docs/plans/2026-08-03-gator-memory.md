# gator-memory — the durable narrative store

**Status**: shipped 2026-08-03 · **Schema**: `1.0.0` · **Code**: `src/memory/store.ts`, `src/memory/mirror.ts`, `src/home-config.ts`

## Why it exists

`~/.navgator/` already held three things before this. None of them answer
*"what happened to this project over time?"*

| Existing store | What it holds | Why it can't be the narrative |
|---|---|---|
| `projects.json` | The live registry | Current state only, overwritten in place. No history. |
| `registry-journal.jsonl` | Every read and write | Digests and entry-count deltas, **not project identity** — and deliberately size-rotated, so it *cannot* serve as history. That is by design; see its own header. |
| `lessons/global-lessons.json` | Promoted cross-project patterns | Patterns, not events. Manually curated. |

The journal is forensic: it answers *"did a write happen, and did it collide?"*
The registry is a snapshot: it answers *"what is registered right now?"* Neither
answers *"which projects exist, when did they enter, and what materially
changed?"* — the question an agent actually asks when it returns to a codebase
after a week.

gator-memory is that layer. It ships with NavGator: no dependency, no network,
no configuration, no setup step. Every user gets it on their first scan.

## Layout

```
~/.navgator/memory/
├── index.json            materialized rollup — written ONLY by rebuildMemoryIndex()
├── events.jsonl          append-only chronology — size-rotated, one generation
├── events.1.jsonl        rotated generation
└── projects/
    └── <slug>.json       DURABLE per-project record — THE SOURCE OF TRUTH
```

`projects/<slug>.json` is the source of truth. Every event is also folded into
its owning project's `milestones[]`, so `index.json` and `events.jsonl` can both
be deleted while every project's identity, counters, and most recent milestones
survive.

Be precise about the limit, because it is easy to overclaim here: `milestones[]`
is CAPPED and evicts oldest-first, so a project with more lifetime events than
the cap has older chronology that exists only in `events.jsonl` until rotation
drops it. The honest statement is that the per-project record survives
independently of the derived files, not that no fact is ever lost. The cap is
what bounds a single project's file, and accepting that bound is a deliberate
trade for unbounded growth.

**Slug** = `kebab(basename)` + `-` + `sha256(resolvedPath).slice(0,8)`. The
digest is what keeps two directories both named `web` distinct. It is also why
a crafted basename cannot escape the directory: the kebab filter reduces to
`[a-z0-9-]`, so `..` and `/` cannot survive, and the digest guarantees
uniqueness regardless.

### `index.json` is deliberately NOT on the capture write path

This is the single most important design decision here, and it is a
**correctness** requirement rather than a performance preference.

Capture runs *outside* the registry's in-process mutex and cross-process file
lock, because a memory write must never extend the ~8–9 ms critical section
`registerProject` holds (measured on a real 1434-entry registry; see
`src/registry-lock.ts`).

But `scanPortfolio` runs N concurrent in-process workers, and every one of them
reaches `registerProject` — the exact call path that measurably registered only
**2 of 6 entries at concurrency 4** before the lock landed. If every capture
also read-modify-wrote one shared rollup file, those workers would race on it
with no mutex and no compare-and-swap: the same lost-update defect this repo
just closed, reproduced one layer up. It would also make each capture
O(registered projects) against a registry the concurrency oracle documents at
541 entries.

So `recordMemoryEvent` writes exactly two things:

1. one `O_APPEND` line to `events.jsonl` — atomic for a record this small;
2. one temp+rename of `projects/<slug>.json` — single-project scope, so
   workers scanning *different* projects never contend for the same file.

`index.json` is written only by `rebuildMemoryIndex()`, called from hygiene and
mirror paths that are single-threaded by construction. `listProjectMemories()`
enumerates `projects/` and never consults the index, not even as a hint —
because the index is stale by default, and a reader that trusted it would
silently omit every project registered since the last rebuild.

## Events

| Kind | Fires when |
|---|---|
| `project.registered` | A path enters the registry for the first time |
| `project.scanned` | An existing project is rescanned **and** significance is `major` or `minor` |
| `architecture.changed` | Same, plus the timeline diff's component/connection deltas |
| `project.removed` | A project leaves the registry via the CLI or `doctor --fix` |

**Routine scans emit nothing.** A `patch`-significance rescan produces no event
at all. That is the whole difference between this store and the journal: the
journal records every operation and therefore must rotate; this store records
only what is worth remembering and therefore does not have to.

### Removal is reconciled on read, not mirrored on write

The dashboard deletes projects through `web/lib/server/registry-store.ts`, a
**separately compiled unit that cannot import `src/memory/`**. A UI-initiated
delete can therefore never emit a removal event, and a write-side mirror would
require a fourth hand-maintained twin alongside `registry-store`,
`registry-journal`, and `registry-lock`.

Instead, `reconcileMemory(registeredPaths)` derives the answer at read time: any
record whose path is absent from the live registry and not already marked
`removed` is reported as orphaned, and `doctor --fix` repairs it. This needs no
web-side code and stays correct no matter which surface performed the delete —
including a hand-edited `projects.json`.

## Bounded by construction

Three bounds, each with an owner. All three are tested; the milestone cap and
the index-off-capture invariant are additionally mutation-verified.

| Bound | Mechanism | Ceiling |
|---|---|---|
| Per-project file size | `milestones[]` capped at `MAX_MILESTONES` (40), oldest evicted | ~20 KB per project |
| Chronology size | `events.jsonl` rotates to one generation at `maxEventBytes` (2 MB) — with the same truncate fallback as the journal, so a persistently failing rename cannot silently retire the cap | `2 × maxEventBytes + 1 record` |
| Project-file count | `doctor --fix` calls `removeProjectMemory()` for every path it prunes, and `doctor` reports the count so unbounded growth is visible | Real projects on the machine |

## Failure posture

**Fail-open, everywhere.** Every exported entry point swallows its own errors
and degrades: a corrupt record reads as `null`, a torn final JSONL line is
skipped, an unwritable directory makes capture a silent no-op. Memory is a
record of what happened — never a gate on what happens next. A broken memory
store must never break a scan or a registry write, and there is a test that
makes the directory unwritable and asserts the registry write still lands.

Capture is also placed *outside* `registerProject`'s existing try/catch, not
merely after the lock. That block logs a registry-specific message; a memory
defect reported through it would tell the user their `projects.json` write
failed when it had already succeeded.

And capture is `await`ed rather than fire-and-forget. A floating rejection
would escape every catch on the path and become an unhandled rejection — fatal
under Node's default `--unhandled-rejections=throw`. That is the one route by
which a memory bug could genuinely break a scan, and it is exactly where a
naive "don't slow the caller down" instinct leads.

## Security

| Control | Reason |
|---|---|
| dir `0700`, files `0600` | These files name every project on the machine. On a shared host that is nobody else's business. |
| `O_NOFOLLOW` on the `events.jsonl` append | Without it, anything that can write to `~/.navgator` could pre-plant the path as a symlink and redirect every append into an arbitrary file. |
| temp+rename with a per-call-unique suffix (pid + timestamp + random hex) | This repo published unparseable JSON in 123 of 400 rounds once already, using `pid + Date.now()` alone. |
| Control characters stripped from `summary` at write time | Project paths flow into summaries, and a path is user-controlled text that ends up rendered in a terminal. Neutralizing at write time keeps the record safe regardless of who renders it. |
| No network, ever | Nothing in this subsystem opens a socket. |

## Optional mirror to build-loop-memory

**Default OFF.** Configure in `~/.navgator/config.json`:

```json
{ "memory": { "mirror": { "enabled": true, "target": "~/dev/git-folder/build-loop-memory" } } }
```

When enabled *and* the target exists on disk, NavGator exports each project's
memory to
`<target>/projects/<name-slug>/architecture/navgator-memory.{json,md}`.

Properties that matter:

- **One-way.** Never a sync. NavGator reads nothing back.
- **Detected, never assumed.** If the target does not exist, the mirror is a
  silent no-op — no warning, no log line, no error. For almost every user this
  tree does not exist, and that is the normal case, not a problem.
- **Never creates the target root.** Its absence is precisely the signal being
  detected; conjuring it would fabricate the thing the check is for.
- **A guest in someone else's store.** It writes only its two
  `navgator-memory.*` files, and never touches `snapshot.json`, `graph.json`,
  `INDEX.jsonl`, or anything else owned by build-loop's own tooling.
- **Significant events only**, plus the on-demand `doctor --mirror`.

Residual risk, accepted and documented rather than prevented: a user who
enables the mirror into a git repo they later push is exporting their own
project inventory. That is the feature.

## Hygiene

`navgator doctor` reports registry entries, tmp-rooted entries, paths that no
longer exist, a journal-derived growth-rate estimate, conflict and
degraded-write counts, memory-store status, and mirror status. The dashboard's
Registry Health panel renders the same computation.

`doctor --fix` prunes registry entries that are **both** tmp-rooted **and**
missing, after writing a timestamped backup and asking for confirmation.
Widening to any missing path is opt-in via `--include-missing`, because a
project on an unmounted volume is missing but real.

Every removal routes through `pruneProjects`, which goes through
`mutateRegistry` — one lock, one CAS, one journal `remove` record for the whole
batch. It takes an **explicit path list, not a predicate**: `mutateRegistry`
replays its mutation closure on CAS conflict, and a filesystem-dependent
predicate re-evaluated during replay could consume an entry a concurrent writer
added *after* the user confirmed and *after* the backup was taken. With an
explicit list, the confirmed set, the backed-up set, and the pruned set are
provably identical.

## Why this shape, and what was rejected

**SQLite with FTS.** Rejected: adds a native dependency to a zero-dep CLI,
breaks the `prepare-web-runtime.mjs` no-native-binaries invariant, and cannot
be read by a human or an agent with `cat`. If recall volume ever outgrows linear
scan, `index.json` is the seam — it is already a derived rollup, so swapping in
a real index later touches one module.

**A parallel store outside `~/.navgator/`.** Rejected: NavGator already owns a
home directory with an established posture (fail-open, rotated, owner-only).
A second location would mean a second set of conventions to keep honest.

**Extending `registry-journal.jsonl`.** Rejected: the journal's volume is set by
its callers and is dominated by routine `load` records, which is exactly why it
must rotate. Durable knowledge cannot live in a store designed to discard its
oldest half.
</content>
