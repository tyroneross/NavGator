/**
 * NavGator Review Report
 *
 * Single shared implementation of the `review` composite, used by both the
 * `navgator review` CLI command and the MCP `review` tool handler. Builds a
 * structured report from the architecture graph, then formats it to the
 * human-readable text that predates this module (byte-identical to the prior
 * inline implementation in src/mcp/tools.ts).
 */
import { type RuleViolation } from "./rules.js";
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
}): Promise<ReviewReport | ReviewReportError>;
/**
 * Render a ReviewReport to the human-readable text NavGator has always
 * produced for `review`. Kept byte-identical to the pre-refactor inline
 * implementation so existing tests and the release verifier keep matching.
 */
export declare function formatReviewReport(report: ReviewReport): string;
//# sourceMappingURL=review-report.d.ts.map