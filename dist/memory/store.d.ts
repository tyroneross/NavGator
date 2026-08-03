/**
 * gator-memory — the durable narrative store for `~/.navgator/memory/`.
 *
 * Why this exists: `~/.navgator/` already holds three things, and none of them
 * answer "what happened to this project over time?". `projects.json` is the
 * live registry (current state only, overwritten in place).
 * `registry-journal.jsonl` is a forensic op log — it records digests and
 * entry-count deltas, not project identity, and it is deliberately
 * size-rotated so it CANNOT serve as history (see `registry-journal.ts`'s own
 * header for why payloads don't belong there). `lessons/global-lessons.json`
 * captures patterns, not events. Nothing records the narrative: which
 * projects exist, when they entered, what materially changed and when. This
 * module is that narrative layer.
 *
 * THE SOURCE OF TRUTH IS `projects/<slug>.json`, not `index.json` or
 * `events.jsonl`. This is the property that makes compaction/rotation safe:
 * `index.json` is a derived rollup (regenerable from the per-project files —
 * see `rebuildMemoryIndex`) and `events.jsonl` is a derived chronology (each
 * event is ALSO folded into the owning project's `milestones[]`).
 *
 * Be precise about that last part rather than overclaiming, because the
 * tempting shorthand — "both can be deleted without losing knowledge" — is
 * FALSE. `milestones[]` is capped at `maxMilestones()` and evicts oldest
 * first, so a project with more lifetime events than the cap has older
 * chronology that exists ONLY in `events.jsonl` until rotation drops it. The
 * accurate statement is narrower and still strong: deleting the derived files
 * preserves every project's identity, counters, latest stats, and most recent
 * milestones, and `projects/<slug>.json` is the only file whose loss is
 * unrecoverable. Losing a rotated event generation costs old cross-project
 * ordering and the tail of a long-lived project's history — an accepted trade
 * for a hard bound, not a free one.
 *
 * `index.json` IS NOT ON THE CAPTURE WRITE PATH, and that is a correctness
 * requirement rather than a performance preference. Capture deliberately runs
 * OUTSIDE the registry's in-process mutex and cross-process file lock, because
 * a memory write must never extend the ~8-9 ms critical section that
 * `registerProject` holds. But `scanPortfolio` runs N concurrent in-process
 * workers and every one of them reaches `registerProject`
 * (`src/projects.ts:216-222` — the call path that measurably registered only
 * 2 of 6 entries at concurrency 4 before the lock landed). If every capture
 * also read-modify-wrote ONE shared rollup file, those workers would race on
 * it with no mutex and no compare-and-swap, reintroducing the exact
 * lost-update defect this repo just closed, one layer up. It would also make
 * each capture O(registered projects); the concurrency oracle's header cites a
 * real 541-project registry.
 *
 * So `recordMemoryEvent` writes exactly two things: one `O_APPEND` line to
 * `events.jsonl` (atomic for a record this small) and one temp+rename of
 * `projects/<slug>.json` (single-project scope, so workers scanning different
 * projects never contend for the same file). `index.json` is written ONLY by
 * `rebuildMemoryIndex`, called from hygiene and mirror paths that are
 * single-threaded by construction. Readers never depend on it being current.
 *
 * Single-project scope stops DIFFERENT projects from contending for the same
 * file, but says nothing about the SAME project scanned concurrently — the
 * dashboard and a CLI scan hitting one repo together, or a future caller that
 * reaches `recordMemoryEvent` without `scanPortfolio`'s per-project
 * partitioning. `writeProjectRecordWithCAS` closes that gap with a per-slug
 * compare-and-swap, NOT a store-wide mutex or lock file — the whole point of
 * this design is that capture stays off the shared-rollup path and outside
 * the registry's locks. It reads the record, computes the candidate, and
 * immediately re-reads the same file with nothing but two more `*Sync` calls
 * in between; if the file changed since the first read, the SAME event is
 * re-applied to the fresh winner and the attempt retries, bounded at 5
 * (mirroring `MAX_CAS_ATTEMPTS` in `src/projects.ts:272`), then commits
 * unconditionally on the last attempt. Because the whole read-compare-write
 * runs on synchronous fs calls with no `await` in between, one in-process
 * call cannot be interleaved by another in-process call at all — the first
 * iteration always wins against same-process contention. Across processes,
 * true OS-level parallelism remains possible in the syscall-width window
 * between the check-read and the rename; the same honest limit
 * `mutateRegistry`'s header documents for the registry applies here too.
 *
 * Bounded by construction, mirroring `registry-journal.ts`'s posture exactly:
 *   - `milestones[]` on a project record is capped at `maxMilestones()`
 *     (env `NAVGATOR_MEMORY_MAX_MILESTONES` > `memory.maxMilestonesPerProject`
 *     in `~/.navgator/config.json` > the `MAX_MILESTONES` default), oldest
 *     evicted first, so a single long-lived project's file cannot grow
 *     without limit no matter how many scans it accumulates.
 *   - `events.jsonl` rotates to `events.1.jsonl` at `maxEventBytes()` (same
 *     ladder: env `NAVGATOR_MEMORY_MAX_EVENT_BYTES` > `memory.maxEventBytes`
 *     in the file > `DEFAULT_MAX_EVENT_BYTES`), one generation only, so the
 *     chronology is capped at
 *     `2 * maxEventBytes + 1 record` even if the rotate rename fails
 *     persistently (falls back to truncation — see `rotateEventsIfNeeded`,
 *     copied from `rotateIfNeededSync` in `registry-journal.ts:279-307`, and
 *     the same reasoning applies: swallowing a failed rename and appending
 *     anyway would silently retire the cap).
 *   - `summary` is sanitized (control characters stripped) and capped at
 *     `SUMMARY_MAX_CHARS`. Project *paths* flow into summaries, and a path is
 *     user-controlled text that ends up rendered in a terminal — neutralizing
 *     at write time means the stored record is safe regardless of who renders
 *     it later, the same argument as `sanitizeNote` in `registry-journal.ts`.
 *
 * Fail-open by construction: every exported entry point swallows its own
 * errors and degrades — a corrupt `projects/<slug>.json` reads as `null`
 * rather than throwing, a torn final line in `events.jsonl` is skipped rather
 * than aborting the whole read, an unwritable memory directory makes
 * `recordMemoryEvent` a silent no-op. A broken memory store must never break
 * a scan or a registry write; memory is a record of what happened, not a gate
 * on what happens next.
 *
 * Security posture: directory mode `0o700`, file mode `0o600` — these files
 * name every project on the machine, which on a shared host is nobody else's
 * business. The `events.jsonl` append opens with `O_NOFOLLOW` for the same
 * reason `registry-journal.ts` does: without it, anything that can write to
 * `~/.navgator` could pre-plant the path as a symlink and redirect every
 * append into an arbitrary file. JSON writes go through write-temp-then-rename
 * with a per-call-unique temp suffix (pid + timestamp + random hex) — this
 * repo has already been burned once by a temp suffix of `pid + Date.now()`
 * alone (see `web/lib/server/atomic-write.ts`'s header: 123 of 400 rounds
 * published unparseable JSON at 8 concurrent writers before the random
 * component was added).
 */
export type MemoryEventKind = 'project.registered' | 'project.scanned' | 'project.removed' | 'architecture.changed';
export interface MemoryEvent {
    ts: number;
    slug: string;
    kind: MemoryEventKind;
    /** One line, sanitized (control characters stripped), capped at 200 chars. */
    summary: string;
    detail?: {
        components?: number;
        connections?: number;
        prompts?: number;
        significance?: 'major' | 'minor';
        componentsAdded?: number;
        componentsRemoved?: number;
        connectionsAdded?: number;
        connectionsRemoved?: number;
        branch?: string;
        commit?: string;
    };
}
export interface ProjectMemory {
    schema_version: string;
    slug: string;
    name: string;
    path: string;
    firstSeen: number;
    lastSeen: number;
    status: 'active' | 'removed';
    counters: {
        scans: number;
        significantChanges: number;
    };
    latest?: {
        components?: number;
        connections?: number;
        prompts?: number;
        branch?: string;
        commit?: string;
    };
    /** Capped at MAX_MILESTONES, oldest evicted first, newest last. */
    milestones: MemoryEvent[];
}
/** What `recordMemoryEvent` accepts; `ts` and `slug` are filled in here. */
export type RecordMemoryEventInput = Omit<MemoryEvent, 'ts' | 'slug'> & {
    /** Absolute or relative project path. Resolved and slugged internally. */
    projectPath: string;
    /** Display name. Defaults to the resolved path's basename. */
    name?: string;
    /** Epoch milliseconds. Defaults to `Date.now()`. */
    ts?: number;
};
export declare const MEMORY_SCHEMA_VERSION = "1.0.0";
/**
 * Default rotation threshold for `events.jsonl`. See `maxEventBytes()` below
 * for the full env > file > default ladder (env var used directly by the
 * rotation test — see `src/__tests__/memory-store.test.ts`).
 */
export declare const DEFAULT_MAX_EVENT_BYTES = 2000000;
/**
 * Default per-project milestone cap, oldest evicted first when exceeded. See
 * `maxMilestones()` below for the full env > file > default ladder.
 */
export declare const MAX_MILESTONES = 40;
/**
 * Memory capture is on by default. `NAVGATOR_MEMORY=0` (or `false`,
 * case-insensitive) turns it off — this mirrors `journalEnabled()` in
 * `registry-journal.ts:167-171` exactly. When the env var is unset, the
 * decision falls through to `memory.enabled` in `~/.navgator/config.json`
 * (via `loadHomeConfig()`, which already applies its own env override for
 * `NAVGATOR_MEMORY` — checking the raw env var here first is what lets this
 * function short-circuit without touching the home-config file at all when
 * the env var is set).
 */
export declare function memoryEnabled(): boolean;
/**
 * The memory directory. Resolved PER CALL, never a module-level const — see
 * `registry-journal.ts:179-187` and `web/lib/server/registry-store.ts:89` for
 * the reasoning this mirrors, and `src/__tests__/registry-concurrency-oracle
 * .test.ts` for the regression that a cached path would reintroduce. A test
 * that redirects `$HOME` before calling into this module must actually
 * redirect every path derived from it.
 */
export declare function memoryDir(): string;
export declare function projectMemoryPath(projectSlug: string): string;
/**
 * `slug(projectPath)` = `kebab(basename(resolved))` + `'-'` + first 8 hex
 * chars of `sha256(resolved)`.
 *
 * Two properties fall out of this construction, both load-bearing:
 *
 *   1. Two directories that happen to share a basename (two checkouts both
 *      named `web`) get DISTINCT slugs, because the digest is computed off
 *      the full resolved path, not the basename.
 *   2. A crafted basename containing `..` or `/` cannot escape
 *      `~/.navgator/memory/projects/` — not "is unlikely to", but
 *      structurally cannot: `kebab()` already collapses every `/` and `.`
 *      run to a single `-` before the digest is even computed, and the
 *      digest suffix guarantees uniqueness on top of that regardless of what
 *      survived the kebab filter. `projectMemoryPath()` therefore only ever
 *      joins a `[a-z0-9-]+` segment plus `.json` onto the projects directory.
 *
 * Deterministic: the same absolute path always produces the same slug,
 * because `path.resolve` and `sha256` are both pure functions of their input.
 */
export declare function slug(projectPath: string): string;
/** Read a project's durable record. `null` on missing, unreadable, or corrupt. */
export declare function readProjectMemory(projectPath: string): ProjectMemory | null;
/**
 * Regenerate `index.json` from the per-project records.
 *
 * The ONLY writer of the index. Deliberately not called by
 * `recordMemoryEvent` — see the module header for why a shared rollup on the
 * capture path would reintroduce a lost-update race across `scanPortfolio`'s
 * concurrent workers. Callers are hygiene (`doctor`) and the mirror, both
 * single-threaded.
 *
 * Fail-open: returns a count of 0 rather than throwing when the store is
 * missing or unwritable.
 */
export declare function rebuildMemoryIndex(): {
    projects: number;
};
/**
 * The single write entry point. Appends one line to `events.jsonl` and writes
 * `projects/<slug>.json`. It does NOT touch `index.json` — see the module
 * header: a shared rollup on this path would race across `scanPortfolio`'s
 * concurrent workers, which is the defect class this repo just closed.
 *
 * Fail-open: swallows every error. A broken or unwritable memory store must
 * never break a scan or a registry write — see the module header.
 */
export declare function recordMemoryEvent(input: RecordMemoryEventInput): Promise<void>;
/**
 * All project records, enumerated from `projects/` — the source of truth.
 *
 * Deliberately does NOT consult `index.json`, even as a hint. Since capture no
 * longer maintains the index (see the module header), the index is stale by
 * default: it reflects the last `rebuildMemoryIndex` call, not the store. A
 * reader that trusted it for the slug list would silently omit every project
 * registered since that rebuild — which is precisely the class of "the tool
 * says it's fine and it isn't" failure this store exists to avoid. The
 * directory listing is authoritative and costs one `readdir`.
 */
export declare function listProjectMemories(): ProjectMemory[];
/**
 * Cross-check memory records against the live registry.
 *
 * Why reconcile on READ instead of emitting `project.removed` on every delete:
 * the dashboard removes projects through `web/lib/server/registry-store.ts`,
 * a SEPARATE compilation unit that cannot import this module. A UI-initiated
 * delete therefore can never emit a removal event, and a write-side mirror
 * would need a fourth hand-maintained twin alongside registry-store,
 * registry-journal, and registry-lock. Deriving the answer at read time needs
 * no web-side code and stays correct no matter which surface performed the
 * delete — including a hand-edited `projects.json`.
 *
 * Pure over the caller's list: this module does not import `src/projects.ts`,
 * so the memory store stays free of a dependency on the registry.
 */
export declare function reconcileMemory(registeredPaths: string[]): {
    orphaned: ProjectMemory[];
};
/**
 * Read recent events, newest last. A torn final line (a process killed
 * mid-append) is skipped rather than aborting the read — the point of an
 * append-only log is that the intact records stay readable when one is not.
 */
export declare function readMemoryEvents(opts?: {
    limit?: number;
    slug?: string;
    kind?: MemoryEventKind;
    includeRotated?: boolean;
}): MemoryEvent[];
export declare function memoryStoreStats(): {
    exists: boolean;
    projects: number;
    events: number;
    bytes: number;
    lastEventAt: number | null;
};
/**
 * Hard-delete a project's durable record and drop it from `index.json`.
 *
 * Distinct from a `project.removed` event: that event keeps the record
 * (with `status: 'removed'`) because removal is a fact worth keeping. This
 * function is the hygiene primitive a later chunk's cleanup command uses
 * when the user explicitly asks to forget a project rather than merely
 * unregister it.
 */
export declare function removeProjectMemory(projectPath: string): boolean;
//# sourceMappingURL=store.d.ts.map