/**
 * Resolve the default branch: origin's symbolic HEAD, then
 * `init.defaultBranch`, then a local `main`, then a local `master`.
 * Returns `null` when none resolves (including a non-git directory).
 */
export declare function getDefaultBranch(root: string): Promise<string | null>;
/** Current branch name via `git rev-parse --abbrev-ref HEAD`; `null` on failure. */
export declare function getCurrentBranch(root: string): Promise<string | null>;
/**
 * Current ref for branch-delta storage: the branch name, or (detached HEAD)
 * the short commit sha. `null` on failure / non-git directory.
 */
export declare function getCurrentRef(root: string): Promise<string | null>;
/** True only when the current branch equals the resolved default branch. */
export declare function isDefaultBranch(root: string): Promise<boolean>;
/**
 * True when `root` is a linked worktree — in a linked worktree `.git` is a
 * FILE (containing `gitdir: <path>`), not a directory. False for a normal
 * repo, a bare repo root, or any non-git directory. Never throws.
 */
export declare function isWorktree(root: string): boolean;
/**
 * Map a git ref to a filesystem-safe slug: `/` becomes `__`, every other
 * character outside `[A-Za-z0-9._-]` becomes `_`, the result is capped at
 * 100 characters, and an 8-character hash of the ORIGINAL ref is appended
 * whenever sanitization or truncation actually changed the string. A ref
 * that passes through unchanged carries no hash suffix — this is what stops
 * `feat/a` and `feat_a` colliding on one snapshot file without adding noise
 * to ordinary branch names.
 */
export declare function slugifyRef(ref: string): string;
//# sourceMappingURL=refs.d.ts.map