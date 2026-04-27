/**
 * NavGator Impact Analysis
 * Severity-scored impact analysis with transitive dependency tracking
 */
import { ArchitectureComponent, ArchitectureConnection, ImpactAnalysis, ImpactSeverity } from './types.js';
/**
 * Compute severity level for a component based on its role and dependent count.
 *
 * - critical: database/infra layer, or >5 dependents, or role.critical
 * - high: backend layer, or 3-5 dependents
 * - medium: 2 dependents
 * - low: 0-1 dependents
 */
export declare function computeSeverity(component: ArchitectureComponent, dependentCount: number): ImpactSeverity;
/**
 * Compute full impact analysis for a component.
 * Includes direct and one-level transitive dependents.
 */
export declare function computeImpact(component: ArchitectureComponent, allComponents: ArchitectureComponent[], allConnections: ArchitectureConnection[]): ImpactAnalysis;
//# sourceMappingURL=impact.d.ts.map