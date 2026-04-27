/**
 * Git-backed temporal store for `.navgator/` snapshots.
 *
 * Architecture: a NESTED git repository at `<storage>/.git` — the parent
 * project's git is untouched, the parent project's `.gitignore` already
 * excludes `.navgator/architecture/`, so this nested `.git` is invisible
 * upstream. No orphan branches, no main-repo pollution.
 *
 * Author config: `navgator-bot <noreply@navgator.local>` — never reads
 * the user's global git identity.
 */
export interface CommitResult {
    ok: boolean;
    sha?: string;
    empty?: boolean;
    error?: string;
}
export interface SnapshotEntry {
    sha: string;
    short_sha: string;
    date: string;
    subject: string;
}
/** Returns true if `<storeDir>/.git` exists (initialized). */
export declare function isInitialized(storeDir: string): boolean;
/** Initialize the nested git store if not already present. Idempotent. */
export declare function ensureInitialized(storeDir: string): {
    ok: boolean;
    created: boolean;
    error?: string;
};
/**
 * Stage everything in storeDir and commit. No-op (returns empty:true) when
 * there are no changes since the last commit.
 */
export declare function commitScan(storeDir: string, message: string): CommitResult;
/** List recent snapshots, newest first. */
export declare function listSnapshots(storeDir: string, limit?: number): SnapshotEntry[];
/**
 * Find the first commit that introduced a literal string (e.g. a stable_id
 * or component_id) into the store. Uses `git log -S` (pickaxe) which scans
 * the diff for the literal — excellent for "when did this component first
 * appear?" queries. Returns the OLDEST matching commit.
 */
export declare function findFirstSeen(storeDir: string, needle: string): SnapshotEntry | null;
/**
 * `git diff --stat <ref>..HEAD` — file-level summary of changes since a
 * reference (sha or tag). Returns the raw `--stat` output as a string,
 * suitable for piping to a markdown code block.
 */
export declare function diffSince(storeDir: string, ref: string): {
    ok: boolean;
    stat: string;
    error?: string;
};
/**
 * Read a file's contents at a historical sha — `git show <sha>:<path>`.
 * `relPath` is relative to storeDir.
 */
export declare function showFileAt(storeDir: string, sha: string, relPath: string): {
    ok: boolean;
    content?: string;
    error?: string;
};
//# sourceMappingURL=git-store.d.ts.map