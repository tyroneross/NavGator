/**
 * Tests for dataflow trace module
 */

import { describe, it, expect } from 'vitest';
import { traceDataflow, formatTraceOutput } from '../trace.js';
import { createComponent, createConnection } from './helpers.js';
import { ArchitectureComponent, ArchitectureConnection } from '../types.js';

describe('traceDataflow', () => {
  it('should trace forward from frontend to database', () => {
    const frontend = createComponent('frontend', { layer: 'frontend' });
    const api = createComponent('api', { layer: 'backend' });
    const database = createComponent('database', { layer: 'database' });

    const conn1 = createConnection(frontend, api);
    const conn2 = createConnection(api, database);

    const components = [frontend, api, database];
    const connections = [conn1, conn2];

    const result = traceDataflow(frontend, components, connections, { direction: 'forward' });

    expect(result.query).toBe('frontend');
    expect(result.components_touched).toContain(frontend.component_id);
    expect(result.components_touched).toContain(api.component_id);
    expect(result.components_touched).toContain(database.component_id);
    expect(result.layers_crossed).toContain('frontend');
    expect(result.layers_crossed).toContain('backend');
    expect(result.layers_crossed).toContain('database');
    expect(result.paths.length).toBeGreaterThan(0);

    // Should have a path: frontend → api → database
    const fullPath = result.paths.find(p =>
      p.steps.length === 3 &&
      p.steps[0].component.id === frontend.component_id &&
      p.steps[1].component.id === api.component_id &&
      p.steps[2].component.id === database.component_id
    );
    expect(fullPath).toBeDefined();
  });

  it('should trace backward from database to frontend', () => {
    const frontend = createComponent('frontend', { layer: 'frontend' });
    const api = createComponent('api', { layer: 'backend' });
    const database = createComponent('database', { layer: 'database' });

    const conn1 = createConnection(frontend, api);
    const conn2 = createConnection(api, database);

    const components = [frontend, api, database];
    const connections = [conn1, conn2];

    const result = traceDataflow(database, components, connections, { direction: 'backward' });

    expect(result.query).toBe('database');
    expect(result.components_touched).toContain(frontend.component_id);
    expect(result.components_touched).toContain(api.component_id);
    expect(result.components_touched).toContain(database.component_id);

    // Should have a path: database → api → frontend
    const fullPath = result.paths.find(p =>
      p.steps.length === 3 &&
      p.steps[0].component.id === database.component_id &&
      p.steps[1].component.id === api.component_id &&
      p.steps[2].component.id === frontend.component_id
    );
    expect(fullPath).toBeDefined();
  });

  it('should respect maxDepth limiting', () => {
    const frontend = createComponent('frontend', { layer: 'frontend' });
    const api = createComponent('api', { layer: 'backend' });
    const auth = createComponent('auth', { layer: 'backend' });
    const database = createComponent('database', { layer: 'database' });

    const conn1 = createConnection(frontend, api);
    const conn2 = createConnection(frontend, auth);
    const conn3 = createConnection(api, database);
    const conn4 = createConnection(auth, database);

    const components = [frontend, api, auth, database];
    const connections = [conn1, conn2, conn3, conn4];

    // With depth=1, we should only reach api and auth from frontend
    const result = traceDataflow(frontend, components, connections, {
      direction: 'forward',
      maxDepth: 1
    });

    expect(result.components_touched).toContain(frontend.component_id);
    expect(result.components_touched).toContain(api.component_id);
    expect(result.components_touched).toContain(auth.component_id);
    expect(result.components_touched).not.toContain(database.component_id);

    // All paths should be length 2 (start + 1 hop)
    for (const path of result.paths) {
      expect(path.steps.length).toBeLessThanOrEqual(2);
    }
  });

  it('should handle cycles without infinite loop', () => {
    const a = createComponent('a', { layer: 'backend' });
    const b = createComponent('b', { layer: 'backend' });

    const conn1 = createConnection(a, b);
    const conn2 = createConnection(b, a);

    const components = [a, b];
    const connections = [conn1, conn2];

    const result = traceDataflow(a, components, connections, { maxDepth: 5 });

    // Should complete without hanging
    expect(result.components_touched).toContain(a.component_id);
    expect(result.components_touched).toContain(b.component_id);
    expect(result.paths.length).toBeGreaterThan(0);

    // Each path should visit each component at most once
    for (const path of result.paths) {
      const visitedIds = path.steps.map(s => s.component.id);
      const uniqueIds = new Set(visitedIds);
      expect(visitedIds.length).toBe(uniqueIds.size);
    }
  });

  it('should populate components_touched and layers_crossed correctly', () => {
    const frontend = createComponent('frontend', { layer: 'frontend' });
    const api = createComponent('api', { layer: 'backend' });
    const auth = createComponent('auth', { layer: 'backend' });
    const database = createComponent('database', { layer: 'database' });

    const conn1 = createConnection(frontend, api);
    const conn2 = createConnection(frontend, auth);
    const conn3 = createConnection(auth, database);

    const components = [frontend, api, auth, database];
    const connections = [conn1, conn2, conn3];

    const result = traceDataflow(frontend, components, connections);

    expect(result.components_touched.length).toBe(4);
    expect(result.components_touched).toContain(frontend.component_id);
    expect(result.components_touched).toContain(api.component_id);
    expect(result.components_touched).toContain(auth.component_id);
    expect(result.components_touched).toContain(database.component_id);

    expect(result.layers_crossed).toContain('frontend');
    expect(result.layers_crossed).toContain('backend');
    expect(result.layers_crossed).toContain('database');
  });

  it('should return empty paths when no connections exist', () => {
    const isolated = createComponent('isolated', { layer: 'backend' });
    const other = createComponent('other', { layer: 'backend' });

    const components = [isolated, other];
    const connections: ArchitectureConnection[] = [];

    const result = traceDataflow(isolated, components, connections);

    expect(result.query).toBe('isolated');
    expect(result.components_touched).toEqual([isolated.component_id]);
    expect(result.layers_crossed).toEqual(['backend']);
    expect(result.paths.length).toBe(0);
  });

  it('should include file references in trace steps', () => {
    const frontend = createComponent('frontend', { layer: 'frontend' });
    const api = createComponent('api', { layer: 'backend' });

    const conn = createConnection(frontend, api, {
      code_reference: {
        file: 'src/api/client.ts',
        symbol: 'fetchData',
        line_start: 42,
        line_end: 45,
        code_snippet: 'fetch("/api/data")',
      },
    });

    const components = [frontend, api];
    const connections = [conn];

    const result = traceDataflow(frontend, components, connections, { direction: 'forward' });

    const path = result.paths.find(p => p.steps.length === 2);
    expect(path).toBeDefined();
    expect(path!.steps[1].file).toBe('src/api/client.ts');
    expect(path!.steps[1].line).toBe(42);
  });

  it('should filter by classification when provided', () => {
    const frontend = createComponent('frontend', { layer: 'frontend' });
    const api = createComponent('api', { layer: 'backend' });
    const cache = createComponent('cache', { layer: 'backend' });

    const dataConn = createConnection(frontend, api, {
      semantic: { classification: 'production' as any, confidence: 0.8 },
    });
    const cacheConn = createConnection(frontend, cache, {
      semantic: { classification: 'test' as any, confidence: 0.8 },
    });

    const components = [frontend, api, cache];
    const connections = [dataConn, cacheConn];

    const result = traceDataflow(frontend, components, connections, {
      direction: 'forward',
      filterClassification: 'production',
    });

    expect(result.components_touched).toContain(api.component_id);
    expect(result.components_touched).not.toContain(cache.component_id);
  });
});

describe('formatTraceOutput', () => {
  it('should return readable string output', () => {
    const frontend = createComponent('frontend', { layer: 'frontend' });
    const api = createComponent('api', { layer: 'backend' });
    const database = createComponent('database', { layer: 'database' });

    const conn1 = createConnection(frontend, api);
    const conn2 = createConnection(api, database);

    const components = [frontend, api, database];
    const connections = [conn1, conn2];

    const result = traceDataflow(frontend, components, connections, { direction: 'forward' });
    const output = formatTraceOutput(result);

    expect(output).toContain('NavGator - Dataflow Trace: frontend');
    expect(output).toContain('Components touched:');
    expect(output).toContain('Layers crossed:');
    expect(output).toContain('Paths found:');
    expect(output).toContain('Path 1');
    expect(output).toContain('frontend');
    expect(output).toContain('api');
    expect(output).toContain('database');
    expect(output).toContain('[frontend]');
    expect(output).toContain('[backend]');
    expect(output).toContain('[database]');
  });

  it('should include classification tags in output', () => {
    const frontend = createComponent('frontend', { layer: 'frontend' });
    const api = createComponent('api', { layer: 'backend' });

    const conn = createConnection(frontend, api, {
      semantic: { classification: 'production', confidence: 0.8 },
    });

    const components = [frontend, api];
    const connections = [conn];

    const result = traceDataflow(frontend, components, connections, { direction: 'forward' });
    const output = formatTraceOutput(result);

    expect(output).toContain('[production]');
  });

  it('should include file references in output', () => {
    const frontend = createComponent('frontend', { layer: 'frontend' });
    const api = createComponent('api', { layer: 'backend' });

    const conn = createConnection(frontend, api, {
      code_reference: {
        file: 'src/api/client.ts',
        symbol: 'fetchData',
        line_start: 42,
        line_end: 45,
        code_snippet: 'fetch("/api/data")',
      },
    });

    const components = [frontend, api];
    const connections = [conn];

    const result = traceDataflow(frontend, components, connections, { direction: 'forward' });
    const output = formatTraceOutput(result);

    expect(output).toContain('src/api/client.ts:42');
  });
});
