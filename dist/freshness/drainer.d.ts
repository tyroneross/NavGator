export type DrainStatus = 'busy' | 'debounced' | 'clean' | 'drained' | 'error';
export interface DrainResult {
    status: DrainStatus;
    scanned: number;
    error?: string;
}
export interface DrainOptions {
    /** Injected scanner. Production passes a wrapper over NavGator `scan()`. */
    scanFn: (root: string, changed: string[]) => Promise<void>;
    /** Skip if the last stamp was generated within this window (default 3000ms). */
    minIntervalMs?: number;
}
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
 * Stamp coherence for out-of-band scans. NavGator's existing `autoRefreshIfStale`
 * backstop runs an incremental scan WITHOUT going through the drainer, which
 * would leave the dirty ledger and stamp stale — making the stamp lie (report
 * dirty when the graph is actually current). Call this after any such scan to
 * reconcile: the incremental scan already covered every changed file via hashes,
 * so the whole ledger is safely cleared and a clean stamp written. Best-effort.
 */
export declare function reconcileClean(root: string): Promise<void>;
//# sourceMappingURL=drainer.d.ts.map