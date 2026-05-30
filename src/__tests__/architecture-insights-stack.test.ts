/**
 * Regression test for R6 stack-overflow on large/cyclic import graphs.
 *
 * Symptom (verified on atomize-ai 2026-05): scanning a project with ~2475
 * components and deep import chains caused `detectImportCycles` to throw
 * "Maximum call stack size exceeded" because its `visit()` helper recursed
 * once per import edge along the longest path. Node's default V8 stack tops
 * out around ~10–15k frames for this function's frame size; a single chain
 * of ~10k internal imports is enough to blow it (verified empirically with
 * `node -e` reproduction).
 *
 * The fix converts `visit()` to an explicit work-stack iteration. These tests
 * lock in the post-fix invariants:
 *   1. A 15,000-node deep linear import chain (well past the recursive limit)
 *      completes without throwing.
 *   2. A 15,000-node chain that closes into a cycle still detects exactly one
 *      cycle and reports it correctly.
 *   3. A graph mixing multiple cycles still respects the `limit` argument.
 */

import { describe, expect, it } from 'vitest';
import { detectImportCycles } from '../architecture-insights.js';
import { createComponent, createConnection } from './helpers.js';
import type { ArchitectureComponent, ArchitectureConnection } from '../types.js';

function buildLinearChain(depth: number): {
  components: ArchitectureComponent[];
  connections: ArchitectureConnection[];
} {
  const components: ArchitectureComponent[] = [];
  const connections: ArchitectureConnection[] = [];
  for (let i = 0; i < depth; i++) {
    components.push(
      createComponent({
        name: `chain/node-${i}`,
        type: 'component',
        file: `src/chain/node-${i}.ts`,
      })
    );
  }
  for (let i = 0; i < depth - 1; i++) {
    connections.push(
      createConnection(components[i], components[i + 1], { connection_type: 'imports' })
    );
  }
  return { components, connections };
}

describe('detectImportCycles — stack-overflow regression', () => {
  it('handles a 15,000-node deep linear chain without overflowing the stack', () => {
    // 15,000 is deliberately well past V8's default ~10–15k frame budget for
    // this function's frame size (verified throws at this depth with a
    // standalone reproduction of the recursive visit() pattern).
    // A linear chain has NO cycle, so the correct answer is [].
    const { components, connections } = buildLinearChain(15000);

    // Pre-fix behavior: throws "Maximum call stack size exceeded".
    // Post-fix: returns [] in well under a second.
    expect(() => detectImportCycles(components, connections, 5)).not.toThrow();
    const cycles = detectImportCycles(components, connections, 5);
    expect(cycles).toEqual([]);
  });

  it('detects a single cycle inside a 15,000-node graph', () => {
    const { components, connections } = buildLinearChain(15000);
    // Close the chain back to node-0 → forms one 3,500-node cycle.
    connections.push(
      createConnection(components[components.length - 1], components[0], {
        connection_type: 'imports',
      })
    );

    expect(() => detectImportCycles(components, connections, 5)).not.toThrow();
    const cycles = detectImportCycles(components, connections, 5);
    expect(cycles).toHaveLength(1);
    // Cycle is recorded as the full ring (start..end..start). Just spot-check
    // structure — we don't want to materialize 3,500 names in the assertion.
    expect(cycles[0][0]).toBe('chain/node-0');
    expect(cycles[0][cycles[0].length - 1]).toBe('chain/node-0');
    expect(cycles[0]).toHaveLength(15001);
  });

  it('respects the limit when many cycles are present', () => {
    // Build 10 independent 4-node cycles.
    const components: ArchitectureComponent[] = [];
    const connections: ArchitectureConnection[] = [];
    for (let r = 0; r < 10; r++) {
      const ring = Array.from({ length: 4 }, (_, i) =>
        createComponent({
          name: `ring-${r}/node-${i}`,
          type: 'component',
          file: `src/ring-${r}/node-${i}.ts`,
        })
      );
      components.push(...ring);
      for (let i = 0; i < ring.length; i++) {
        connections.push(
          createConnection(ring[i], ring[(i + 1) % ring.length], { connection_type: 'imports' })
        );
      }
    }

    expect(() => detectImportCycles(components, connections, 3)).not.toThrow();
    const cycles = detectImportCycles(components, connections, 3);
    expect(cycles).toHaveLength(3);
  });
});
