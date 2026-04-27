/**
 * NavGator Queryable Subgraph Export
 * Extracts focused graph slices for agent consumption
 */
import { ArchitectureComponent, ArchitectureConnection, ArchitectureLayer, CompactComponent, CompactConnection } from './types.js';
export interface SubgraphOptions {
    focus?: string[];
    layers?: ArchitectureLayer[];
    classification?: string;
    depth?: number;
    maxNodes?: number;
    format?: 'json' | 'mermaid';
}
export interface SubgraphResult {
    components: CompactComponent[];
    connections: CompactConnection[];
    stats: {
        nodes: number;
        edges: number;
    };
}
/**
 * Extract a focused subgraph from the full architecture
 */
export declare function extractSubgraph(components: ArchitectureComponent[], connections: ArchitectureConnection[], options?: SubgraphOptions): SubgraphResult;
/**
 * Convert subgraph result to Mermaid diagram format
 */
export declare function subgraphToMermaid(result: SubgraphResult): string;
//# sourceMappingURL=subgraph.d.ts.map