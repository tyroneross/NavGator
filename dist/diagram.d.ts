/**
 * NavGator Diagram Generator
 * Creates Mermaid diagrams from the architecture graph
 */
import { ConnectionGraph, ArchitectureLayer, ConnectionType } from './types.js';
export interface DiagramOptions {
    title?: string;
    direction?: 'TB' | 'BT' | 'LR' | 'RL';
    includeSubgraphs?: boolean;
    includeStyles?: boolean;
    showLabels?: boolean;
    filterLayers?: ArchitectureLayer[];
    filterConnectionTypes?: ConnectionType[];
    maxNodes?: number;
}
/**
 * Generate a Mermaid diagram from a connection graph
 */
export declare function generateMermaidDiagram(graph: ConnectionGraph, options?: DiagramOptions): string;
/**
 * Generate a flowchart focused on a specific component
 */
export declare function generateComponentDiagram(graph: ConnectionGraph, componentId: string, depth?: number, options?: DiagramOptions): string;
/**
 * Generate a layer-focused diagram
 */
export declare function generateLayerDiagram(graph: ConnectionGraph, layer: ArchitectureLayer, options?: DiagramOptions): string;
/**
 * Generate a summary diagram with just the major components
 */
export declare function generateSummaryDiagram(graph: ConnectionGraph, options?: DiagramOptions): string;
/**
 * Wrap diagram in markdown code block
 */
export declare function wrapInMarkdown(diagram: string, title?: string): string;
//# sourceMappingURL=diagram.d.ts.map