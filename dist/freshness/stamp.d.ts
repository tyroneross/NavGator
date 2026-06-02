export interface FreshnessStamp {
    version: 1;
    /** epoch ms of the last clean drain (scan completion). */
    generated_at: number;
    /** short commit sha the graph was generated against ('' if not a git repo). */
    commit_sha: string;
    /** branch name ('' if unknown). */
    branch: string;
    /** files changed since generated_at and not yet drained. */
    dirty_files: string[];
    dirty_count: number;
    /** true while a drain is mid-flight. */
    scan_in_flight: boolean;
}
export declare function writeStamp(root: string, stamp: FreshnessStamp): void;
export declare function readStamp(root: string): FreshnessStamp | null;
/**
 * Compute a stamp for the current moment. `inFlight` marks a drain in progress;
 * `generatedAt` defaults to now (use the scan completion time on a clean drain).
 */
export declare function computeStamp(root: string, opts?: {
    inFlight: boolean;
    generatedAt?: number;
}): Promise<FreshnessStamp>;
//# sourceMappingURL=stamp.d.ts.map