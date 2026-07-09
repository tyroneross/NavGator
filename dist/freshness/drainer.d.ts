/**
 * The background drainer. Coalesces the dirty set and runs one incremental scan
 * through scan()'s single-writer lease, then writes an honest stamp. Designed to be
 * invoked repeatedly and cheaply (by the hook, the orchestrator, or a timer):
 *  - busy      -> scan() could not acquire the shared lease; dirty work stays.
 *  - debounced -> a drain ran within minIntervalMs; skipped (dirty set kept).
 *  - clean     -> nothing dirty; stamp refreshed only.
 *  - drained   -> scanned, cleared the drained subset, stamp updated.
 *  - error     -> scan threw; dirty set left intact for a retry.
 */
import { type DirtyLedgerSnapshot } from './dirty-ledger.js';
export type DrainStatus = 'busy' | 'debounced' | 'clean' | 'drained' | 'error';
export interface DrainResult {
    status: DrainStatus;
    scanned: number;
    error?: string;
}
export interface DrainOptions {
    /** Injected scanner. `scan()` itself is the sole scan-lease owner. */
    scanFn: (root: string, changed: string[], lifecycle: DrainScanLifecycle) => Promise<DrainScanOutcome>;
    /** Skip if the last stamp was generated within this window (default 3000ms). */
    minIntervalMs?: number;
    /** Test-only seam for an edit arriving after an empty snapshot. */
    _afterEmptySnapshot?: () => void;
}
export type DrainScanOutcome = {
    status: 'completed' | 'noop';
    retryable?: false;
} | {
    status: 'busy';
    retryable: true;
    message: string;
};
export interface DrainScanLifecycle {
    onLeaseAcquired: () => Promise<void>;
    beforeLeaseRelease: () => Promise<void>;
    onLeaseFailureBeforeRelease: () => Promise<void>;
}
export { captureDirtySnapshot, type DirtyLedgerSnapshot } from './dirty-ledger.js';
export declare function drain(root: string, opts: DrainOptions): Promise<DrainResult>;
export interface DrainUntilCleanOptions extends DrainOptions {
    /** Max drain attempts before giving up (default 12). Bounds worst-case time. */
    maxAttempts?: number;
    /** Override the post-attempt wait; defaults to minIntervalMs (busy waits less). */
    waitMs?: number;
}
/**
 * Trailing-edge guarantee. A single `drain()` can leave the *final* edits of a
 * burst undrained (debounced) or skipped (busy). This loops past those states —
 * sleeping out the debounce window between tries — until the ledger is actually
 * empty, so the view self-heals within ~minIntervalMs of edits stopping instead
 * of waiting for the 5-minute autoRefresh backstop. The hook spawns this
 * detached, so the sleeps never block an edit. Returns every attempt's result.
 */
export declare function drainUntilClean(root: string, opts: DrainUntilCleanOptions): Promise<DrainResult[]>;
/**
 * Stamp coherence for scans that do not originate in the drainer. For example,
 * `autoRefreshIfStale` captures this snapshot, forces its paths into an auto-mode
 * scan, then reconciles before releasing the scan lease. Only the captured
 * immutable events are cleared; events arriving during the scan remain dirty.
 */
export declare function reconcileClean(root: string, snapshot?: DirtyLedgerSnapshot): Promise<void>;
//# sourceMappingURL=drainer.d.ts.map