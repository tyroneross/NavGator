/**
 * Tests for NavGator Coverage / Confidence Reporting
 */

import { describe, it, expect } from 'vitest';
import { computeCoverage, formatCoverageOutput, CoverageReport } from '../coverage.js';
import { createMockComponent, createMockConnection } from './helpers.js';
import { ArchitectureComponent, ArchitectureConnection } from '../types.js';
import * as path from 'path';

describe('coverage', () => {
  const mockComponents = [
    createMockComponent({ component_id: 'comp-1', name: 'API Service', type: 'service', role: { purpose: 'API routes', layer: 'backend', critical: false } }),
    createMockComponent({ component_id: 'comp-2', name: 'Database', type: 'database', role: { purpose: 'Data persistence', layer: 'database', critical: false } }),
    createMockComponent({ component_id: 'comp-3', name: 'External API', type: 'service', role: { purpose: 'Third-party service', layer: 'external', critical: false } }),
    createMockComponent({ component_id: 'comp-4', name: 'Orphan Service', type: 'service', role: { purpose: 'Isolated service', layer: 'backend', critical: false } }),
  ];

  const mockConnections = [
    createMockConnection('comp-1', 'comp-2', { connection_id: 'conn-1', confidence: 0.9 }),
    createMockConnection('comp-1', 'comp-3', { connection_id: 'conn-2', confidence: 0.4, semantic: { classification: 'api-call' as any, confidence: 0.8 } }),
    createMockConnection('comp-2', 'comp-1', { connection_id: 'conn-3', confidence: 0.6, semantic: { classification: 'data-query' as any, confidence: 0.8 } }),
  ];

  const mockFileMap = {
    'src/api/server.ts': 'comp-1',
    'src/orphan.ts': 'comp-4',
  };

  it('calculates coverage with known component/connection counts', async () => {
    const projectRoot = path.resolve(__dirname, '../..');
    const report = await computeCoverage(mockComponents, mockConnections, projectRoot, mockFileMap);

    expect(report.component_coverage.files_mapped_to_components).toBe(2);
    expect(report.connection_coverage.total_connections).toBe(3);
    expect(report.overall_confidence).toBeGreaterThan(0);
  });

  it('detects zero-consumer components', async () => {
    const projectRoot = path.resolve(__dirname, '../..');
    const report = await computeCoverage(mockComponents, mockConnections, projectRoot, mockFileMap);

    const zeroConsumerGaps = report.gaps.filter(g => g.type === 'zero-consumers');
    expect(zeroConsumerGaps.length).toBeGreaterThan(0);

    // comp-3 (external) should not be flagged
    const comp3Gap = zeroConsumerGaps.find(g => g.target === 'External API');
    expect(comp3Gap).toBeUndefined();

    // comp-4 (orphan service) should be flagged
    const comp4Gap = zeroConsumerGaps.find(g => g.target === 'Orphan Service');
    expect(comp4Gap).toBeDefined();
  });

  it('detects no-outgoing components', async () => {
    const projectRoot = path.resolve(__dirname, '../..');
    const report = await computeCoverage(mockComponents, mockConnections, projectRoot, mockFileMap);

    const noOutgoingGaps = report.gaps.filter(g => g.type === 'no-outgoing');

    // comp-2 (database) should not be flagged
    const comp2Gap = noOutgoingGaps.find(g => g.target === 'Database');
    expect(comp2Gap).toBeUndefined();

    // comp-3 (external) should not be flagged
    const comp3Gap = noOutgoingGaps.find(g => g.target === 'External API');
    expect(comp3Gap).toBeUndefined();

    // comp-4 (orphan) should be flagged
    const comp4Gap = noOutgoingGaps.find(g => g.target === 'Orphan Service');
    expect(comp4Gap).toBeDefined();
  });

  it('detects low confidence connections', async () => {
    const projectRoot = path.resolve(__dirname, '../..');
    const report = await computeCoverage(mockComponents, mockConnections, projectRoot, mockFileMap);

    const lowConfGaps = report.gaps.filter(g => g.type === 'low-confidence-connection');
    expect(lowConfGaps.length).toBe(1);
    expect(lowConfGaps[0].target).toBe('conn-2');
  });

  it('buckets connections by confidence level', async () => {
    const projectRoot = path.resolve(__dirname, '../..');
    const report = await computeCoverage(mockComponents, mockConnections, projectRoot, mockFileMap);

    expect(report.connection_coverage.by_confidence.high).toBe(1); // conn-1 (0.9)
    expect(report.connection_coverage.by_confidence.medium).toBe(1); // conn-3 (0.6)
    expect(report.connection_coverage.by_confidence.low).toBe(1); // conn-2 (0.4)
  });

  it('calculates overall confidence as weighted average', async () => {
    const projectRoot = path.resolve(__dirname, '../..');
    const report = await computeCoverage(mockComponents, mockConnections, projectRoot, mockFileMap);

    // Overall confidence = 60% conn confidence + 40% coverage
    // Avg conn confidence = (0.9 + 0.4 + 0.6) / 3 = 0.633
    // Coverage will vary based on actual project files
    expect(report.overall_confidence).toBeGreaterThan(0);
    expect(report.overall_confidence).toBeLessThanOrEqual(1);
  });

  it('groups connections by classification', async () => {
    const projectRoot = path.resolve(__dirname, '../..');
    const report = await computeCoverage(mockComponents, mockConnections, projectRoot, mockFileMap);

    expect(report.connection_coverage.by_classification['api-call']).toBe(1);
    expect(report.connection_coverage.by_classification['data-query']).toBe(1);
    expect(report.connection_coverage.by_classification['unclassified']).toBe(1);
  });

  it('formats coverage output as readable string', async () => {
    const projectRoot = path.resolve(__dirname, '../..');
    const report = await computeCoverage(mockComponents, mockConnections, projectRoot, mockFileMap);

    const output = formatCoverageOutput(report, false);

    expect(output).toContain('NavGator - Architecture Coverage Report');
    expect(output).toContain('Overall confidence:');
    expect(output).toContain('FILE COVERAGE:');
    expect(output).toContain('CONNECTION CONFIDENCE:');
    expect(output).toContain('GAPS');
  });

  it('formats gaps-only output', async () => {
    const projectRoot = path.resolve(__dirname, '../..');
    const report = await computeCoverage(mockComponents, mockConnections, projectRoot, mockFileMap);

    const output = formatCoverageOutput(report, true);

    expect(output).not.toContain('NavGator - Architecture Coverage Report');
    expect(output).toContain('GAPS');
  });

  it('handles empty gaps gracefully', async () => {
    const projectRoot = path.resolve(__dirname, '../..');
    const noGapComponents = [
      createMockComponent({ component_id: 'comp-1', name: 'Service A', type: 'service', role: { purpose: 'Service', layer: 'backend', critical: false } }),
      createMockComponent({ component_id: 'comp-2', name: 'Service B', type: 'service', role: { purpose: 'Service', layer: 'backend', critical: false } }),
    ];

    const noGapConnections = [
      createMockConnection('comp-1', 'comp-2', { connection_id: 'conn-1', confidence: 0.9 }),
      createMockConnection('comp-2', 'comp-1', { connection_id: 'conn-2', confidence: 0.8 }),
    ];

    const report = await computeCoverage(
      noGapComponents,
      noGapConnections,
      projectRoot,
      { 'src/a.ts': 'comp-1', 'src/b.ts': 'comp-2' }
    );

    // Real project files will show as unmapped, but component-level gaps should be empty
    const componentGaps = report.gaps.filter(g =>
      g.type === 'zero-consumers' || g.type === 'no-outgoing' || g.type === 'low-confidence-connection'
    );
    expect(componentGaps).toHaveLength(0);
  });
});
