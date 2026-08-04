/**
 * NavGator Explore Report
 *
 * Single shared implementation of the `explore` composite, used by both the
 * `navgator explore` CLI command and the MCP `explore` tool handler. Builds a
 * structured report from the architecture graph, then formats it to the
 * human-readable text that predates this module (byte-identical to the prior
 * inline implementation in src/mcp/tools.ts).
 */
import type { ArchitectureLayer, ImpactSeverity } from "./types.js";
export interface ExploreComponentInfo {
    name: string;
    type: string;
    layer: ArchitectureLayer;
    status: string;
    purpose: string;
}
export interface ExploreRuntimeInfo {
    engine?: string;
    service_name?: string;
    platform?: string;
    host?: string;
    port?: number;
    connection_env_var?: string;
}
export interface ExploreConnectionSummary {
    name: string;
    connection_type: string;
}
export interface ExploreTracePath {
    names: string[];
}
export interface ExploreTraceSummary {
    paths: ExploreTracePath[];
    layers_crossed: ArchitectureLayer[];
}
export interface ExploreImpactSummary {
    severity: ImpactSeverity;
    total_files_affected: number;
    summary: string;
}
export interface ExploreReport {
    component: ExploreComponentInfo;
    runtime?: ExploreRuntimeInfo;
    impact: ExploreImpactSummary;
    outgoing: ExploreConnectionSummary[];
    incoming: ExploreConnectionSummary[];
    trace: ExploreTraceSummary;
}
export interface ExploreReportError {
    error: string;
    candidates?: string[];
}
/**
 * Build a structured explore report for `query` (a component name, ID, or
 * file path). Returns an error shape when there is no architecture data, or
 * when `query` does not resolve to a component (with "did you mean"
 * candidates when any are close enough to suggest).
 */
export declare function buildExploreReport(query: string, opts?: {
    projectRoot?: string;
    depth?: number;
}): Promise<ExploreReport | ExploreReportError>;
/**
 * Render an ExploreReport to the human-readable text NavGator has always
 * produced for `explore`. Kept byte-identical to the pre-refactor inline
 * implementation so existing tests and the release verifier keep matching.
 */
export declare function formatExploreReport(report: ExploreReport): string;
//# sourceMappingURL=explore-report.d.ts.map