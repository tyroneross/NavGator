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
  maxPaths?: number;           // Limit output to top N paths (default: 10)
  showAll?: boolean;           // Override maxPaths, show everything
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

  // Merge FILE: aliases into real component adjacency for backward trace
  // Without this, backward trace can't find connections that target FILE: IDs
  for (const comp of allComponents) {
    for (const f of comp.source.config_files || []) {
      const fileId = `FILE:${f}`;
      if (fileId === comp.component_id) continue;
      // Merge incoming: connections targeting FILE:path also target the real component
      const fileIn = incoming.get(fileId);
      if (fileIn) {
        if (!incoming.has(comp.component_id)) incoming.set(comp.component_id, []);
        incoming.get(comp.component_id)!.push(...fileIn);
      }
      // Merge outgoing: connections from FILE:path also originate from the real component
      const fileOut = outgoing.get(fileId);
      if (fileOut) {
        if (!outgoing.has(comp.component_id)) outgoing.set(comp.component_id, []);
        outgoing.get(comp.component_id)!.push(...fileOut);
      }
    }
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
    // (B) Exclude env-dependency from trace — they're config references, not data flow
    // (A) Prioritize code flow connections over structural ones
    const EXCLUDED_FROM_TRACE = new Set(['env-dependency']);
    const CODE_FLOW_TYPES = new Set([
      'imports', 'api-calls-db', 'queue-produces', 'queue-consumes',
      'cron-triggers', 'service-call', 'deploys-to', 'queue-uses-cache',
      'runtime-binding', 'field-reference',
    ]);

    const connections: Array<{ conn: ArchitectureConnection; nextId: string }> = [];

    // Check if current node is a queue (bridge node)
    const currentComp = componentMap.get(current.componentId);
    const isQueueBridge = currentComp?.type === 'queue';

    if (direction === 'forward' || direction === 'both') {
      for (const conn of (outgoing.get(current.componentId) || [])) {
        if (!current.visited.has(conn.to.component_id) && !EXCLUDED_FROM_TRACE.has(conn.connection_type)) {
          connections.push({ conn, nextId: conn.to.component_id });
        }
      }
    }

    if (direction === 'backward' || direction === 'both') {
      for (const conn of (incoming.get(current.componentId) || [])) {
        if (!current.visited.has(conn.from.component_id) && !EXCLUDED_FROM_TRACE.has(conn.connection_type)) {
          connections.push({ conn, nextId: conn.from.component_id });
        }
      }
    }

    // (A) Sort connections: code flow first, structural second
    connections.sort((a, b) => {
      const aIsCodeFlow = CODE_FLOW_TYPES.has(a.conn.connection_type) ? 0 : 1;
      const bIsCodeFlow = CODE_FLOW_TYPES.has(b.conn.connection_type) ? 0 : 1;
      return aIsCodeFlow - bIsCodeFlow;
    });

    // Queue bridge semantics: if we're on a queue node, also follow the
    // opposite direction through queue-specific connections.
    // Entered via queue-produces → exit via queue-consumes (forward data flow)
    // Entered via queue-consumes → exit via queue-produces (backward trace)
    if (isQueueBridge && current.path.length > 1) {
      const lastConn = current.path[current.path.length - 1].connection;
      const enteredVia = lastConn?.ct;

      if (enteredVia === 'queue-produces') {
        // Data entered queue — follow consumers (outgoing queue-consumes connections)
        for (const conn of (outgoing.get(current.componentId) || [])) {
          if (conn.connection_type === 'queue-consumes' && !current.visited.has(conn.to.component_id)) {
            if (!connections.find(c => c.nextId === conn.to.component_id)) {
              connections.push({ conn, nextId: conn.to.component_id });
            }
          }
        }
      } else if (enteredVia === 'queue-consumes') {
        // Tracing backward through consumer — follow producers
        for (const conn of (incoming.get(current.componentId) || [])) {
          if (conn.connection_type === 'queue-produces' && !current.visited.has(conn.from.component_id)) {
            if (!connections.find(c => c.nextId === conn.from.component_id)) {
              connections.push({ conn, nextId: conn.from.component_id });
            }
          }
        }
      }
    }

    // Apply classification filter
    const filteredConnections = options.filterClassification
      ? connections.filter(({ conn }) => {
          const cls = conn.semantic?.classification;
          if (options.filterClassification === 'production') {
            // Production = not explicitly test/dev/migration
            return !cls || cls === 'production' || cls === 'unknown' || cls === 'admin' || cls === 'analytics';
          }
          return cls === options.filterClassification;
        })
      : connections;

    if (filteredConnections.length === 0 && current.path.length > 1) {
      // Dead end — record path
      paths.push({ steps: current.path });
      continue;
    }

    for (const { conn, nextId } of filteredConnections) {
      let nextComp = componentMap.get(nextId);

      // Handle FILE: references — create a synthetic component so trace can continue
      if (!nextComp && nextId.startsWith('FILE:')) {
        const filePath = nextId.slice(5);
        nextComp = {
          component_id: nextId,
          name: filePath.split('/').pop()?.replace(/\.[^.]+$/, '') || filePath,
          type: 'component',
          role: { purpose: `Source file: ${filePath}`, layer: 'backend', critical: false },
          source: { detection_method: 'auto', config_files: [filePath], confidence: 0.5 },
          connects_to: [], connected_from: [],
          status: 'active', tags: ['file-ref'],
          timestamp: 0, last_updated: 0,
        };
      }

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
        const semantic = allConnections.find(c => c.connection_id === s.connection?.id)?.semantic;
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

  // Score and sort paths by relevance
  const scoredPaths = uniquePaths.map(p => ({
    path: p,
    score: scorePath(p),
  }));
  scoredPaths.sort((a, b) => b.score - a.score);

  // Apply maxPaths limit (default 10)
  const maxPaths = options.showAll ? Infinity : (options.maxPaths ?? 10);
  const limitedPaths = scoredPaths.slice(0, maxPaths).map(s => s.path);

  return {
    query: startComponent.name,
    paths: limitedPaths,
    components_touched: [...touchedIds],
    layers_crossed: [...layerSet],
  };
}

/**
 * Score a trace path by architectural relevance.
 * Higher scores = more interesting paths (cross-layer, use queue/deploy connections).
 */
function scorePath(path: TracePath): number {
  let score = 0;
  const layers = new Set<string>();

  // Connection type weights
  const typeWeights: Record<string, number> = {
    'queue-produces': 3, 'queue-consumes': 3, 'queue-uses-cache': 3,
    'deploys-to': 3, 'runtime-binding': 3,
    'cron-triggers': 2, 'api-calls-db': 2, 'schema-relation': 2,
    'service-call': 1, 'field-reference': 1,
    'imports': 0, 'env-dependency': 0,
  };

  for (const step of path.steps) {
    // Layer crossing bonus
    if (step.component.l) {
      if (layers.size > 0 && !layers.has(step.component.l)) {
        score += 2; // Each new layer crossed adds 2
      }
      layers.add(step.component.l);
    }

    // Connection type weight
    if (step.connection?.ct) {
      score += typeWeights[step.connection.ct] ?? 0;
    }
  }

  // Path length bonus — longer meaningful paths are more interesting (up to a point)
  score += Math.min(path.steps.length, 6);

  return score;
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
