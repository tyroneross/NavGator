/**
 * Cross-process advisory lock for the project registry.
 *
 * ## Why a lock at all
 *
 * Version-stamped compare-and-swap alone does NOT prevent lost updates. Two
 * writers that start in the same tick both read revision R before either
 * saves, so both pass their own CAS check and both write R+1 — one entry is
 * lost, and neither writer ever sees a mismatch to journal. CAS catches the
 * unlucky interleaving; it is blind to the lockstep one, which is the common
 * case when a dashboard request and a CLI scan land together. Mutual exclusion
 * is what actually closes it. CAS stays on top as the detector for anything
 * that slips past (a writer that ignored the lock, a stale steal, a filesystem
 * that does not honour O_EXCL).
 *
 * ## Why not `acquireScanLease` (src/scan-lock.ts)
 *
 * NavGator already ships a hardened cross-process lease, reused for a non-scan
 * path by `withDirtyLedgerMutationLock` (src/freshness/dirty-ledger.ts). It is
 * the right primitive for scans and the wrong one here, for two checkable
 * reasons:
 *
 * 1. **Both writers must share one protocol or the lock is worthless.** The
 *    second registry writer is the Next.js dashboard, which compiles as a
 *    separate unit with its own node_modules and cannot import `src/`. A lock
 *    only one of the two contending processes takes provides no exclusion at
 *    all. So the protocol has to be simple enough to mirror byte-for-byte —
 *    `open(path, 'wx')` plus a JSON record is; scan-lock's O_EXCL-candidate +
 *    hard-link publication + generation-tokened recovery election is not.
 * 2. **`acquireScanLease` is synchronous, and its retry helper blocks.**
 *    `withDirtyLedgerMutationLock` spins on `Atomics.wait` (dirty-ledger.ts:126),
 *    which parks the whole thread. In the CLI that is merely rude; inside the
 *    Next.js server it would stall every concurrent request for the duration of
 *    the wait. Registry writes need an async acquire.
 *
 * This is deliberately NOT a third general-purpose lock: it is scoped to one
 * file, is not exported beyond the registry modules, and holds its critical
 * section for a single load-mutate-save — measured at ~8-9 ms on a real
 * 1434-entry / ~500 KB registry, both uncontended and under 12-way contention.
 * A contended write can run up to MAX_CAS_ATTEMPTS cycles inside that section,
 * so treat the figure as the common case, not a ceiling.
 *
 * ## Deadlock safety
 *
 * The registry lock is a leaf. `scan()` acquires the scan lease on
 * `<project-root>/.navgator/scan.lock` and then calls `registerProject`, which
 * takes this lock on `~/.navgator/projects.json.lock` — a different resource in
 * a different directory. Nothing acquires a scan lease while holding the
 * registry lock, so there is no lock-ordering cycle.
 *
 * ## Failure policy
 *
 * Fail-open. If the lock cannot be acquired within the budget, the caller
 * proceeds unlocked and records that it did. A registry write is non-critical
 * to the scan that triggered it, and a wedged lock must never be able to stop
 * NavGator from working. The residual race is then caught by CAS and journaled.
 *
 * Mirrored at `web/lib/server/registry-lock.ts`; both write the SAME lock file
 * with the SAME record shape, which is the entire point. The shared oracle in
 * `src/__tests__/registry-concurrency-oracle.test.ts` holds them to it.
 */
export declare const REGISTRY_LOCK_FILENAME = "projects.json.lock";
/**
 * A lock older than this is treated as abandoned.
 *
 * MUST stay below LOCK_ACQUIRE_TIMEOUT_MS. With the reverse ordering an
 * orphaned lock is unreclaimable within a single acquire: the acquirer spends
 * its whole budget polling a lock that has not yet aged out, gives up, and
 * proceeds unlocked. Measured with the original 10s/2s pair, a lock orphaned 3s
 * earlier returned `acquired: false` after 2008 ms, and EVERY writer in EVERY
 * process ran unprotected for the remaining 7s — disabling the one mechanism
 * that prevents cross-process loss, on top of a 2s stall each.
 *
 * 3 s is still ~375x the measured critical section (~8 ms under 12-way
 * contention on a 1434-entry registry), so a responsive holder is not stolen
 * from. A holder stalled longer than this — a long GC pause, a suspended
 * laptop, a hung network mount — CAN be stolen from: there is no heartbeat.
 * That overlap is caught by the revision compare-and-swap and journaled as a
 * conflict, which is why the CAS layer exists underneath this one.
 */
export declare const LOCK_STALE_MS = 3000;
/**
 * Total acquire budget before giving up and proceeding unlocked. Deliberately
 * longer than LOCK_STALE_MS so one acquire can always outlast an orphan.
 */
export declare const LOCK_ACQUIRE_TIMEOUT_MS = 5000;
export interface RegistryLockHandle {
    /** False when the budget expired and the caller is proceeding unlocked. */
    acquired: boolean;
    /** Milliseconds spent waiting. */
    waitedMs: number;
    /** Idempotent, owner-safe: removes the file only if this holder still owns it. */
    release: () => Promise<void>;
}
export declare function registryLockPath(dir: string): string;
export interface AcquireOptions {
    timeoutMs?: number;
    staleMs?: number;
}
/**
 * Acquire the registry lock, or return `acquired: false` once the budget is
 * spent. Never throws: contention returns `acquired: false`, and so does a
 * genuine filesystem failure, so a writer is never blocked by the lock's own
 * problems.
 */
export declare function acquireRegistryLock(dir: string, options?: AcquireOptions): Promise<RegistryLockHandle>;
/**
 * Run `fn` under the registry lock. `fn` receives whether the lock was actually
 * held, so a caller can record an unlocked write rather than pretend it was
 * serialized. Always releases, including on throw.
 */
export declare function withRegistryFileLock<T>(dir: string, fn: (acquired: boolean) => Promise<T>, options?: AcquireOptions): Promise<T>;
//# sourceMappingURL=registry-lock.d.ts.map