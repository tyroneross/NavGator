/**
 * Shallow-clone (or refresh) a validated GitHub repo into a per-repo cache
 * directory under `~/.navgator/cache/remote/<owner>/<repo>`.
 *
 * Security posture: every git invocation uses an argv ARRAY with
 * `shell: false` (never a template string, never `exec`/`execSync`), an
 * explicit timeout, and a hardened child environment so git can never
 * block on a credential prompt or read ambient system config. The exec
 * implementation is injectable so tests never touch the network.
 */
import { type ExecFileOptions } from 'child_process';
export interface GithubCloneTarget {
    owner: string;
    repo: string;
    ref?: string;
}
export interface ExecFileResult {
    stdout: string;
    stderr: string;
}
/** Injectable exec seam. Defaults to a promisified `child_process.execFile`. */
export type ExecFileImpl = (file: string, args: string[], options: ExecFileOptions) => Promise<ExecFileResult>;
export interface EnsureCloneOptions {
    /** Override the cache root — test seam. Defaults to `~/.navgator/cache/remote`. */
    cacheRoot?: string;
    /** Force a clean re-clone instead of a shallow fetch + hard reset. */
    refresh?: boolean;
    /** Explicit timeout in ms for every git invocation. Default 30s. */
    timeoutMs?: number;
    /** Injected exec implementation — test seam, never touches the network. */
    execFileImpl?: ExecFileImpl;
}
export interface EnsureCloneResult {
    /** Absolute path to the checked-out repo. */
    dir: string;
    /** True if this call performed a fresh `git clone`; false if it refreshed an existing cache entry. */
    cloned: boolean;
}
export declare function defaultCacheRoot(): string;
/**
 * Ensure a validated {owner, repo, ref} target is cloned (or refreshed) in
 * the cache and return its on-disk path. Never accepts a raw URL string —
 * callers must pass output already validated by `parseGitHubUrl`.
 */
export declare function ensureClone(target: GithubCloneTarget, opts?: EnsureCloneOptions): Promise<EnsureCloneResult>;
//# sourceMappingURL=clone.d.ts.map