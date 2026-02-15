/**
 * Tests for agent output formatting module
 */

import { describe, it, expect } from 'vitest';
import { wrapInEnvelope, buildExecutiveSummary } from '../agent-output.js';
import { createMockComponent, createMockConnection } from './helpers.js';
import type { ArchitectureComponent, ArchitectureConnection, GitInfo } from '../types.js';

describe('wrapInEnvelope', () => {
  it('returns valid JSON string', () => {
    const data = { test: 'value' };
    const result = wrapInEnvelope('test-command', data);

    expect(() => JSON.parse(result)).not.toThrow();
    const parsed = JSON.parse(result);
    expect(parsed.data).toEqual(data);
  });

  it('has sorted top-level keys', () => {
    const data = { foo: 'bar' };
    const result = wrapInEnvelope('scan', data);
    const parsed = JSON.parse(result);

    const keys = Object.keys(parsed);
    const sortedKeys = [...keys].sort();
    expect(keys).toEqual(sortedKeys);
    expect(keys).toEqual(['command', 'data', 'schema_version', 'timestamp']);
  });

  it('includes schema_version', () => {
    const result = wrapInEnvelope('test', {});
    const parsed = JSON.parse(result);

    expect(parsed.schema_version).toBeDefined();
    expect(typeof parsed.schema_version).toBe('string');
  });

  it('includes timestamp', () => {
    const result = wrapInEnvelope('test', {});
    const parsed = JSON.parse(result);

    expect(parsed.timestamp).toBeDefined();
    expect(typeof parsed.timestamp).toBe('number');
    expect(parsed.timestamp).toBeGreaterThan(0);
  });

  it('includes command', () => {
    const result = wrapInEnvelope('scan', { test: 'data' });
    const parsed = JSON.parse(result);

    expect(parsed.command).toBe('scan');
  });

  it('includes metadata when provided', () => {
    const metadata = { projectPath: '/test/path', git: { branch: 'main', commit: 'abc123' } };
    const result = wrapInEnvelope('scan', { data: 'test' }, metadata);
    const parsed = JSON.parse(result);

    expect(parsed.metadata).toEqual(metadata);
  });

  it('omits metadata when not provided', () => {
    const result = wrapInEnvelope('scan', { data: 'test' });
    const parsed = JSON.parse(result);

    expect(parsed.metadata).toBeUndefined();
  });

  it('omits metadata when empty object', () => {
    const result = wrapInEnvelope('scan', { data: 'test' }, {});
    const parsed = JSON.parse(result);

    expect(parsed.metadata).toBeUndefined();
  });
});

describe('buildExecutiveSummary', () => {
  it('returns risks for vulnerable components', () => {
    const vulnerableComponent = createMockComponent({
      name: 'VulnerableLib',
      status: 'vulnerable',
    });

    const summary = buildExecutiveSummary(
      [vulnerableComponent],
      [],
      '/test/project'
    );

    expect(summary.risks).toHaveLength(1);
    expect(summary.risks[0].type).toBe('vulnerability');
    expect(summary.risks[0].severity).toBe('critical');
    expect(summary.risks[0].component).toBe('VulnerableLib');
    expect(summary.risks[0].message).toContain('has known vulnerabilities');
  });

  it('returns risks for deprecated components', () => {
    const deprecatedComponent = createMockComponent({
      name: 'OldLib',
      status: 'deprecated',
    });

    const summary = buildExecutiveSummary(
      [deprecatedComponent],
      [],
      '/test/project'
    );

    expect(summary.risks).toHaveLength(1);
    expect(summary.risks[0].type).toBe('deprecated');
    expect(summary.risks[0].severity).toBe('high');
    expect(summary.risks[0].component).toBe('OldLib');
    expect(summary.risks[0].message).toContain('is deprecated');
  });

  it('returns risks for outdated components with update info', () => {
    const outdatedComponent = createMockComponent({
      name: 'OutdatedLib',
      status: 'outdated',
      health: {
        last_audit: Date.now(),
        update_available: '2.0.0',
        update_type: 'major',
      },
    });

    const summary = buildExecutiveSummary(
      [outdatedComponent],
      [],
      '/test/project'
    );

    expect(summary.risks).toHaveLength(1);
    expect(summary.risks[0].type).toBe('outdated');
    expect(summary.risks[0].severity).toBe('high'); // major update
    expect(summary.risks[0].component).toBe('OutdatedLib');
    expect(summary.risks[0].message).toContain('major update available');
    expect(summary.risks[0].message).toContain('2.0.0');
  });

  it('returns medium severity for minor/patch updates', () => {
    const outdatedComponent = createMockComponent({
      name: 'OutdatedLib',
      status: 'outdated',
      health: {
        last_audit: Date.now(),
        update_available: '1.1.0',
        update_type: 'minor',
      },
    });

    const summary = buildExecutiveSummary(
      [outdatedComponent],
      [],
      '/test/project'
    );

    expect(summary.risks[0].severity).toBe('medium');
  });

  it('returns blockers for unused components', () => {
    const unusedComponent = createMockComponent({
      name: 'UnusedLib',
      status: 'unused',
    });

    const summary = buildExecutiveSummary(
      [unusedComponent],
      [],
      '/test/project'
    );

    expect(summary.blockers).toHaveLength(1);
    expect(summary.blockers[0].type).toBe('unused');
    expect(summary.blockers[0].component).toBe('UnusedLib');
    expect(summary.blockers[0].message).toContain('is detected but unused');
  });

  it('computes correct stats', () => {
    const components: ArchitectureComponent[] = [
      createMockComponent({ name: 'ActiveLib', status: 'active' }),
      createMockComponent({ name: 'OutdatedLib', status: 'outdated' }),
      createMockComponent({ name: 'VulnerableLib', status: 'vulnerable' }),
      createMockComponent({ name: 'DeprecatedLib', status: 'deprecated' }),
    ];

    const connections: ArchitectureConnection[] = [
      createMockConnection('COMP_npm_activelib_abc', 'COMP_npm_outdatedlib_def'),
      createMockConnection('COMP_npm_vulnerablelib_ghi', 'COMP_npm_deprecatedlib_jkl'),
    ];

    const summary = buildExecutiveSummary(
      components,
      connections,
      '/test/project'
    );

    expect(summary.stats.total_components).toBe(4);
    expect(summary.stats.total_connections).toBe(2);
    expect(summary.stats.outdated_count).toBe(1);
    expect(summary.stats.vulnerable_count).toBe(1);
  });

  it('includes project path and timestamp', () => {
    const summary = buildExecutiveSummary([], [], '/test/project');

    expect(summary.project_path).toBe('/test/project');
    expect(summary.timestamp).toBeGreaterThan(0);
  });

  it('includes git info when provided', () => {
    const git: GitInfo = {
      branch: 'main',
      commit: 'abc123',
      commitFull: 'abc123def456',
    };

    const summary = buildExecutiveSummary([], [], '/test/project', git);

    expect(summary.git).toEqual(git);
  });

  it('includes compact components and connections', () => {
    const component = createMockComponent({
      name: 'TestLib',
      component_id: 'COMP_npm_testlib_abc',
      type: 'npm',
      version: '1.0.0',
      role: { layer: 'backend', purpose: 'Test', critical: false },
      status: 'active',
    });

    const connection = createMockConnection(
      'COMP_npm_from_abc',
      'COMP_npm_to_def',
      {
        connection_type: 'imports',
        code_reference: {
          file: 'src/test.ts',
          symbol: 'testFunction',
          symbol_type: 'function',
          line_start: 10,
        },
      }
    );

    const summary = buildExecutiveSummary([component], [connection], '/test/project');

    expect(summary.components).toHaveLength(1);
    expect(summary.components[0].id).toBe('COMP_npm_testlib_abc');
    expect(summary.components[0].n).toBe('TestLib');
    expect(summary.components[0].t).toBe('npm');
    expect(summary.components[0].v).toBe('1.0.0');
    expect(summary.components[0].l).toBe('backend');
    expect(summary.components[0].s).toBe('active');

    expect(summary.connections).toHaveLength(1);
    expect(summary.connections[0].f).toBe('COMP_npm_from_abc');
    expect(summary.connections[0].t).toBe('COMP_npm_to_def');
    expect(summary.connections[0].ct).toBe('imports');
    expect(summary.connections[0].sym).toBe('testFunction');
  });

  it('includes next actions for vulnerabilities', () => {
    const vulnerableComponent = createMockComponent({
      name: 'VulnerableLib',
      status: 'vulnerable',
    });

    const summary = buildExecutiveSummary([vulnerableComponent], [], '/test/project');

    expect(summary.next_actions.length).toBeGreaterThan(0);
    const auditAction = summary.next_actions.find(a => a.command === 'npm audit fix');
    expect(auditAction).toBeDefined();
    expect(auditAction?.action).toContain('Fix');
    expect(auditAction?.action).toContain('vulnerable');
  });

  it('includes next actions for outdated packages', () => {
    const outdatedComponent = createMockComponent({
      name: 'OutdatedLib',
      status: 'outdated',
    });

    const summary = buildExecutiveSummary([outdatedComponent], [], '/test/project');

    const updateAction = summary.next_actions.find(a => a.command === 'npm outdated');
    expect(updateAction).toBeDefined();
    expect(updateAction?.action).toContain('Update');
    expect(updateAction?.action).toContain('outdated');
  });

  it('includes next actions for deprecated packages', () => {
    const deprecatedComponent = createMockComponent({
      name: 'DeprecatedLib',
      status: 'deprecated',
    });

    const summary = buildExecutiveSummary([deprecatedComponent], [], '/test/project');

    const replaceAction = summary.next_actions.find(a => a.action.includes('Replace'));
    expect(replaceAction).toBeDefined();
    expect(replaceAction?.action).toContain('deprecated');
  });

  it('includes next actions for unused components', () => {
    const unusedComponent = createMockComponent({
      name: 'UnusedLib',
      status: 'unused',
    });

    const summary = buildExecutiveSummary([unusedComponent], [], '/test/project');

    const reviewAction = summary.next_actions.find(a => a.action.includes('Review'));
    expect(reviewAction).toBeDefined();
    expect(reviewAction?.action).toContain('unused');
  });
});
