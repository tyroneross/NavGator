import type { ArchitectureComponent, ArchitectureConnection } from './types.js';

export interface RankedComponent {
  component: ArchitectureComponent;
  count: number;
}

export interface LayerViolation {
  from: ArchitectureComponent;
  to: ArchitectureComponent;
  connection: ArchitectureConnection;
  fromTier: number;
  toTier: number;
}

const TIER_GROUPS: Array<{ tier: number; names: string[] }> = [
  { tier: 4, names: ['ui', 'web', 'frontend', 'pages', 'routes', 'app', 'api', 'mcp'] },
  { tier: 3, names: ['cdp', 'native', 'media', 'service', 'services', 'controllers', 'handlers'] },
  { tier: 2, names: ['domain', 'model', 'models', 'state', 'store', 'features'] },
  { tier: 1, names: ['core', 'shared', 'common', 'base', 'types', 'utils', 'lib'] },
];

function getComponentMap(components: ArchitectureComponent[]): Map<string, ArchitectureComponent> {
  return new Map(components.map((component) => [component.component_id, component]));
}

function isInternalCodeComponent(component: ArchitectureComponent): boolean {
  const file = component.source.config_files?.[0] || '';
  return component.type === 'component' && !!file && !file.endsWith('package.json');
}

function getImportConnections(
  components: ArchitectureComponent[],
  connections: ArchitectureConnection[]
): Array<{ from: ArchitectureComponent; to: ArchitectureComponent; connection: ArchitectureConnection }> {
  const componentMap = getComponentMap(components);
  return connections
    .filter((connection) => connection.connection_type === 'imports')
    .map((connection) => {
      const from = componentMap.get(connection.from.component_id);
      const to = componentMap.get(connection.to.component_id);
      if (!from || !to) return null;
      return { from, to, connection };
    })
    .filter((entry): entry is { from: ArchitectureComponent; to: ArchitectureComponent; connection: ArchitectureConnection } => entry !== null);
}

export function getTopHotspots(
  components: ArchitectureComponent[],
  connections: ArchitectureConnection[],
  limit: number = 5
): RankedComponent[] {
  const counts = new Map<string, number>();
  for (const { to } of getImportConnections(components, connections)) {
    if (!isInternalCodeComponent(to)) continue;
    counts.set(to.component_id, (counts.get(to.component_id) || 0) + 1);
  }

  return components
    .filter(isInternalCodeComponent)
    .map((component) => ({ component, count: counts.get(component.component_id) || 0 }))
    .filter((entry) => entry.count > 0)
    .sort((a, b) => b.count - a.count || a.component.name.localeCompare(b.component.name))
    .slice(0, limit);
}

export function getTopFanOut(
  components: ArchitectureComponent[],
  connections: ArchitectureConnection[],
  limit: number = 5
): RankedComponent[] {
  const counts = new Map<string, number>();
  for (const { from } of getImportConnections(components, connections)) {
    if (!isInternalCodeComponent(from)) continue;
    counts.set(from.component_id, (counts.get(from.component_id) || 0) + 1);
  }

  return components
    .filter(isInternalCodeComponent)
    .map((component) => ({ component, count: counts.get(component.component_id) || 0 }))
    .filter((entry) => entry.count > 0)
    .sort((a, b) => b.count - a.count || a.component.name.localeCompare(b.component.name))
    .slice(0, limit);
}

export function detectImportCycles(
  components: ArchitectureComponent[],
  connections: ArchitectureConnection[],
  limit: number = 5
): string[][] {
  const importEdges = getImportConnections(components, connections)
    .filter(({ from, to }) => isInternalCodeComponent(from) && isInternalCodeComponent(to));

  const graph = new Map<string, Set<string>>();
  const names = new Map<string, string>();

  for (const { from, to } of importEdges) {
    if (!graph.has(from.component_id)) graph.set(from.component_id, new Set());
    graph.get(from.component_id)!.add(to.component_id);
    names.set(from.component_id, from.name);
    names.set(to.component_id, to.name);
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];
  const seenCycles = new Set<string>();
  const cycles: string[][] = [];

  // Iterative DFS — converted from recursion to fix R6 stack-overflow on
  // graphs with deep import chains (10k+ frames blew V8's default stack on
  // atomize-ai). Each frame mirrors the recursive call: it remembers the
  // node being visited and an iterator over its neighbours so we can resume
  // exactly where the recursive version would have returned. The
  // visiting/visited/stack invariants are preserved 1:1 with the recursive
  // version, so cycle detection (back-edge → slice of `stack`) is identical.
  type Frame = { node: string; iter: Iterator<string> };

  const visitIterative = (start: string): void => {
    if (visited.has(start)) return;
    const frames: Frame[] = [
      { node: start, iter: (graph.get(start) || new Set<string>()).values() },
    ];
    visiting.add(start);
    visited.add(start);
    stack.push(start);

    while (frames.length > 0) {
      // We never index `frames[frames.length - 1]` redundantly inside the loop
      // body — `current` is rebound at the top of each iteration so that any
      // push (recurse) or pop (return) takes effect on the next pass.
      const current = frames[frames.length - 1];
      const step = current.iter.next();

      if (step.done) {
        // Equivalent to the post-loop cleanup in the recursive version:
        // `visiting.delete(node); stack.pop();` then return to caller.
        visiting.delete(current.node);
        stack.pop();
        frames.pop();
        continue;
      }

      const next = step.value;

      if (!visited.has(next)) {
        // Recurse: push a new frame and let the next loop iteration drive it.
        visiting.add(next);
        visited.add(next);
        stack.push(next);
        frames.push({
          node: next,
          iter: (graph.get(next) || new Set<string>()).values(),
        });
        continue;
      }

      if (!visiting.has(next)) continue; // already fully processed branch

      // Back-edge into the current DFS path — record the cycle.
      const startIndex = stack.indexOf(next);
      if (startIndex === -1) continue;
      const cycleIds = stack.slice(startIndex);
      const cycleNames = cycleIds.map((id) => names.get(id) || id);
      const canonical = [...cycleNames].sort().join('|');
      if (!seenCycles.has(canonical)) {
        seenCycles.add(canonical);
        cycles.push([...cycleNames, cycleNames[0]]);
        if (cycles.length >= limit) return; // early-exit: see safety note below
      }
    }
  };
  // Safety: the early-exit above leaves `visiting` and `stack` dirty (nodes
  // still marked as in-flight). This is harmless because:
  //   1. All in-flight nodes are also in `visited`, so the outer loop's
  //      `!visited.has(node)` guard prevents re-entry for those nodes.
  //   2. The outer loop also breaks immediately on `cycles.length >= limit`,
  //      so no further `visitIterative` call is made after the early return.
  // Result: dirty `visiting`/`stack` state is abandoned without being read.

  for (const node of graph.keys()) {
    if (!visited.has(node)) {
      visitIterative(node);
      if (cycles.length >= limit) break;
    }
  }

  return cycles;
}

function getTierKey(component: ArchitectureComponent): string | null {
  const file = component.source.config_files?.[0];
  if (!file) return null;
  const normalized = file.replace(/\\/g, '/').replace(/\.[^.]+$/, '');
  const segments = normalized.split('/').filter(Boolean);
  if (segments.length === 0) return null;
  if (segments[0] === 'src' || segments[0] === 'app' || segments[0] === 'lib') {
    return segments[1] || segments[0];
  }
  return segments[0];
}

function inferTier(component: ArchitectureComponent): number | null {
  const key = getTierKey(component);
  if (!key) return null;
  const normalized = key.toLowerCase();
  for (const group of TIER_GROUPS) {
    if (group.names.includes(normalized)) return group.tier;
  }
  return null;
}

export function detectLayerViolations(
  components: ArchitectureComponent[],
  connections: ArchitectureConnection[]
): LayerViolation[] {
  return getImportConnections(components, connections)
    .filter(({ from, to }) => isInternalCodeComponent(from) && isInternalCodeComponent(to))
    .map(({ from, to, connection }) => {
      const fromTier = inferTier(from);
      const toTier = inferTier(to);
      if (fromTier === null || toTier === null) return null;
      if (fromTier <= toTier) return null;
      return { from, to, connection, fromTier, toTier };
    })
    .filter((entry): entry is LayerViolation => entry !== null);
}
