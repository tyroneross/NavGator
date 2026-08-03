import type { Snapshot } from '../types.js';
export interface WriteSnapshotResult {
    /** Absolute path the snapshot was written to. */
    path: string;
    /** The resolved current ref (branch name, or short sha when detached). `null` in a non-git dir. */
    ref: string | null;
    /** Whether this write landed in `canonical/` (true) or `branches/<slug>/` (false). */
    isDefault: boolean;
}
/**
 * Build a fresh snapshot from the current on-disk architecture data
 * (`buildCurrentSnapshot()`, which itself loads components/connections from
 * storage — no components/connections are threaded through this function)
 * and write it to the canonical path when on the default branch, or the
 * current ref's branch-delta path otherwise.
 *
 * In a non-git directory (or when the ref can't be resolved), the write
 * falls back to a branch path keyed by the literal ref `"unknown"` rather
 * than silently overwriting `canonical/` — canonical writes require a
 * positively-confirmed default branch.
 */
export declare function writeSnapshotForCurrentRef(root: string): Promise<WriteSnapshotResult>;
/** Read the canonical (default-branch) snapshot. `null` if it has never been written or is corrupt. */
export declare function readCanonicalSnapshot(root: string): Promise<Snapshot | null>;
/**
 * Read a branch-delta snapshot. Defaults to the current ref when `ref` is
 * omitted. `null` if there is no snapshot for that ref, the ref can't be
 * resolved, or the file is corrupt.
 */
export declare function readBranchSnapshot(root: string, ref?: string): Promise<Snapshot | null>;
/**
 * Remove branch-delta snapshots for refs that no longer exist. `liveRefs` is
 * the caller-supplied list of refs that ARE still live (e.g. from `git
 * branch --list` plus any active worktrees); any on-disk slug directory
 * under `branches/` whose name is not among the slugs of `liveRefs` is
 * deleted. Never throws; a missing `branches/` directory is a no-op.
 */
export declare function pruneBranchSnapshots(root: string, liveRefs: string[]): Promise<{
    removed: string[];
}>;
//# sourceMappingURL=canonical.d.ts.map