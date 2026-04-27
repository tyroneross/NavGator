/**
 * NavGator Semantic Connection Classification
 * Classifies connections as production, admin, analytics, test, dev-only, migration, or unknown
 */
import { ArchitectureComponent, ArchitectureConnection } from './types.js';
export type SemanticClassification = 'production' | 'admin' | 'analytics' | 'test' | 'dev-only' | 'migration' | 'unknown';
export interface SemanticInfo {
    classification: SemanticClassification;
    confidence: number;
}
/**
 * Classify a connection based on file path patterns of source and target components.
 */
export declare function classifyConnection(conn: ArchitectureConnection, fromComponent: ArchitectureComponent, toComponent: ArchitectureComponent): SemanticInfo;
/**
 * Classify all connections in a batch
 */
export declare function classifyAllConnections(connections: ArchitectureConnection[], components: ArchitectureComponent[]): Map<string, SemanticInfo>;
//# sourceMappingURL=classify.d.ts.map