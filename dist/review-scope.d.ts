export interface ReviewScope {
    available: boolean;
    reason?: string;
    base_ref: string | null;
    branch_base_known: boolean;
    scope_prefix: string | null;
    outside_scope: number;
    counts: {
        committed: number;
        staged: number;
        unstaged: number;
        untracked: number;
        total: number;
    };
    changed_sample: string[];
    omitted_changed: number;
    scan: {
        status: 'fresh' | 'stale' | 'missing' | 'invalid';
        last_scan: number | null;
        age_hours: number | null;
    };
    behavioral_review: {
        required: boolean;
        matched_count: number;
        sample: string[];
    };
}
/** Includes branch delta and every live checkout surface; samples are bounded. */
export declare function collectReviewScope(projectRoot: string, now?: number, prefix?: string): Promise<ReviewScope>;
//# sourceMappingURL=review-scope.d.ts.map