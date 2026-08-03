/**
 * NavGator Registry Operation Journal
 *
 * Append-only record of every read and every write of the project registry
 * (`~/.navgator/projects.json`), so a lost update leaves a trace instead of
 * vanishing.
 *
 * Why this exists: the registry has readers and writers in two separate
 * compilation units (the CLI/MCP process and the Next.js dashboard). Each
 * individual write is atomic, but the load-mutate-save *cycle* is not
 * serialized across them, and before this journal existed nothing recorded that
 * an op had happened at all — a dropped registration was indistinguishable from
 * a registration that never occurred.
 *
 * The journal proved its own case within minutes of existing. Reading back the
 * real `~/.navgator` journal over a window when the compare-and-swap was in
 * place but the cross-process lock was not: 9 collisions, 13 registrations
 * silently lost, and ZERO conflict records — because CAS is blind to writers
 * that load the same revision in the same tick. Over the equivalent window
 * after the lock landed: 144 writes, 0 collisions. Reproduce with
 * `node scripts/measure-registry-collisions.mjs`.
 *
 * Bounded by construction:
 *   - Records carry a content digest and an entry-count delta, never payloads.
 *     The registry runs to hundreds of KB; journaling payloads would produce
 *     hundreds of MB.
 *   - Size-based rotation caps the footprint at two generations. The check runs
 *     before every append, so a generation can overshoot by at most one record:
 *     the real bound is 2 x maxBytes + 2 records, and it holds even when the
 *     rotate rename fails persistently, because that path falls back to
 *     truncation rather than giving up on the cap.
 *
 * Fail-open by construction: every entry point swallows its own errors. A
 * broken or unwritable journal must never break a registry operation — the
 * journal is evidence, not a gate.
 *
 * This module is mirrored at `web/lib/server/registry-journal.ts` because the
 * web app compiles separately (own tsconfig, own node_modules, `@/` alias).
 * The two copies are held to one contract by
 * `src/__tests__/registry-concurrency-oracle.test.ts`, the same arrangement
 * `web/lib/server/atomic-write.ts` uses.
 */
/** Which surface performed the operation. */
export type JournalActor = 'cli' | 'mcp' | 'web-route' | 'unknown';
/**
 * `load` covers every read of the registry file, including the compare-and-swap
 * revision re-check (distinguished by `note`). Writes use the op that names the
 * caller's intent so the journal reads as a history of decisions, not of
 * syscalls. `conflict` records a detected lost-update race.
 */
export type JournalOp = 'load' | 'save' | 'register' | 'update' | 'remove' | 'conflict';
export interface RegistryJournalEvent {
    /** Epoch milliseconds. */
    ts: number;
    actor: JournalActor;
    pid: number;
    op: JournalOp;
    /** Revision observed (reads) or written (writes). */
    rev: number;
    /** Project count observed (reads) or resulting (writes). */
    entries: number;
    /** Writes only: change in project count. */
    delta?: number;
    /** Writes only: 16-hex sha256 prefix of the serialized registry. */
    digest?: string;
    /** Conflict only: the revision this writer loaded. */
    base?: number;
    /** Conflict only: the revision found on disk when the writer went to save. */
    found?: number;
    /**
     * Writes only: whether the cross-process file lock was actually held.
     *
     * A positive marker, not just a failure note. Without it a write made while
     * holding the lock and a write from a build that has no lock code at all
     * produce byte-identical records, so a collision found in an old journal
     * cannot be dated to before or after the lock landed — which is exactly the
     * question the journal gets asked.
     */
    locked?: boolean;
    /** Short free-text context. Truncated to NOTE_MAX_CHARS. */
    note?: string;
}
/** What the caller supplies; `ts`, `actor`, and `pid` are filled in here. */
export type JournalEventInput = Omit<RegistryJournalEvent, 'ts' | 'actor' | 'pid'> & {
    actor?: JournalActor;
};
export declare const JOURNAL_FILENAME = "registry-journal.jsonl";
export declare const JOURNAL_ROTATED_FILENAME = "registry-journal.1.jsonl";
/**
 * Conflict records are ALSO written to their own file.
 *
 * The main journal rotates by size, and its volume is dominated by routine
 * `load` records whose rate is set by callers — including, before the loopback
 * guard landed, unauthenticated HTTP GETs. That means a flood of worthless
 * reads could rotate away the handful of `conflict` records the journal exists
 * to produce: the eviction predicate discards the highest-value records
 * alongside the highest-volume ones.
 *
 * Conflicts are rare by construction (each one is a real detected race), so a
 * dedicated file with its own budget holds far more history in far less space,
 * and no amount of read traffic can flush it.
 */
export declare const CONFLICTS_FILENAME = "registry-conflicts.jsonl";
export declare const CONFLICTS_ROTATED_FILENAME = "registry-conflicts.1.jsonl";
/**
 * Default rotation threshold.
 *
 * Records measure 110-140 bytes, so this holds roughly 40,000 RECORDS. That is
 * not the same as 40,000 operations: one registry write emits about three
 * records (the caller's load, the compare-and-swap re-read, and the write
 * itself), so the practical capacity is ~13,000 operations before the live
 * generation rotates.
 */
export declare const DEFAULT_MAX_BYTES = 5000000;
/** Journaling is on by default; `NAVGATOR_REGISTRY_JOURNAL=0` turns it off. */
export declare function journalEnabled(): boolean;
/**
 * The default registry directory. Resolved through `os.homedir()`, which
 * honours `$HOME` on POSIX — the same resolution `src/projects.ts` uses, so a
 * test that redirects HOME redirects the journal with it.
 */
export declare function defaultRegistryDir(): string;
/**
 * Journal path derived from whichever directory holds the registry being
 * operated on — NOT hardcoded to the home directory.
 *
 * This is what keeps a test that points a reader at a tmp registry (see
 * `loadRegisteredProjectPaths`, which takes an arbitrary `registryPath`) from
 * appending to the user's real journal.
 */
export declare function journalPathForDir(dir: string): string;
/** Path of the dedicated conflict log for a registry directory. */
export declare function conflictsPathForDir(dir: string): string;
/** Journal path for a registry *file* path. */
export declare function journalPathForRegistry(registryPath: string): string;
/**
 * Resolve which surface we are. `NAVGATOR_JOURNAL_ACTOR` wins so the MCP server
 * and the dashboard can declare themselves explicitly; otherwise the entry
 * script name decides.
 *
 * Not cached when the env var is set, so a test can flip actors without a
 * module reload.
 */
export declare function resolveActor(): JournalActor;
/** Test seam: forget a previously detected actor. */
export declare function resetActorCache(): void;
/**
 * 16-hex sha256 prefix of a registry's serialized form. Enough to answer "did
 * this write land the content I built?" across ~33k journal records without
 * storing any of the content itself.
 */
export declare function registryDigest(value: unknown): string;
/**
 * Append one record, synchronously.
 *
 * `appendFileSync` with the default `'a'` flag issues a single O_APPEND write.
 * For a record this small that is atomic against concurrent appenders on both
 * Linux and macOS, which is why interleaved writers from several processes
 * produce whole lines rather than shredded ones.
 *
 * Errors are swallowed deliberately — see the module comment.
 */
export declare function appendJournalEventSync(dir: string, input: JournalEventInput): void;
/**
 * Append one record without blocking the event loop.
 *
 * Resolves even on failure, so `await` at a call site can never turn a journal
 * problem into a registry problem.
 */
export declare function appendJournalEvent(dir: string, input: JournalEventInput): Promise<void>;
export interface ReadJournalOptions {
    /** Registry directory. Defaults to `~/.navgator`. */
    dir?: string;
    /** Most recent N records. Default 50. */
    limit?: number;
    /** Only records from this actor. */
    actor?: JournalActor;
    /** Only records with this op. */
    op?: JournalOp;
    /** Only `conflict` records. Overrides `op`. */
    conflictsOnly?: boolean;
    /** Include the rotated generation when the live file is short. Default true. */
    includeRotated?: boolean;
}
/**
 * Read recent journal records, newest last.
 *
 * A truncated final line (a process killed mid-append) is skipped rather than
 * throwing — the point of an append-only log is that the intact records stay
 * readable when one is not.
 */
export declare function readJournal(options?: ReadJournalOptions): RegistryJournalEvent[];
export interface FormatJournalOptions {
    /** True when the caller narrowed the read with --actor/--op/--conflicts. */
    filtered?: boolean;
}
/** Human-readable rendering for `navgator registry-log`. */
export declare function formatJournal(events: RegistryJournalEvent[], options?: FormatJournalOptions): string;
//# sourceMappingURL=registry-journal.d.ts.map