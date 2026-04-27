/**
 * Scan concurrency lock (Run 1.6 — item #4).
 *
 * Prevents two `navgator scan` processes from corrupting each other's
 * .navgator/architecture/ output. Lock file at `<storeDir>/scan.lock`
 * with `{pid, started_at, scan_type}`.
 *
 * Stale lock (>10 min OR PID gone) → auto-cleared on entry.
 * Live lock → second scan exits cleanly with a message and returns
 * `{ ok: false, message }` so the caller can surface the message and
 * exit 0 (not crash).
 *
 * The release function MUST be called in a `finally` block so the lock
 * releases on error paths too.
 */
export declare const LOCK_FILENAME = "scan.lock";
export declare const STALE_LOCK_MS: number;
export type LockResult = {
    ok: true;
    release: () => void;
} | {
    ok: false;
    message: string;
};
/**
 * Try to acquire an exclusive scan lock.
 *
 * - On success: returns `{ ok: true, release }`. Caller MUST call `release()`
 *   in a `finally` block.
 * - On contention with a live, non-stale lock: returns `{ ok: false, message }`.
 *   The caller should surface the message and exit cleanly (code 0).
 *
 * Stale locks (older than `STALE_LOCK_MS` OR pid no longer alive) are
 * auto-cleared and the call falls through to acquisition.
 */
export declare function acquireLock(storeDir: string, scanType?: string): LockResult;
//# sourceMappingURL=scan-lock.d.ts.map