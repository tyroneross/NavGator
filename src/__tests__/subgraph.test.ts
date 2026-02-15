/**
 * Tests for NavGator Queryable Subgraph Export
 */

import { describe, it, expect } from 'vitest';
import { extractSubgraph, subgraphToMermaid, SubgraphOptions } from '../subgraph.js';
import { createMockComponent, createMockConnection } from './helpers.js';
import { ArchitectureComponent, ArchitectureConnection } from '../types.js';

describe('subgraph', () => {
  const mockComponents = [
    createMockComponent({ component_id: 'comp-1', name: 'API Service', type: 'service', role: { purpose: 'API routes', layer: 'backend', critical: false } }),
    createMockComponent({ component_id: 'comp-2', name: 'Database', type: 'database', role: { purpose: 'Data persistence', layer: 'database', critical: false } }),
    createMockComponent({ component_id: 'comp-3', name: 'External API', type: 'service', role: { purpose: 'Third-party service', layer: 'external', critical: false } }),
    createMockComponent({ component_id: 'comp-4', name: 'Frontend', type: 'component', role: { purpose: 'User interface', layer: 'frontend', critical: false } }),
    createMockComponent({ component_id: 'comp-5', name: 'Auth Service', type: 'service', role: { purpose: 'Authentication', layer: 'backend', critical: false } }),
  ];

  const mockConnections = [
    createMockConnection('comp-1', 'comp-2', { connection_id: 'conn-1', confidence: 0.9 }),
    createMockConnection('comp-1', 'comp-3', { connection_id: 'conn-2', confidence: 0.8, semantic: { classification: 'api-call' as any, confidence: 0.8 } }),
    createMockConnection('comp-4', 'comp-1', { connection_id: 'conn-3', confidence: 0.9, semantic: { classification: 'http-request' as any, confidence: 0.8 } }),
    createMockConnection('comp-1', 'comp-5', { connection_id: 'conn-4', confidence: 0.7, semantic: { classification: 'service-call' as any, confidence: 0.8 } }),
    createMockConnection('comp-5', 'comp-2', { connection_id: 'conn-5', confidence: 0.8 }),
  ];

  it('extracts subgraph focused on single component at depth 2', () => {
    const options: SubgraphOptions = {
      focus: ['API Service'],
      depth: 2,
    };

    const result = extractSubgraph(mockComponents, mockConnections, options);

    // At depth 2 from API Service:
    // Depth 0: comp-1 (API Service)
    // Depth 1: comp-2 (Database), comp-3 (External API), comp-4 (Frontend), comp-5 (Auth Service)
    // Depth 2: No new components (comp-2 is already visited from depth 1)
    expect(result.stats.nodes).toBeGreaterThanOrEqual(4);
    expect(result.components.find(c => c.id === 'comp-1')).toBeDefined();
  });

  it('filters by layer', () => {
    const options: SubgraphOptions = {
      layers: ['backend'],
    };

    const result = extractSubgraph(mockComponents, mockConnections, options);

    // Should only include backend components: comp-1 (API Service), comp-5 (Auth Service)
    expect(result.components.every(c => {
      const fullComp = mockComponents.find(mc => mc.component_id === c.id);
      return fullComp?.role.layer === 'backend';
    })).toBe(true);

    expect(result.components.find(c => c.id === 'comp-1')).toBeDefined();
    expect(result.components.find(c => c.id === 'comp-5')).toBeDefined();
    expect(result.components.find(c => c.id === 'comp-2')).toBeUndefined(); // database layer
    expect(result.components.find(c => c.id === 'comp-4')).toBeUndefined(); // frontend layer
  });

  it('returns only focused components at depth 0', () => {
    const options: SubgraphOptions = {
      focus: ['API Service'],
      depth: 0,
    };

    const result = extractSubgraph(mockComponents, mockConnections, options);

    expect(result.stats.nodes).toBe(1);
    expect(result.components[0].id).toBe('comp-1');
    expect(result.stats.edges).toBe(0); // No connections within a single node
  });

  it('returns direct neighbors at depth 1', () => {
    const options: SubgraphOptions = {
      focus: ['API Service'],
      depth: 1,
    };

    const result = extractSubgraph(mockComponents, mockConnections, options);

    // comp-1 + direct neighbors: comp-2, comp-3, comp-4, comp-5
    expect(result.stats.nodes).toBe(5);
    expect(result.components.find(c => c.id === 'comp-1')).toBeDefined();
    expect(result.components.find(c => c.id === 'comp-2')).toBeDefined();
    expect(result.components.find(c => c.id === 'comp-3')).toBeDefined();
    expect(result.components.find(c => c.id === 'comp-4')).toBeDefined();
    expect(result.components.find(c => c.id === 'comp-5')).toBeDefined();
  });

  it('truncates results to maxNodes', () => {
    const options: SubgraphOptions = {
      maxNodes: 2,
    };

    const result = extractSubgraph(mockComponents, mockConnections, options);

    expect(result.stats.nodes).toBeLessThanOrEqual(2);
  });

  it('returns empty subgraph when focus does not resolve', () => {
    const options: SubgraphOptions = {
      focus: ['NonExistent Component'],
    };

    const result = extractSubgraph(mockComponents, mockConnections, options);

    expect(result.stats.nodes).toBe(0);
    expect(result.stats.edges).toBe(0);
  });

  it('filters connections by classification', () => {
    const options: SubgraphOptions = {
      classification: 'api-call',
    };

    const result = extractSubgraph(mockComponents, mockConnections, options);

    // Only conn-2 has classification 'api-call'
    expect(result.stats.edges).toBe(1);
    expect(result.connections[0].f).toBe('comp-1');
    expect(result.connections[0].t).toBe('comp-3');
  });

  it('produces valid Mermaid syntax', () => {
    const options: SubgraphOptions = {
      focus: ['API Service'],
      depth: 1,
    };

    const result = extractSubgraph(mockComponents, mockConnections, options);
    const mermaid = subgraphToMermaid(result);

    expect(mermaid).toContain('graph TD');
    expect(mermaid).toContain('comp_1["API Service"]');
    expect(mermaid).toContain('-->');
  });

  it('sanitizes component IDs in Mermaid output', () => {
    const specialComponents = [
      createMockComponent({ component_id: 'comp-with-dashes', name: 'Special "Component"', type: 'service' }),
    ];

    const result = extractSubgraph(specialComponents, [], {});
    const mermaid = subgraphToMermaid(result);

    expect(mermaid).toContain('comp_with_dashes'); // Dashes replaced with underscores
    expect(mermaid).toContain("Special 'Component'"); // Quotes sanitized
  });

  it('combines focus and layer filters', () => {
    const options: SubgraphOptions = {
      focus: ['API Service'],
      depth: 1,
      layers: ['backend', 'database'],
    };

    const result = extractSubgraph(mockComponents, mockConnections, options);

    // Should include comp-1 (backend), comp-2 (database), comp-5 (backend)
    // Should exclude comp-3 (external), comp-4 (frontend)
    expect(result.components.find(c => c.id === 'comp-1')).toBeDefined();
    expect(result.components.find(c => c.id === 'comp-2')).toBeDefined();
    expect(result.components.find(c => c.id === 'comp-5')).toBeDefined();
    expect(result.components.find(c => c.id === 'comp-3')).toBeUndefined();
    expect(result.components.find(c => c.id === 'comp-4')).toBeUndefined();
  });

  it('handles multiple focus components', () => {
    const options: SubgraphOptions = {
      focus: ['API Service', 'Frontend'],
      depth: 1,
    };

    const result = extractSubgraph(mockComponents, mockConnections, options);

    // Should include both focus components and their neighbors
    expect(result.components.find(c => c.id === 'comp-1')).toBeDefined(); // API Service
    expect(result.components.find(c => c.id === 'comp-4')).toBeDefined(); // Frontend
  });
});
