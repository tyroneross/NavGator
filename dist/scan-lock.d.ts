/**
 * Owner-safe scan lease shared by every NavGator scan entrypoint.
 *
 * The caller supplies the canonical lock path (`<base>/.navgator/scan.lock`).
 * A complete record is written to an O_EXCL candidate and published with an
 * atomic no-overwrite hard link. Each owner receives a random token and keeps
 * its heartbeat current until owner-safe release.
 */
export declare const LOCK_FILENAME = "scan.lock";
/** Grace period before an unreadable/corrupt record may be recovered. */
export declare const LOCK_TTL_MS = 60000;
export declare const HEARTBEAT_INTERVAL_MS = 20000;
export interface ScanLeaseRecord {
    version: 1;
    pid: number;
    token: string;
    started_at: number;
    heartbeat_at: number;
    scan_type: string;
    /** OS process-start identity; distinguishes a recycled PID from the owner. */
    owner_fingerprint?: string;
}
export interface ScanLease {
    readonly lockPath: string;
    readonly token: string;
    /** Refresh the lease only if this owner token still owns the lock file. */
    heartbeat: () => boolean;
    /** Idempotently stop heartbeating and remove only this owner's lock file. */
    release: () => void;
}
export type ScanLeaseResult = {
    ok: true;
    lease: ScanLease;
} | {
    ok: false;
    retryable: true;
    message: string;
} | {
    ok: false;
    retryable: false;
    message: string;
};
export interface ScanLeaseOptions {
    ttlMs?: number;
    heartbeatIntervalMs?: number;
    /** Test seams; production callers should not set these. */
    now?: () => number;
    pid?: number;
    token?: string;
    isPidAlive?: (pid: number) => boolean;
    getProcessFingerprint?: (pid: number) => string | null;
    ownerFingerprint?: string;
    startHeartbeat?: boolean;
    releaseRetryMs?: number;
    gateWaitMs?: number;
    gatePollMs?: number;
    /** Test-only delay while holding the cross-process acquisition gate. */
    criticalSectionDelayMs?: number;
    /** Test seams for deterministic operational-failure coverage. */
    publishLease?: (lockPath: string, record: ScanLeaseRecord) => void;
    reclaimUnlink?: (lockPath: string) => void;
    releaseUnlink?: (lockPath: string) => void;
}
export declare function readScanLease(lockPath: string): ScanLeaseRecord | null;
/**
 * Atomically acquire the scan lease at `lockPath`.
 *
 * A live owner returns a retryable contention result. A dead owner or old
 * corrupt record is recovered once; atomic publish decides any acquisition
 * race without exposing an empty canonical file.
 */
export declare function acquireScanLease(lockPath: string, scanType?: string, options?: ScanLeaseOptions): ScanLeaseResult;
//# sourceMappingURL=scan-lock.d.ts.map