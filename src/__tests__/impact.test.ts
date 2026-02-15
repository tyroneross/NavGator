/**
 * Tests for impact analysis module
 */

import { describe, it, expect } from 'vitest';
import { computeSeverity, computeImpact } from '../impact.js';
import { createMockComponent, createMockConnection } from './helpers.js';
import type { ArchitectureComponent, ArchitectureConnection } from '../types.js';

describe('computeSeverity', () => {
  it('returns critical for database layer component', () => {
    const component = createMockComponent({
      name: 'PostgreSQL',
      type: 'database',
      role: { layer: 'database', purpose: 'Main database', critical: false },
    });

    const severity = computeSeverity(component, 0);
    expect(severity).toBe('critical');
  });

  it('returns critical for infra layer component', () => {
    const component = createMockComponent({
      name: 'Railway',
      type: 'infra',
      role: { layer: 'infra', purpose: 'Deployment platform', critical: false },
    });

    const severity = computeSeverity(component, 0);
    expect(severity).toBe('critical');
  });

  it('returns critical for component with role.critical=true', () => {
    const component = createMockComponent({
      name: 'AuthService',
      type: 'service',
      role: { layer: 'backend', purpose: 'Authentication', critical: true },
    });

    const severity = computeSeverity(component, 0);
    expect(severity).toBe('critical');
  });

  it('returns critical for component with >5 dependents', () => {
    const component = createMockComponent({
      name: 'UtilityLibrary',
      type: 'npm',
      role: { layer: 'backend', purpose: 'Shared utilities', critical: false },
    });

    const severity = computeSeverity(component, 6);
    expect(severity).toBe('critical');
  });

  it('returns high for backend layer component', () => {
    const component = createMockComponent({
      name: 'APIService',
      type: 'service',
      role: { layer: 'backend', purpose: 'API layer', critical: false },
    });

    const severity = computeSeverity(component, 2);
    expect(severity).toBe('high');
  });

  it('returns high for component with 3-5 dependents', () => {
    const component = createMockComponent({
      name: 'DataProcessor',
      type: 'npm',
      role: { layer: 'frontend', purpose: 'Data processing', critical: false },
    });

    const severity = computeSeverity(component, 4);
    expect(severity).toBe('high');
  });

  it('returns medium for component with 2 dependents', () => {
    const component = createMockComponent({
      name: 'Helper',
      type: 'npm',
      role: { layer: 'frontend', purpose: 'Helper module', critical: false },
    });

    const severity = computeSeverity(component, 2);
    expect(severity).toBe('medium');
  });

  it('returns low for component with 0 dependents', () => {
    const component = createMockComponent({
      name: 'UnusedModule',
      type: 'npm',
      role: { layer: 'frontend', purpose: 'Unused', critical: false },
    });

    const severity = computeSeverity(component, 0);
    expect(severity).toBe('low');
  });

  it('returns low for component with 1 dependent', () => {
    const component = createMockComponent({
      name: 'SpecializedModule',
      type: 'npm',
      role: { layer: 'frontend', purpose: 'Specialized use', critical: false },
    });

    const severity = computeSeverity(component, 1);
    expect(severity).toBe('low');
  });
});

describe('computeImpact', () => {
  it('returns correct severity based on direct dependents', () => {
    const targetComponent = createMockComponent({
      name: 'SharedLib',
      component_id: 'COMP_npm_sharedlib_abc',
      role: { layer: 'frontend', purpose: 'Shared library', critical: false },
    });

    const dependent1 = createMockComponent({
      name: 'Service1',
      component_id: 'COMP_service_service1_def',
    });

    const dependent2 = createMockComponent({
      name: 'Service2',
      component_id: 'COMP_service_service2_ghi',
    });

    const connections: ArchitectureConnection[] = [
      createMockConnection(dependent1.component_id, targetComponent.component_id),
      createMockConnection(dependent2.component_id, targetComponent.component_id),
    ];

    const impact = computeImpact(targetComponent, [targetComponent, dependent1, dependent2], connections);

    expect(impact.severity).toBe('medium'); // 2 dependents = medium
    expect(impact.component).toEqual(targetComponent);
  });

  it('finds direct dependents via connections', () => {
    const targetComponent = createMockComponent({
      name: 'Database',
      component_id: 'COMP_database_db_abc',
    });

    const dependent1 = createMockComponent({
      name: 'API',
      component_id: 'COMP_api_api_def',
    });

    const dependent2 = createMockComponent({
      name: 'Worker',
      component_id: 'COMP_worker_worker_ghi',
    });

    const connections: ArchitectureConnection[] = [
      createMockConnection(dependent1.component_id, targetComponent.component_id, {
        code_reference: { file: 'src/api.ts', symbol: 'queryDB', line_start: 10 },
      }),
      createMockConnection(dependent2.component_id, targetComponent.component_id, {
        code_reference: { file: 'src/worker.ts', symbol: 'processData', line_start: 20 },
      }),
    ];

    const impact = computeImpact(targetComponent, [targetComponent, dependent1, dependent2], connections);

    expect(impact.affected).toHaveLength(2);
    expect(impact.affected[0].impact_type).toBe('direct');
    expect(impact.affected[0].component.name).toBe('API');
    expect(impact.affected[1].impact_type).toBe('direct');
    expect(impact.affected[1].component.name).toBe('Worker');
    expect(impact.total_files_affected).toBe(2);
  });

  it('finds transitive dependents one level deep', () => {
    const targetComponent = createMockComponent({
      name: 'CoreLib',
      component_id: 'COMP_npm_corelib_abc',
    });

    const directDependent = createMockComponent({
      name: 'MiddleLib',
      component_id: 'COMP_npm_middlelib_def',
    });

    const transitiveDependent = createMockComponent({
      name: 'TopService',
      component_id: 'COMP_service_topservice_ghi',
    });

    const connections: ArchitectureConnection[] = [
      // Direct: MiddleLib uses CoreLib
      createMockConnection(directDependent.component_id, targetComponent.component_id, {
        code_reference: { file: 'src/middle.ts', symbol: 'useCore', line_start: 5 },
      }),
      // Transitive: TopService uses MiddleLib
      createMockConnection(transitiveDependent.component_id, directDependent.component_id, {
        code_reference: { file: 'src/top.ts', symbol: 'useMiddle', line_start: 15 },
      }),
    ];

    const allComponents = [targetComponent, directDependent, transitiveDependent];
    const impact = computeImpact(targetComponent, allComponents, connections);

    expect(impact.affected).toHaveLength(2);

    const directAffected = impact.affected.find(a => a.impact_type === 'direct');
    expect(directAffected?.component.name).toBe('MiddleLib');

    const transitiveAffected = impact.affected.find(a => a.impact_type === 'transitive');
    expect(transitiveAffected?.component.name).toBe('TopService');
    expect(transitiveAffected?.change_required).toContain('Indirectly affected via MiddleLib');
  });

  it('returns empty affected list when no connections', () => {
    const component = createMockComponent({
      name: 'IsolatedComponent',
      component_id: 'COMP_npm_isolated_abc',
      role: { layer: 'frontend', purpose: 'Isolated component', critical: false },
    });

    const impact = computeImpact(component, [component], []);

    expect(impact.affected).toHaveLength(0);
    expect(impact.total_files_affected).toBe(0);
    expect(impact.severity).toBe('low'); // 0 dependents
    expect(impact.summary).toContain('0 direct dependent');
  });

  it('includes summary with correct counts', () => {
    const targetComponent = createMockComponent({
      name: 'SharedLib',
      component_id: 'COMP_npm_sharedlib_abc',
    });

    const dependent1 = createMockComponent({
      name: 'Service1',
      component_id: 'COMP_service_service1_def',
    });

    const dependent2 = createMockComponent({
      name: 'Service2',
      component_id: 'COMP_service_service2_ghi',
    });

    const transitiveDep = createMockComponent({
      name: 'TopLevel',
      component_id: 'COMP_service_toplevel_jkl',
    });

    const connections: ArchitectureConnection[] = [
      createMockConnection(dependent1.component_id, targetComponent.component_id, {
        code_reference: { file: 'src/service1.ts', symbol: 'useLib', line_start: 10 },
      }),
      createMockConnection(dependent2.component_id, targetComponent.component_id, {
        code_reference: { file: 'src/service2.ts', symbol: 'useLib', line_start: 20 },
      }),
      createMockConnection(transitiveDep.component_id, dependent1.component_id, {
        code_reference: { file: 'src/toplevel.ts', symbol: 'useService', line_start: 30 },
      }),
    ];

    const allComponents = [targetComponent, dependent1, dependent2, transitiveDep];
    const impact = computeImpact(targetComponent, allComponents, connections);

    expect(impact.summary).toContain('2 direct dependents');
    expect(impact.summary).toContain('1 transitive');
    expect(impact.summary).toContain('3 files affected');
  });
});
