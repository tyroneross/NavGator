export declare const LOCK_TTL_MS = 60000;
/** Try to take the lock. Returns true on success, false if a live lock exists. */
export declare function acquireLock(root: string): boolean;
/** Refresh the heartbeat mid-scan (call periodically for long scans). */
export declare function touchLock(root: string): void;
/** Release the lock if we own it. */
export declare function releaseLock(root: string): void;
//# sourceMappingURL=scan-lock.d.ts.map