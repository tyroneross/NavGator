/**
 * Tests for agent output formatting module
 */

import { describe, it, expect } from 'vitest';
import {
  AGENT_OUTPUT_LIMITS,
  boundAgentCollection,
  wrapInEnvelope,
  buildExecutiveSummary,
} from '../agent-output.js';
import { buildCoverageAgentData } from '../cli/commands/coverage.js';
import { buildRulesAgentData } from '../cli/commands/rules.js';
import { createMockComponent, createMockConnection } from './helpers.js';
import type { ArchitectureComponent, ArchitectureConnection, GitInfo } from '../types.js';
import type { CoverageReport } from '../coverage.js';
import type { RuleViolation } from '../rules.js';

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

describe('boundAgentCollection', () => {
  it('returns an explicit deterministic collection window', () => {
    const bounded = boundAgentCollection([1, 2, 3, 4], 2);

    expect(bounded.items).toEqual([1, 2]);
    expect(bounded.truncation).toEqual({
      total: 4,
      returned: 2,
      truncated: true,
      limit: 2,
    });
  });

  it('bounds rules agent data while preserving total error counts', () => {
    const violations: RuleViolation[] = Array.from(
      { length: AGENT_OUTPUT_LIMITS.commandItems + 25 },
      (_, index) => ({
        rule_id: `rule-${String(index).padStart(3, '0')}`,
        severity: index < 12 ? 'error' : 'warning',
        component: `Component${index}`,
        message: `Violation ${index}`,
      })
    );

    const data = buildRulesAgentData(violations, 9);
    const envelope = JSON.parse(wrapInEnvelope('rules', data));

    expect(envelope.data.summary).toMatchObject({
      total: violations.length,
      returned: AGENT_OUTPUT_LIMITS.commandItems,
      truncated: true,
      errors: 12,
    });
    expect(envelope.data.violations).toHaveLength(AGENT_OUTPUT_LIMITS.commandItems);
    expect(envelope.data.violations[0].severity).toBe('error');
    expect(envelope.data.truncation.violations.total).toBe(violations.length);
  });

  it('bounds coverage gaps with total and returned accounting', () => {
    const report: CoverageReport = {
      overall_confidence: 0.5,
      component_coverage: {
        total_files_in_project: 100,
        files_mapped_to_components: 50,
        coverage_percent: 50,
      },
      connection_coverage: {
        total_connections: 0,
        by_confidence: { high: 0, medium: 0, low: 0 },
        by_classification: {},
      },
      gaps: Array.from({ length: AGENT_OUTPUT_LIMITS.commandItems + 10 }, (_, index) => ({
        type: 'unmapped-file' as const,
        target: `src/file-${index}.ts`,
        message: `src/file-${index}.ts is unmapped`,
      })),
    };

    const data = buildCoverageAgentData(report);
    const envelope = JSON.parse(wrapInEnvelope('coverage', data));

    expect(envelope.data.gap_summary).toEqual({
      total: report.gaps.length,
      returned: AGENT_OUTPUT_LIMITS.commandItems,
      truncated: true,
    });
    expect(envelope.data.gaps).toHaveLength(AGENT_OUTPUT_LIMITS.commandItems);
    expect(envelope.data.truncation.gaps.total).toBe(report.gaps.length);
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

  it('surfaces architecture rule errors in rule health and risks', () => {
    const frontend = createMockComponent({
      component_id: 'COMP_frontend_app',
      name: 'FrontendApp',
      role: { layer: 'frontend', purpose: 'UI', critical: true },
    });
    const database = createMockComponent({
      component_id: 'COMP_database_main',
      name: 'MainDatabase',
      role: { layer: 'database', purpose: 'Data', critical: true },
    });
    const directConnection = createMockConnection(
      frontend.component_id,
      database.component_id
    );

    const summary = buildExecutiveSummary(
      [frontend, database],
      [directConnection],
      '/test/project'
    );

    expect(summary.rule_health.errors).toBeGreaterThan(0);
    expect(summary.rule_health.violations[0]?.severity).toBe('error');
    expect(summary.risks.some((risk) => risk.type === 'architecture_rule')).toBe(true);
    expect(summary.next_actions[0]?.command).toBe('navgator rules --severity error');
  });

  it('bounds large summaries and reports total versus returned counts', () => {
    const components = Array.from({ length: AGENT_OUTPUT_LIMITS.components + 25 }, (_, index) =>
      createMockComponent({
        component_id: `COMP_service_${index}`,
        name: `Service${String(index).padStart(3, '0')}`,
        role: { layer: 'backend', purpose: 'Service', critical: false },
      })
    );
    const connections = Array.from({ length: AGENT_OUTPUT_LIMITS.connections + 25 }, (_, index) =>
      createMockConnection(
        components[index % components.length]!.component_id,
        components[(index + 1) % components.length]!.component_id,
        { connection_id: `CONN_${index}` }
      )
    );

    const summary = buildExecutiveSummary(components, connections, '/test/project');

    expect(summary.components).toHaveLength(AGENT_OUTPUT_LIMITS.components);
    expect(summary.connections).toHaveLength(AGENT_OUTPUT_LIMITS.connections);
    expect(summary.truncation.components).toEqual({
      total: components.length,
      returned: AGENT_OUTPUT_LIMITS.components,
      truncated: true,
      limit: AGENT_OUTPUT_LIMITS.components,
    });
    expect(summary.truncation.connections.total).toBe(connections.length);
    expect(summary.truncation.connections.returned).toBe(AGENT_OUTPUT_LIMITS.connections);
    expect(JSON.stringify(summary).length).toBeLessThan(100_000);
  });
});
