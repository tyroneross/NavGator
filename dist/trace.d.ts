/**
 * NavGator Dataflow Trace
 * Follows an entity end-to-end across architecture layers via BFS
 */
import { ArchitectureComponent, ArchitectureConnection, ArchitectureLayer, CompactComponent, CompactConnection } from './types.js';
export interface TraceStep {
    component: CompactComponent;
    connection?: CompactConnection;
    file?: string;
    line?: number;
}
export interface TracePath {
    steps: TraceStep[];
    classification?: string;
}
export interface TraceResult {
    query: string;
    paths: TracePath[];
    components_touched: string[];
    layers_crossed: ArchitectureLayer[];
}
export interface TraceOptions {
    maxDepth?: number;
    direction?: 'forward' | 'backward' | 'both';
    filterClassification?: string;
    maxPaths?: number;
    showAll?: boolean;
}
/**
 * Trace dataflow from a starting component through the architecture graph.
 * Uses BFS to find all reachable paths up to maxDepth.
 */
export declare function traceDataflow(startComponent: ArchitectureComponent, allComponents: ArchitectureComponent[], allConnections: ArchitectureConnection[], options?: TraceOptions): TraceResult;
/**
 * Format trace result for human-readable CLI output
 */
export declare function formatTraceOutput(result: TraceResult): string;
//# sourceMappingURL=trace.d.ts.map