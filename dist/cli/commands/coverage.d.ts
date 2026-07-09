import { Command } from 'commander';
import { type CoverageReport } from '../../coverage.js';
export declare function buildCoverageAgentData(report: CoverageReport): {
    gaps: import("../../coverage.js").CoverageGap[];
    gap_summary: {
        total: number;
        returned: number;
        truncated: boolean;
    };
    truncation: {
        gaps: import("../../types.js").AgentCollectionWindow;
    };
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
};
export declare function registerCoverageCommand(program: Command): void;
//# sourceMappingURL=coverage.d.ts.map