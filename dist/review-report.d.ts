/**
 * NavGator Review Report
 *
 * Single shared implementation of the `review` composite, used by both the
 * `navgator review` CLI command and the MCP `review` tool handler. Builds a
 * structured report from the architecture graph, then formats it to the
 * human-readable architecture text with additive live-coverage lines.
 */
import { type RuleViolation } from "./rules.js";
import { type ReviewScope } from "./review-scope.js";
import type { ImpactSeverity } from "./types.js";
export interface ReviewFocusSummary {
    component_name: string;
    severity: ImpactSeverity;
    summary: string;
    affected: string[];
}
export interface ReviewLLMSummary {
    use_cases: number;
    providers: number;
}
export interface ReviewReport {
    violations: RuleViolation[];
    /** Present only when `opts.component` was given AND resolved to a real component. */
    focus?: ReviewFocusSummary;
    /** Runtime resource_type -> count, in first-seen order. Empty when nothing has runtime identity. */
    runtime_topology: Record<string, number>;
    /** Present only when at least one deduplicated LLM use case was found. */
    llm?: ReviewLLMSummary;
    /** Live checkout coverage and age of the stored architecture scan. */
    review_scope?: ReviewScope;
}
export interface ReviewReportError {
    error: string;
}
/**
 * Build a structured review report. `opts.component`, when given, focuses
 * one section of the report on that component's impact — matching the
 * original behavior, an unresolvable `opts.component` is silently ignored
 * rather than treated as an error (only "no architecture data" errors).
 */
export declare function buildReviewReport(opts?: {
    projectRoot?: string;
    component?: string;
    pathPrefix?: string;
}): Promise<ReviewReport | ReviewReportError>;
/**
 * Render a ReviewReport with additive live coverage warnings for Git worktrees.
 * Missing Git inventory remains visible as an incomplete-coverage warning.
 */
export declare function formatReviewReport(report: ReviewReport): string;
//# sourceMappingURL=review-report.d.ts.map