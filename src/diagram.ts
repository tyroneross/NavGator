/**
 * NavGator Diagram Generator
 * Creates Mermaid diagrams from the architecture graph
 */

import {
  ConnectionGraph,
  ArchitectureLayer,
  ConnectionType,
  GraphNode,
  GraphEdge,
} from './types.js';

// =============================================================================
// LAYER STYLING
// =============================================================================

interface LayerStyle {
  subgraphName: string;
  nodeStyle: string;
  order: number;
}

const LAYER_STYLES: Record<ArchitectureLayer, LayerStyle> = {
  frontend: {
    subgraphName: 'Frontend',
    nodeStyle: 'fill:#bbdefb,stroke:#1976d2',  // Blue
    order: 1,
  },
  backend: {
    subgraphName: 'Backend',
    nodeStyle: 'fill:#c8e6c9,stroke:#388e3c',  // Green
    order: 2,
  },
  database: {
    subgraphName: 'Database',
    nodeStyle: 'fill:#ffe0b2,stroke:#f57c00',  // Orange
    order: 3,
  },
  queue: {
    subgraphName: 'Queue',
    nodeStyle: 'fill:#e1bee7,stroke:#7b1fa2',  // Purple
    order: 4,
  },
  infra: {
    subgraphName: 'Infrastructure',
    nodeStyle: 'fill:#cfd8dc,stroke:#455a64',  // Gray
    order: 5,
  },
  external: {
    subgraphName: 'External Services',
    nodeStyle: 'fill:#ffccbc,stroke:#e64a19',  // Deep Orange
    order: 6,
  },
};

// =============================================================================
// CONNECTION STYLING
// =============================================================================

interface ConnectionStyle {
  lineStyle: string;
  label?: string;
}

const CONNECTION_STYLES: Record<ConnectionType, ConnectionStyle> = {
  'api-calls-db': {
    lineStyle: '-->',
    label: 'queries',
  },
  'frontend-calls-api': {
    lineStyle: '-->',
    label: 'calls',
  },
  'queue-triggers': {
    lineStyle: '-.->',
    label: 'triggers',
  },
  'service-call': {
    lineStyle: '-->',
    label: 'uses',
  },
  imports: {
    lineStyle: '-->',
  },
  'deploys-to': {
    lineStyle: '==>',
    label: 'deploys',
  },
  'prompt-location': {
    lineStyle: '-.->',
    label: 'defines',
  },
  'prompt-usage': {
    lineStyle: '-.->',
    label: 'uses prompt',
  },
  'uses-package': {
    lineStyle: '-->',
  },
  // Apple platform connections
  observes: {
    lineStyle: '-.->',
    label: 'observes',
  },
  'conforms-to': {
    lineStyle: '-->',
    label: 'conforms',
  },
  notifies: {
    lineStyle: '-.->',
    label: 'notifies',
  },
  stores: {
    lineStyle: '-->',
    label: 'stores',
  },
  'navigates-to': {
    lineStyle: '-->',
    label: 'navigates',
  },
  'requires-entitlement': {
    lineStyle: '-.->',
    label: 'requires',
  },
  'target-contains': {
    lineStyle: '-->',
    label: 'contains',
  },
  generates: {
    lineStyle: '==>',
    label: 'generates',
  },
  other: {
    lineStyle: '-->',
  },
};

// =============================================================================
// DIAGRAM OPTIONS
// =============================================================================

export interface DiagramOptions {
  title?: string;
  direction?: 'TB' | 'BT' | 'LR' | 'RL';  // Top-Bottom, Left-Right, etc.
  includeSubgraphs?: boolean;
  includeStyles?: boolean;
  showLabels?: boolean;
  filterLayers?: ArchitectureLayer[];
  filterConnectionTypes?: ConnectionType[];
  maxNodes?: number;
}

const DEFAULT_OPTIONS: DiagramOptions = {
  direction: 'TB',
  includeSubgraphs: true,
  includeStyles: true,
  showLabels: true,
  maxNodes: 50,
};

// =============================================================================
// DIAGRAM GENERATION
// =============================================================================

/**
 * Generate a Mermaid diagram from a connection graph
 */
export function generateMermaidDiagram(
  graph: ConnectionGraph,
  options: DiagramOptions = {}
): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const lines: string[] = [];

  // Start diagram
  lines.push(`graph ${opts.direction}`);
  lines.push('');

  // Filter nodes if needed
  let nodes = graph.nodes;
  let edges = graph.edges;

  if (opts.filterLayers && opts.filterLayers.length > 0) {
    nodes = nodes.filter(n => opts.filterLayers!.includes(n.layer));
    const nodeIds = new Set(nodes.map(n => n.id));
    edges = edges.filter(e => nodeIds.has(e.source) || nodeIds.has(e.target));
  }

  if (opts.filterConnectionTypes && opts.filterConnectionTypes.length > 0) {
    edges = edges.filter(e => opts.filterConnectionTypes!.includes(e.type));
  }

  // Limit nodes if needed
  if (opts.maxNodes && nodes.length > opts.maxNodes) {
    nodes = nodes.slice(0, opts.maxNodes);
    const nodeIds = new Set(nodes.map(n => n.id));
    edges = edges.filter(e => nodeIds.has(e.source) && nodeIds.has(e.target));
  }

  // Group nodes by layer
  const nodesByLayer = new Map<ArchitectureLayer, GraphNode[]>();
  for (const node of nodes) {
    if (!nodesByLayer.has(node.layer)) {
      nodesByLayer.set(node.layer, []);
    }
    nodesByLayer.get(node.layer)!.push(node);
  }

  // Sort layers by order
  const sortedLayers = Array.from(nodesByLayer.keys()).sort(
    (a, b) => LAYER_STYLES[a].order - LAYER_STYLES[b].order
  );

  // Generate nodes with subgraphs
  if (opts.includeSubgraphs) {
    for (const layer of sortedLayers) {
      const layerNodes = nodesByLayer.get(layer)!;
      const style = LAYER_STYLES[layer];

      lines.push(`  subgraph ${style.subgraphName}`);

      for (const node of layerNodes) {
        const safeId = sanitizeId(node.id);
        const safeName = sanitizeName(node.name);
        lines.push(`    ${safeId}["${safeName}"]`);
      }

      lines.push('  end');
      lines.push('');
    }
  } else {
    // Just list nodes without subgraphs
    for (const node of nodes) {
      const safeId = sanitizeId(node.id);
      const safeName = sanitizeName(node.name);
      lines.push(`  ${safeId}["${safeName}"]`);
    }
    lines.push('');
  }

  // Generate edges
  for (const edge of edges) {
    const style = CONNECTION_STYLES[edge.type] || CONNECTION_STYLES.other;
    const sourceId = sanitizeId(edge.source);
    const targetId = sanitizeId(edge.target);

    // Check if both nodes exist
    const sourceExists = nodes.some(n => n.id === edge.source);
    const targetExists = nodes.some(n => n.id === edge.target);

    if (!sourceExists || !targetExists) continue;

    if (opts.showLabels && style.label) {
      lines.push(`  ${sourceId} ${style.lineStyle}|${style.label}| ${targetId}`);
    } else {
      lines.push(`  ${sourceId} ${style.lineStyle} ${targetId}`);
    }
  }

  // Add styling
  if (opts.includeStyles) {
    lines.push('');
    lines.push('  %% Styling');

    for (const layer of sortedLayers) {
      const layerNodes = nodesByLayer.get(layer)!;
      const style = LAYER_STYLES[layer];

      if (layerNodes.length > 0) {
        const nodeIds = layerNodes.map(n => sanitizeId(n.id)).join(',');
        lines.push(`  style ${nodeIds} ${style.nodeStyle}`);
      }
    }
  }

  return lines.join('\n');
}

/**
 * Generate a flowchart focused on a specific component
 */
export function generateComponentDiagram(
  graph: ConnectionGraph,
  componentId: string,
  depth: number = 1,
  options: DiagramOptions = {}
): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const lines: string[] = [];

  // Find the central node
  const centralNode = graph.nodes.find(n => n.id === componentId);
  if (!centralNode) {
    return `graph ${opts.direction}\n  error["Component not found"]`;
  }

  // Find connected nodes
  const connectedNodeIds = new Set<string>([componentId]);
  const relevantEdges: GraphEdge[] = [];

  // First pass: direct connections
  for (const edge of graph.edges) {
    if (edge.source === componentId || edge.target === componentId) {
      connectedNodeIds.add(edge.source);
      connectedNodeIds.add(edge.target);
      relevantEdges.push(edge);
    }
  }

  // Additional passes for deeper depth
  for (let d = 1; d < depth; d++) {
    const currentIds = new Set(connectedNodeIds);
    for (const edge of graph.edges) {
      if (currentIds.has(edge.source) || currentIds.has(edge.target)) {
        connectedNodeIds.add(edge.source);
        connectedNodeIds.add(edge.target);
        if (!relevantEdges.includes(edge)) {
          relevantEdges.push(edge);
        }
      }
    }
  }

  // Filter nodes
  const nodes = graph.nodes.filter(n => connectedNodeIds.has(n.id));

  // Generate diagram
  lines.push(`graph ${opts.direction}`);
  lines.push('');

  // Highlight central node
  const centralId = sanitizeId(centralNode.id);
  const centralName = sanitizeName(centralNode.name);
  lines.push(`  ${centralId}(["${centralName}"]):::highlight`);

  // Add other nodes
  for (const node of nodes) {
    if (node.id === componentId) continue;
    const safeId = sanitizeId(node.id);
    const safeName = sanitizeName(node.name);
    lines.push(`  ${safeId}["${safeName}"]`);
  }

  lines.push('');

  // Add edges
  for (const edge of relevantEdges) {
    const style = CONNECTION_STYLES[edge.type] || CONNECTION_STYLES.other;
    const sourceId = sanitizeId(edge.source);
    const targetId = sanitizeId(edge.target);

    if (opts.showLabels && style.label) {
      lines.push(`  ${sourceId} ${style.lineStyle}|${style.label}| ${targetId}`);
    } else {
      lines.push(`  ${sourceId} ${style.lineStyle} ${targetId}`);
    }
  }

  // Add highlight style
  lines.push('');
  lines.push('  classDef highlight fill:#fff176,stroke:#fbc02d,stroke-width:3px');

  return lines.join('\n');
}

/**
 * Generate a layer-focused diagram
 */
export function generateLayerDiagram(
  graph: ConnectionGraph,
  layer: ArchitectureLayer,
  options: DiagramOptions = {}
): string {
  const opts: DiagramOptions = { ...DEFAULT_OPTIONS, direction: 'LR' as const, ...options };

  // Filter to show this layer and its connections
  const layerNodes = graph.nodes.filter(n => n.layer === layer);
  const layerNodeIds = new Set(layerNodes.map(n => n.id));

  // Get edges that touch this layer
  const relevantEdges = graph.edges.filter(
    e => layerNodeIds.has(e.source) || layerNodeIds.has(e.target)
  );

  // Include connected nodes from other layers
  const connectedIds = new Set<string>();
  for (const edge of relevantEdges) {
    connectedIds.add(edge.source);
    connectedIds.add(edge.target);
  }

  const allNodes = graph.nodes.filter(n => connectedIds.has(n.id));

  // Create a filtered graph
  const filteredGraph: ConnectionGraph = {
    nodes: allNodes,
    edges: relevantEdges,
    metadata: graph.metadata,
  };

  return generateMermaidDiagram(filteredGraph, opts);
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Sanitize node ID for Mermaid (no special characters)
 */
function sanitizeId(id: string): string {
  return id
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

/**
 * Sanitize name for display in Mermaid
 */
function sanitizeName(name: string): string {
  return name
    .replace(/"/g, "'")
    .replace(/[<>]/g, '')
    .slice(0, 40);
}

/**
 * Generate a summary diagram with just the major components
 */
export function generateSummaryDiagram(
  graph: ConnectionGraph,
  options: DiagramOptions = {}
): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // Take top components by connection count
  const nodeConnectionCount = new Map<string, number>();

  for (const edge of graph.edges) {
    nodeConnectionCount.set(edge.source, (nodeConnectionCount.get(edge.source) || 0) + 1);
    nodeConnectionCount.set(edge.target, (nodeConnectionCount.get(edge.target) || 0) + 1);
  }

  // Sort by connection count and take top N
  const topNodeIds = Array.from(nodeConnectionCount.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, opts.maxNodes || 20)
    .map(([id]) => id);

  const topNodeIdSet = new Set(topNodeIds);

  // Filter graph
  const filteredGraph: ConnectionGraph = {
    nodes: graph.nodes.filter(n => topNodeIdSet.has(n.id)),
    edges: graph.edges.filter(e => topNodeIdSet.has(e.source) && topNodeIdSet.has(e.target)),
    metadata: graph.metadata,
  };

  return generateMermaidDiagram(filteredGraph, opts);
}

/**
 * Wrap diagram in markdown code block
 */
export function wrapInMarkdown(diagram: string, title?: string): string {
  const lines: string[] = [];

  if (title) {
    lines.push(`## ${title}`);
    lines.push('');
  }

  lines.push('```mermaid');
  lines.push(diagram);
  lines.push('```');

  return lines.join('\n');
}
