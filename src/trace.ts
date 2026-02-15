/**
 * NavGator Dataflow Trace
 * Follows an entity end-to-end across architecture layers via BFS
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
}

/**
 * Trace dataflow from a starting component through the architecture graph.
 * Uses BFS to find all reachable paths up to maxDepth.
 */
export function traceDataflow(
  startComponent: ArchitectureComponent,
  allComponents: ArchitectureComponent[],
  allConnections: ArchitectureConnection[],
  options: TraceOptions = {}
): TraceResult {
  const maxDepth = options.maxDepth ?? 5;
  const direction = options.direction ?? 'both';

  const componentMap = new Map(allComponents.map(c => [c.component_id, c]));
  const paths: TracePath[] = [];
  const touchedIds = new Set<string>();
  const layerSet = new Set<ArchitectureLayer>();

  touchedIds.add(startComponent.component_id);
  layerSet.add(startComponent.role.layer);

  // Build adjacency for efficient lookup
  const outgoing = new Map<string, ArchitectureConnection[]>();
  const incoming = new Map<string, ArchitectureConnection[]>();

  for (const conn of allConnections) {
    if (!outgoing.has(conn.from.component_id)) outgoing.set(conn.from.component_id, []);
    outgoing.get(conn.from.component_id)!.push(conn);
    if (!incoming.has(conn.to.component_id)) incoming.set(conn.to.component_id, []);
    incoming.get(conn.to.component_id)!.push(conn);
  }

  // BFS structure: queue of [componentId, path-so-far, depth]
  type QueueItem = { componentId: string; path: TraceStep[]; depth: number; visited: Set<string> };

  const queue: QueueItem[] = [{
    componentId: startComponent.component_id,
    path: [{ component: toCompactComponent(startComponent) }],
    depth: 0,
    visited: new Set([startComponent.component_id]),
  }];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.depth >= maxDepth) {
      // Record this path if it has more than just the start
      if (current.path.length > 1) {
        paths.push({ steps: current.path });
      }
      continue;
    }

    // Get connections to follow
    const connections: Array<{ conn: ArchitectureConnection; nextId: string }> = [];

    if (direction === 'forward' || direction === 'both') {
      for (const conn of (outgoing.get(current.componentId) || [])) {
        if (!current.visited.has(conn.to.component_id)) {
          connections.push({ conn, nextId: conn.to.component_id });
        }
      }
    }

    if (direction === 'backward' || direction === 'both') {
      for (const conn of (incoming.get(current.componentId) || [])) {
        if (!current.visited.has(conn.from.component_id)) {
          connections.push({ conn, nextId: conn.from.component_id });
        }
      }
    }

    // Apply classification filter
    const filteredConnections = options.filterClassification
      ? connections.filter(({ conn }) => {
          const semantic = (conn as any).semantic;
          return semantic?.classification === options.filterClassification;
        })
      : connections;

    if (filteredConnections.length === 0 && current.path.length > 1) {
      // Dead end — record path
      paths.push({ steps: current.path });
      continue;
    }

    for (const { conn, nextId } of filteredConnections) {
      const nextComp = componentMap.get(nextId);
      if (!nextComp) continue;

      touchedIds.add(nextId);
      layerSet.add(nextComp.role.layer);

      const newStep: TraceStep = {
        component: toCompactComponent(nextComp),
        connection: toCompactConnection(conn),
        file: conn.code_reference?.file,
        line: conn.code_reference?.line_start,
      };

      const newVisited = new Set(current.visited);
      newVisited.add(nextId);

      queue.push({
        componentId: nextId,
        path: [...current.path, newStep],
        depth: current.depth + 1,
        visited: newVisited,
      });
    }

    // If no connections were followed and we haven't queued anything,
    // and this isn't just the starting node
    if (filteredConnections.length === 0 && current.path.length === 1) {
      // Only the start node, no paths
    }
  }

  // Deduplicate paths (same component sequence)
  const uniquePaths = deduplicatePaths(paths);

  // Assign classifications from dominant semantic in path
  for (const tracePath of uniquePaths) {
    const classifications = tracePath.steps
      .filter(s => s.connection)
      .map(s => {
        const semantic = (allConnections.find(c => c.connection_id === s.connection?.id) as any)?.semantic;
        return semantic?.classification;
      })
      .filter(Boolean);

    if (classifications.length > 0) {
      // Most common classification
      const counts = new Map<string, number>();
      for (const c of classifications) {
        counts.set(c, (counts.get(c) || 0) + 1);
      }
      tracePath.classification = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    }
  }

  return {
    query: startComponent.name,
    paths: uniquePaths,
    components_touched: [...touchedIds],
    layers_crossed: [...layerSet],
  };
}

/**
 * Format trace result for human-readable CLI output
 */
export function formatTraceOutput(result: TraceResult): string {
  const lines: string[] = [];
  lines.push(`NavGator - Dataflow Trace: ${result.query}`);
  lines.push('');
  lines.push(`Components touched: ${result.components_touched.length}`);
  lines.push(`Layers crossed: ${result.layers_crossed.join(' → ')}`);
  lines.push(`Paths found: ${result.paths.length}`);
  lines.push('');

  for (let i = 0; i < result.paths.length; i++) {
    const path = result.paths[i];
    const tag = path.classification ? ` [${path.classification}]` : '';
    lines.push(`Path ${i + 1}${tag}:`);

    for (let j = 0; j < path.steps.length; j++) {
      const step = path.steps[j];
      const prefix = j === 0 ? '  ' : '  → ';
      const layer = `[${step.component.l}]`;
      const fileRef = step.file ? ` (${step.file}${step.line ? ':' + step.line : ''})` : '';
      lines.push(`${prefix}${step.component.n} ${layer}${fileRef}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function deduplicatePaths(paths: TracePath[]): TracePath[] {
  const seen = new Set<string>();
  const unique: TracePath[] = [];

  for (const p of paths) {
    const key = p.steps.map(s => s.component.id).join('→');
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(p);
    }
  }

  return unique;
}
