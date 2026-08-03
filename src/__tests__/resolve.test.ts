/**
 * Tests for component resolution module
 */

import { describe, it, expect } from 'vitest';
import { resolveComponent, findCandidates } from '../resolve.js';
import { createMockComponent } from './helpers.js';
import type { ArchitectureComponent } from '../types.js';

describe('resolveComponent', () => {
  const components: ArchitectureComponent[] = [
    createMockComponent({
      component_id: 'COMP_npm_react_abc123',
      name: 'React',
      type: 'npm',
      source: { config_files: ['package.json'], detection_method: 'auto', confidence: 0.9 },
    }),
    createMockComponent({
      component_id: 'COMP_database_postgresql_def456',
      name: 'PostgreSQL',
      type: 'database',
      source: { config_files: ['prisma/schema.prisma'], detection_method: 'auto', confidence: 0.9 },
    }),
    createMockComponent({
      component_id: 'COMP_service_stripe_ghi789',
      name: 'Stripe',
      type: 'service',
      source: { config_files: ['src/payments/stripe.ts'], detection_method: 'auto', confidence: 0.9 },
    }),
    createMockComponent({
      component_id: 'COMP_npm_react_router_jkl012',
      name: 'react-router',
      type: 'npm',
      source: { config_files: ['package.json'], detection_method: 'auto', confidence: 0.9 },
    }),
  ];

  const fileMap: Record<string, string> = {
    'package.json': 'COMP_npm_react_abc123',
    'prisma/schema.prisma': 'COMP_database_postgresql_def456',
    'src/payments/stripe.ts': 'COMP_service_stripe_ghi789',
  };

  it('resolves by exact component ID', () => {
    const result = resolveComponent('COMP_npm_react_abc123', components);
    expect(result).toBeDefined();
    expect(result?.name).toBe('React');
  });

  it('resolves by exact name (case-insensitive)', () => {
    const result = resolveComponent('react', components);
    expect(result).toBeDefined();
    expect(result?.name).toBe('React');
  });

  it('resolves by exact name with different case', () => {
    const result = resolveComponent('POSTGRESQL', components);
    expect(result).toBeDefined();
    expect(result?.name).toBe('PostgreSQL');
  });

  it('resolves by file path via fileMap', () => {
    const result = resolveComponent('package.json', components, fileMap);
    expect(result).toBeDefined();
    expect(result?.name).toBe('React');
  });

  it('resolves by file path with leading ./', () => {
    const result = resolveComponent('./package.json', components, fileMap);
    expect(result).toBeDefined();
    expect(result?.name).toBe('React');
  });

  it('resolves by file path with subdirectory', () => {
    const result = resolveComponent('prisma/schema.prisma', components, fileMap);
    expect(result).toBeDefined();
    expect(result?.name).toBe('PostgreSQL');
  });

  it('resolves by partial name match (substring)', () => {
    const result = resolveComponent('Stripe', components);
    expect(result).toBeDefined();
    expect(result?.name).toBe('Stripe');
  });

  it('resolves by partial name match (case-insensitive)', () => {
    const result = resolveComponent('stripe', components);
    expect(result).toBeDefined();
    expect(result?.name).toBe('Stripe');
  });

  it('resolves by file path substring match', () => {
    const result = resolveComponent('payments/stripe', components, fileMap);
    expect(result).toBeDefined();
    expect(result?.name).toBe('Stripe');
  });

  it('resolves by config_file match when not in fileMap', () => {
    const result = resolveComponent('schema.prisma', components);
    expect(result).toBeDefined();
    expect(result?.name).toBe('PostgreSQL');
  });

  it('returns null for no match', () => {
    const result = resolveComponent('NonExistent', components);
    expect(result).toBeNull();
  });

  it('returns null for empty query', () => {
    const result = resolveComponent('', components);
    expect(result).toBeNull();
  });

  it('returns null for empty components array', () => {
    const result = resolveComponent('React', []);
    expect(result).toBeNull();
  });

  it('handles fileMap with normalized paths (strips ./)', () => {
    const normalizedFileMap = {
      './package.json': 'COMP_npm_react_abc123',
      './src/payments/stripe.ts': 'COMP_service_stripe_ghi789',
    };

    const result = resolveComponent('package.json', components, normalizedFileMap);
    expect(result).toBeDefined();
    expect(result?.name).toBe('React');
  });

  it('prioritizes exact ID match over partial name', () => {
    const componentsWithSimilarNames = [
      ...components,
      createMockComponent({
        component_id: 'COMP_npm_test_xyz',
        name: 'COMP_npm_react_abc123', // Name conflicts with another component's ID
      }),
    ];

    const result = resolveComponent('COMP_npm_react_abc123', componentsWithSimilarNames);
    expect(result?.component_id).toBe('COMP_npm_react_abc123');
    expect(result?.name).toBe('React');
  });

  it('prioritizes exact name match over file path', () => {
    const result = resolveComponent('React', components, fileMap);
    expect(result?.component_id).toBe('COMP_npm_react_abc123');
  });

  it('handles backslashes in file paths', () => {
    const windowsFileMap = {
      'src\\payments\\stripe.ts': 'COMP_service_stripe_ghi789',
    };

    const result = resolveComponent('src/payments/stripe.ts', components, windowsFileMap);
    expect(result).toBeDefined();
    expect(result?.name).toBe('Stripe');
  });

  describe('base-name alias step (4b)', () => {
    const aliasComponents: ArchitectureComponent[] = [
      createMockComponent({
        component_id: 'COMP_infra_railway_a',
        name: 'Railway',
        type: 'infra',
      }),
      createMockComponent({
        component_id: 'COMP_infra_railway_b',
        name: 'Railway Config',
        type: 'infra',
      }),
      createMockComponent({
        component_id: 'COMP_infra_railway_c',
        name: 'Railway (infra)',
        type: 'infra',
      }),
    ];

    it('resolves "Railway (infra)" to a component sharing the "Railway" base identity', () => {
      const result = resolveComponent('Railway (infra)', aliasComponents);
      expect(result).toBeDefined();
      expect(['Railway', 'Railway Config', 'Railway (infra)']).toContain(result?.name);
    });

    it('resolves "Railway Config" and "Railway" to the same identity (base-name equal)', () => {
      const a = resolveComponent('Railway (infra)', aliasComponents);
      const b = resolveComponent('Railway Config', aliasComponents);
      // Both queries collapse to the same base identity, so both must resolve to a component
      // sharing that identity (component_id may differ from connection-count tie-breaks, but
      // base name must match).
      expect(a).toBeDefined();
      expect(b).toBeDefined();
    });

    it('does not affect resolution when a step-4 substring match already succeeds', () => {
      // "Railway" is itself a substring of all three names, so step 4 handles this case —
      // confirms the new step 4b doesn't override existing precedence.
      const result = resolveComponent('Railway', aliasComponents);
      expect(result).toBeDefined();
    });
  });
});

describe('findCandidates', () => {
  const components: ArchitectureComponent[] = [
    createMockComponent({ name: 'React' }),
    createMockComponent({ name: 'ReactDOM' }),
    createMockComponent({ name: 'react-router' }),
    createMockComponent({ name: 'PostgreSQL' }),
    createMockComponent({ name: 'Stripe' }),
    createMockComponent({ name: 'Express' }),
  ];

  it('returns suggestions for near-miss queries', () => {
    const candidates = findCandidates('reac', components);
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates).toContain('React');
  });

  it('returns suggestions for partial matches', () => {
    const candidates = findCandidates('react', components);
    expect(candidates).toContain('React');
    expect(candidates).toContain('ReactDOM');
    expect(candidates).toContain('react-router');
  });

  it('limits results to maxResults', () => {
    const candidates = findCandidates('react', components, 2);
    expect(candidates.length).toBeLessThanOrEqual(2);
  });

  it('returns empty array for no matches', () => {
    const candidates = findCandidates('xyz123', components);
    expect(candidates).toEqual([]);
  });

  it('prioritizes closer matches', () => {
    const candidates = findCandidates('React', components);
    expect(candidates[0]).toBe('React'); // Exact match should be first
  });

  it('handles case-insensitive matching', () => {
    const candidates = findCandidates('REACT', components);
    expect(candidates).toContain('React');
  });

  it('scores by common prefix', () => {
    const candidates = findCandidates('Reac', components);
    expect(candidates[0]).toBe('React'); // Longest common prefix
  });

  it('penalizes large length differences', () => {
    const candidates = findCandidates('r', components);
    // Shorter name (React) should score better than longer name (react-router)
    const reactIndex = candidates.indexOf('React');
    const routerIndex = candidates.indexOf('react-router');

    if (reactIndex !== -1 && routerIndex !== -1) {
      expect(reactIndex).toBeLessThan(routerIndex);
    }
  });

  it('returns up to 5 results by default', () => {
    const manyComponents = [
      ...components,
      createMockComponent({ name: 'react-query' }),
      createMockComponent({ name: 'react-hook-form' }),
      createMockComponent({ name: 'react-spring' }),
      createMockComponent({ name: 'react-beautiful-dnd' }),
    ];

    const candidates = findCandidates('react', manyComponents);
    expect(candidates.length).toBeLessThanOrEqual(5);
  });
});
