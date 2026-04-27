/**
 * NavGator Agent Output
 * Stable envelope format and executive summary for machine consumers
 */
import { ArchitectureComponent, ArchitectureConnection, GitInfo, ExecutiveSummary } from './types.js';
/**
 * Wrap any command output in a stable envelope for machine consumers.
 * Keys are sorted at the top level for deterministic output.
 */
export declare function wrapInEnvelope<T>(command: string, data: T, metadata?: Record<string, unknown>): string;
/**
 * Build an executive summary for agent orientation.
 * Uses compact component/connection forms for token efficiency.
 */
export declare function buildExecutiveSummary(components: ArchitectureComponent[], connections: ArchitectureConnection[], projectPath: string, git?: GitInfo): ExecutiveSummary;
//# sourceMappingURL=agent-output.d.ts.map