/**
 * NavGator Coverage / Confidence Reporting
 * Measures architecture tracking coverage and identifies gaps
 */
import { ArchitectureComponent, ArchitectureConnection } from './types.js';
export interface CoverageGap {
    type: 'unmapped-file' | 'low-confidence-connection' | 'zero-consumers' | 'no-outgoing';
    target: string;
    message: string;
}
export interface CoverageReport {
    overall_confidence: number;
    component_coverage: {
        total_files_in_project: number;
        files_mapped_to_components: number;
        coverage_percent: number;
    };
    connection_coverage: {
        total_connections: number;
        by_confidence: {
            high: number;
            medium: number;
            low: number;
        };
        by_classification: Record<string, number>;
    };
    gaps: CoverageGap[];
}
/**
 * Compute architecture coverage for a project.
 */
export declare function computeCoverage(components: ArchitectureComponent[], connections: ArchitectureConnection[], projectRoot: string, fileMap?: Record<string, string>): Promise<CoverageReport>;
/**
 * Format coverage report for human-readable CLI output
 */
export declare function formatCoverageOutput(report: CoverageReport, gapsOnly?: boolean): string;
//# sourceMappingURL=coverage.d.ts.map