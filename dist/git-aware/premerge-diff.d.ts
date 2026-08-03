import type { DiffResult, DiffSignificance, DiffTrigger } from '../types.js';
export interface PremergeDiffOptions {
    /** Named base ref to diff against (its branch-delta snapshot). Omit to use the canonical baseline. */
    base?: string;
}
export interface PremergeDiffResult {
    /** Label for the comparison base: the named `--base` ref, or `'canonical'` when none was given. */
    base: string;
    /** The resolved current ref (branch name, or short sha when detached). `null` in a non-git directory. */
    head: string | null;
    /** False whenever either snapshot is missing or corrupt — the diff/significance fields are absent in that case. */
    available: boolean;
    /** Actionable explanation, present only when `available` is false. */
    reason?: string;
    /** Present only when `available` is true. */
    diff?: DiffResult;
    /** Present only when `available` is true. */
    significance?: {
        significance: DiffSignificance;
        triggers: DiffTrigger[];
    };
}
/**
 * Compute the pre-merge diff between the base snapshot (canonical, or the
 * named `--base` ref's branch-delta snapshot) and the current branch's
 * snapshot.
 *
 * Never throws: a missing or corrupt snapshot on either side degrades to
 * `available: false` with a `reason` explaining what to run to fix it.
 */
export declare function premergeDiff(root: string, opts?: PremergeDiffOptions): Promise<PremergeDiffResult>;
//# sourceMappingURL=premerge-diff.d.ts.map