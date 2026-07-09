/**
 * NavGator Agent Output
 * Stable envelope format and executive summary for machine consumers
 */
import { ArchitectureComponent, ArchitectureConnection, GitInfo, AgentCollectionWindow, ExecutiveSummary } from './types.js';
/** Hard caps keep machine-facing output predictable on large repositories. */
export declare const AGENT_OUTPUT_LIMITS: {
    readonly risks: 20;
    readonly blockers: 20;
    readonly nextActions: 12;
    readonly components: 50;
    readonly connections: 100;
    readonly ruleViolations: 20;
    readonly commandItems: 50;
};
export interface BoundedAgentCollection<T> {
    items: T[];
    truncation: AgentCollectionWindow;
}
/** Return a deterministic prefix plus explicit total/returned accounting. */
export declare function boundAgentCollection<T>(items: readonly T[], limit?: number): BoundedAgentCollection<T>;
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