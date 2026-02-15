/**
 * Tests for semantic connection classification
 */

import { describe, it, expect } from 'vitest';
import { classifyConnection, classifyAllConnections } from '../classify.js';
import { createComponent, createConnection } from './helpers.js';

describe('classifyConnection', () => {
  it('should classify test file paths as test with 0.9 confidence', () => {
    const from = createComponent({ name: 'TestComponent', layer: 'frontend', file: 'src/__tests__/foo.test.ts' });
    const to = createComponent({ name: 'TargetComponent', layer: 'backend' });
    const conn = createConnection(from.component_id, to.component_id, {
      code_reference: { file: 'src/__tests__/foo.test.ts', symbol: 'test', line_start: 10 },
    });

    const result = classifyConnection(conn, from, to);

    expect(result.classification).toBe('test');
    expect(result.confidence).toBe(0.9);
  });

  it('should classify .spec.ts files as test', () => {
    const from = createComponent({ name: 'SpecComponent', layer: 'frontend', file: 'src/foo.spec.ts' });
    const to = createComponent({ name: 'TargetComponent', layer: 'backend' });
    const conn = createConnection(from.component_id, to.component_id, {
      code_reference: { file: 'src/foo.spec.ts', symbol: 'test', line_start: 5 },
    });

    const result = classifyConnection(conn, from, to);

    expect(result.classification).toBe('test');
    expect(result.confidence).toBe(0.9);
  });

  it('should classify migration paths as migration', () => {
    const from = createComponent({ name: 'MigrationComponent', layer: 'database', file: 'src/migrations/001_initial.ts' });
    const to = createComponent({ name: 'Database', layer: 'database' });
    const conn = createConnection(from.component_id, to.component_id, {
      code_reference: { file: 'src/migrations/001_initial.ts', symbol: 'migrate', line_start: 1 },
    });

    const result = classifyConnection(conn, from, to);

    expect(result.classification).toBe('migration');
    expect(result.confidence).toBe(0.9);
  });

  it('should classify dev scripts as dev-only', () => {
    const from = createComponent({ name: 'BuildScript', layer: 'infra', file: './scripts/build.ts' });
    const to = createComponent({ name: 'BuildTool', layer: 'infra' });
    const conn = createConnection(from.component_id, to.component_id, {
      code_reference: { file: './scripts/build.ts', symbol: 'build', line_start: 20 },
    });

    const result = classifyConnection(conn, from, to);

    expect(result.classification).toBe('dev-only');
    expect(result.confidence).toBe(0.9);
  });

  it('should classify admin paths as admin', () => {
    const from = createComponent({ name: 'AdminUsers', layer: 'backend', file: 'src/admin/users.ts' });
    const to = createComponent({ name: 'UserService', layer: 'backend' });
    const conn = createConnection(from.component_id, to.component_id, {
      code_reference: { file: 'src/admin/users.ts', symbol: 'getUsers', line_start: 15 },
    });

    const result = classifyConnection(conn, from, to);

    expect(result.classification).toBe('admin');
    expect(result.confidence).toBe(0.9);
  });

  it('should classify analytics paths as analytics', () => {
    const from = createComponent({ name: 'Tracker', layer: 'backend', file: 'src/analytics/tracker.ts' });
    const to = createComponent({ name: 'AnalyticsService', layer: 'external' });
    const conn = createConnection(from.component_id, to.component_id, {
      code_reference: { file: 'src/analytics/tracker.ts', symbol: 'track', line_start: 8 },
    });

    const result = classifyConnection(conn, from, to);

    expect(result.classification).toBe('analytics');
    expect(result.confidence).toBe(0.9);
  });

  it('should default to production for frontend/backend layers', () => {
    const from = createComponent({ name: 'FrontendComponent', layer: 'frontend', file: 'src/components/App.tsx' });
    const to = createComponent({ name: 'BackendAPI', layer: 'backend', file: 'src/api/routes.ts' });
    const conn = createConnection(from.component_id, to.component_id, {
      code_reference: { file: 'src/components/App.tsx', symbol: 'fetchData', line_start: 42 },
    });

    const result = classifyConnection(conn, from, to);

    expect(result.classification).toBe('production');
    expect(result.confidence).toBe(0.5);
  });

  it('should default to unknown for external/infrastructure layers', () => {
    const from = createComponent({ name: 'ExternalService', layer: 'external', file: 'src/external/service.ts' });
    const to = createComponent({ name: 'InfraComponent', layer: 'infra', file: 'src/infra/config.ts' });
    const conn = createConnection(from.component_id, to.component_id, {
      code_reference: { file: 'src/external/service.ts', symbol: 'callInfra', line_start: 10 },
    });

    const result = classifyConnection(conn, from, to);

    expect(result.classification).toBe('unknown');
    expect(result.confidence).toBe(0.5);
  });

  it('should use component name heuristic for test', () => {
    const from = createComponent({ name: 'TestRunner', layer: 'infra', file: 'src/runner.ts' });
    const to = createComponent({ name: 'TestHelper', layer: 'infra', file: 'src/helper.ts' });
    const conn = createConnection(from.component_id, to.component_id, {
      code_reference: { file: 'src/runner.ts', symbol: 'run', line_start: 5 },
    });

    const result = classifyConnection(conn, from, to);

    expect(result.classification).toBe('test');
    expect(result.confidence).toBe(0.7);
  });

  it('should use component name heuristic for admin', () => {
    const from = createComponent({ name: 'AdminDashboard', layer: 'frontend', file: 'src/dashboard.tsx' });
    const to = createComponent({ name: 'UserService', layer: 'backend', file: 'src/users.ts' });
    const conn = createConnection(from.component_id, to.component_id, {
      code_reference: { file: 'src/dashboard.tsx', symbol: 'loadUsers', line_start: 25 },
    });

    const result = classifyConnection(conn, from, to);

    expect(result.classification).toBe('admin');
    expect(result.confidence).toBe(0.7);
  });

  it('should use component name heuristic for analytics', () => {
    const from = createComponent({ name: 'MetricsCollector', layer: 'backend', file: 'src/collector.ts' });
    const to = createComponent({ name: 'StorageService', layer: 'database', file: 'src/db.ts' });
    const conn = createConnection(from.component_id, to.component_id, {
      code_reference: { file: 'src/collector.ts', symbol: 'collect', line_start: 30 },
    });

    const result = classifyConnection(conn, from, to);

    expect(result.classification).toBe('analytics');
    expect(result.confidence).toBe(0.7);
  });

  it('should default to production when name has no classification keywords', () => {
    const from = createComponent({ name: 'DataProcessor', layer: 'backend', file: 'src/data.ts' });
    const to = createComponent({ name: 'StorageLayer', layer: 'database', file: 'src/db.ts' });
    const conn = createConnection(from.component_id, to.component_id, {
      code_reference: { file: 'src/data.ts', symbol: 'process', line_start: 10 },
    });

    const result = classifyConnection(conn, from, to);

    // Should be production because both are backend/database layers and no name heuristic matches
    expect(result.classification).toBe('production');
    expect(result.confidence).toBe(0.5);
  });
});

describe('classifyAllConnections', () => {
  it('should classify multiple connections in batch', () => {
    const comp1 = createComponent({ name: 'SpecComponent', layer: 'frontend', file: 'src/__tests__/foo.test.ts' });
    const comp2 = createComponent({ name: 'BackofficeComponent', layer: 'backend', file: 'src/admin/users.ts' });
    const comp3 = createComponent({ name: 'ProductionComponent', layer: 'backend', file: 'src/api/routes.ts' });

    const conn1 = createConnection(comp1.component_id, comp3.component_id, {
      code_reference: { file: 'src/__tests__/foo.test.ts', symbol: 'test', line_start: 10 },
    });
    const conn2 = createConnection(comp2.component_id, comp3.component_id, {
      code_reference: { file: 'src/admin/users.ts', symbol: 'getUsers', line_start: 20 },
    });

    const result = classifyAllConnections([conn1, conn2], [comp1, comp2, comp3]);

    expect(result.size).toBe(2);
    expect(result.get(conn1.connection_id)?.classification).toBe('test');
    expect(result.get(conn2.connection_id)?.classification).toBe('admin');
  });

  it('should return unknown for connections with missing components', () => {
    const comp1 = createComponent({ name: 'Component1', layer: 'frontend' });
    const conn1 = createConnection('missing-id', comp1.component_id);

    const result = classifyAllConnections([conn1], [comp1]);

    expect(result.get(conn1.connection_id)?.classification).toBe('unknown');
    expect(result.get(conn1.connection_id)?.confidence).toBe(0.3);
  });
});
