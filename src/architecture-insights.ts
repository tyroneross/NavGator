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

  function visit(node: string) {
    visiting.add(node);
    visited.add(node);
    stack.push(node);

    for (const next of graph.get(node) || []) {
      if (!visited.has(next)) {
        visit(next);
        if (cycles.length >= limit) return;
        continue;
      }
      if (!visiting.has(next)) continue;

      const startIndex = stack.indexOf(next);
      if (startIndex === -1) continue;
      const cycleIds = stack.slice(startIndex);
      const cycleNames = cycleIds.map((id) => names.get(id) || id);
      const canonical = [...cycleNames].sort().join('|');
      if (!seenCycles.has(canonical)) {
        seenCycles.add(canonical);
        cycles.push([...cycleNames, cycleNames[0]]);
        if (cycles.length >= limit) return;
      }
    }

    visiting.delete(node);
    stack.pop();
  }

  for (const node of graph.keys()) {
    if (!visited.has(node)) {
      visit(node);
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
