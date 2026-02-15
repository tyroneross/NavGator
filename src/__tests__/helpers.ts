/**
 * Shared test fixtures for NavGator tests
 */

import {
  ArchitectureComponent,
  ArchitectureConnection,
  ConnectionGraph,
  ArchitectureLayer,
  ComponentType,
  ConnectionType,
  ComponentStatus,
} from '../types.js';

/**
 * Create a mock ArchitectureComponent with sensible defaults
 */
export function createMockComponent(overrides: Partial<ArchitectureComponent> & { name?: string } = {}): ArchitectureComponent {
  const name = overrides.name || 'test-component';
  const type = overrides.type || 'npm';
  const id = overrides.component_id || `COMP_${type}_${name.replace(/[^a-z0-9]/gi, '_')}_test`;

  return {
    component_id: id,
    name,
    version: '1.0.0',
    type,
    connects_to: [],
    connected_from: [],
    status: 'active' as ComponentStatus,
    tags: [],
    timestamp: Date.now(),
    last_updated: Date.now(),
    ...overrides,
    // Ensure nested objects are properly merged (after spread so they win)
    role: {
      purpose: `Test component: ${name}`,
      layer: 'backend' as ArchitectureLayer,
      critical: false,
      ...(overrides.role || {}),
    },
    source: {
      detection_method: 'auto',
      config_files: ['package.json'],
      confidence: 0.9,
      ...(overrides.source || {}),
    },
  };
}

/**
 * Create a mock ArchitectureConnection
 */
export function createMockConnection(
  fromComponentId: string,
  toComponentId: string,
  overrides: Partial<ArchitectureConnection> = {}
): ArchitectureConnection {
  const connType = overrides.connection_type || 'service-call';
  const id = overrides.connection_id || `CONN_${connType}_${Math.random().toString(36).slice(2, 8)}`;

  return {
    connection_id: id,
    connection_type: connType,
    description: `Connection from ${fromComponentId} to ${toComponentId}`,
    detected_from: 'test',
    confidence: 0.9,
    timestamp: Date.now(),
    last_verified: Date.now(),
    ...overrides,
    // Ensure nested objects are properly merged
    from: {
      component_id: fromComponentId,
      location: { file: 'src/index.ts', line: 1 },
      ...(overrides.from || {}),
    },
    to: {
      component_id: toComponentId,
      ...(overrides.to || {}),
    },
    code_reference: {
      file: 'src/index.ts',
      symbol: 'testFunction',
      symbol_type: 'function',
      line_start: 10,
      ...(overrides.code_reference || {}),
    },
  };
}

/**
 * Shorthand: create a component with flexible args
 * - createComponent('name', { layer: 'frontend' })
 * - createComponent({ name: 'X', layer: 'frontend', type: 'service', status: 'active', file: 'src/x.ts' })
 */
export function createComponent(
  nameOrOpts: string | { name: string; layer?: ArchitectureLayer; type?: ComponentType; status?: ComponentStatus; file?: string },
  roleOverrides?: { layer?: ArchitectureLayer }
): ArchitectureComponent {
  if (typeof nameOrOpts === 'string') {
    const name = nameOrOpts;
    const overrides: Partial<ArchitectureComponent> & { name: string } = { name };
    if (roleOverrides?.layer) {
      overrides.role = { purpose: `Test: ${name}`, layer: roleOverrides.layer, critical: false };
    }
    return createMockComponent(overrides);
  }

  const { name, layer, type, status, file } = nameOrOpts;
  const overrides: Partial<ArchitectureComponent> & { name: string } = { name };
  if (type) overrides.type = type;
  if (status) overrides.status = status;
  if (layer) {
    overrides.role = { purpose: `Test: ${name}`, layer, critical: false };
  }
  if (file) {
    overrides.source = { detection_method: 'auto' as const, config_files: [file], confidence: 0.9 };
  }
  return createMockComponent(overrides);
}

/**
 * Shorthand: create a connection accepting component objects or IDs
 */
export function createConnection(
  from: ArchitectureComponent | string,
  to: ArchitectureComponent | string,
  overrides?: Partial<ArchitectureConnection>
): ArchitectureConnection {
  const fromId = typeof from === 'string' ? from : from.component_id;
  const toId = typeof to === 'string' ? to : to.component_id;
  return createMockConnection(fromId, toId, overrides);
}

/**
 * Create a mock ConnectionGraph from components and connections
 */
export function createMockGraph(
  components: ArchitectureComponent[],
  connections: ArchitectureConnection[]
): ConnectionGraph {
  return {
    schema_version: '1.0.0',
    nodes: components.map((c) => ({
      id: c.component_id,
      name: c.name,
      type: c.type,
      layer: c.role.layer,
    })),
    edges: connections.map((c) => ({
      id: c.connection_id,
      source: c.from.component_id,
      target: c.to.component_id,
      type: c.connection_type,
      label: c.description,
    })),
    metadata: {
      generated_at: Date.now(),
      component_count: components.length,
      connection_count: connections.length,
    },
  };
}
