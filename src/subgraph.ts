/**
 * NavGator Queryable Subgraph Export
 * Extracts focused graph slices for agent consumption
 */

import {
  ArchitectureComponent,
  ArchitectureConnection,
  ArchitectureLayer,
  CompactComponent,
  CompactConnection,
  toCompactComponent,
  toCompactConnection,
} from './types.js';
import { resolveComponent } from './resolve.js';

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
  stats: { nodes: number; edges: number };
}

/**
 * Extract a focused subgraph from the full architecture
 */
export function extractSubgraph(
  components: ArchitectureComponent[],
  connections: ArchitectureConnection[],
  options: SubgraphOptions = {}
): SubgraphResult {
  const depth = options.depth ?? 2;
  const maxNodes = options.maxNodes ?? 50;

  let filteredComponentIds = new Set<string>();

  // If focus is specified, BFS from focus components
  if (options.focus && options.focus.length > 0) {
    // Resolve focus names to component IDs
    const focusIds = new Set<string>();
    for (const query of options.focus) {
      const resolved = resolveComponent(query, components);
      if (resolved) focusIds.add(resolved.component_id);
    }

    if (focusIds.size === 0) {
      // No resolved focus — return empty
      return { components: [], connections: [], stats: { nodes: 0, edges: 0 } };
    }

    // BFS from focus components
    const visited = new Set<string>(focusIds);
    let frontier = [...focusIds];

    for (let d = 0; d < depth; d++) {
      const nextFrontier: string[] = [];
      for (const id of frontier) {
        for (const conn of connections) {
          if (conn.from.component_id === id && !visited.has(conn.to.component_id)) {
            visited.add(conn.to.component_id);
            nextFrontier.push(conn.to.component_id);
          }
          if (conn.to.component_id === id && !visited.has(conn.from.component_id)) {
            visited.add(conn.from.component_id);
            nextFrontier.push(conn.from.component_id);
          }
        }
      }
      frontier = nextFrontier;
    }

    filteredComponentIds = visited;
  } else {
    // No focus — start with all components
    filteredComponentIds = new Set(components.map(c => c.component_id));
  }

  // Apply layer filter
  if (options.layers && options.layers.length > 0) {
    const layerSet = new Set(options.layers);
    const componentMap = new Map(components.map(c => [c.component_id, c]));
    for (const id of [...filteredComponentIds]) {
      const comp = componentMap.get(id);
      if (comp && !layerSet.has(comp.role.layer)) {
        filteredComponentIds.delete(id);
      }
    }
  }

  // Filter connections
  let filteredConnections = connections.filter(
    c => filteredComponentIds.has(c.from.component_id) && filteredComponentIds.has(c.to.component_id)
  );

  // Apply classification filter
  if (options.classification) {
    filteredConnections = filteredConnections.filter(c => {
      const semantic = (c as any).semantic;
      return semantic?.classification === options.classification;
    });
  }

  // Apply maxNodes limit
  const filteredComponents = components.filter(c => filteredComponentIds.has(c.component_id));
  const limitedComponents = filteredComponents.slice(0, maxNodes);
  const limitedIds = new Set(limitedComponents.map(c => c.component_id));
  const limitedConnections = filteredConnections.filter(
    c => limitedIds.has(c.from.component_id) && limitedIds.has(c.to.component_id)
  );

  return {
    components: limitedComponents.map(toCompactComponent),
    connections: limitedConnections.map(toCompactConnection),
    stats: {
      nodes: limitedComponents.length,
      edges: limitedConnections.length,
    },
  };
}

/**
 * Convert subgraph result to Mermaid diagram format
 */
export function subgraphToMermaid(result: SubgraphResult): string {
  const lines: string[] = ['graph TD', ''];

  // Add nodes
  for (const comp of result.components) {
    const safeId = comp.id.replace(/[^a-zA-Z0-9_]/g, '_');
    const safeName = comp.n.replace(/"/g, "'").slice(0, 40);
    lines.push(`  ${safeId}["${safeName}"]`);
  }

  lines.push('');

  // Add edges
  for (const conn of result.connections) {
    const sourceId = conn.f.replace(/[^a-zA-Z0-9_]/g, '_');
    const targetId = conn.t.replace(/[^a-zA-Z0-9_]/g, '_');
    lines.push(`  ${sourceId} --> ${targetId}`);
  }

  return lines.join('\n');
}
