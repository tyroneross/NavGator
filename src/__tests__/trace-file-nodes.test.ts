/**
 * Tests for FILE: reference resolution in traceDataflow().
 *
 * Ground truth (2026-08-03 probe): A -> FILE:src/x.ts -> B already reached B before this
 * change via the synthetic-node fallback. The residual defect fixed here: when a FILE: id
 * names a path that a real component owns via source.config_files, trace should resolve to
 * that owner instead of rendering a synthetic node.
 */

import { describe, it, expect } from 'vitest';
import { traceDataflow } from '../trace.js';
import { createComponent, createConnection } from './helpers.js';
import type { ArchitectureComponent } from '../types.js';

describe('traceDataflow FILE: node resolution', () => {
  it('regression: A -> FILE:x -> B still reaches B (today\'s working behavior)', () => {
    const a = createComponent('a', { layer: 'frontend' });
    const b = createComponent('b', { layer: 'backend' });

    const connToFile = createConnection(a, 'FILE:src/x.ts');
    const connFromFile = createConnection('FILE:src/x.ts', b);

    const components = [a, b];
    const connections = [connToFile, connFromFile];

    const result = traceDataflow(a, components, connections, { direction: 'forward' });

    expect(result.components_touched).toContain(b.component_id);
  });

  it('resolves a FILE: reference to the component that owns it via source.config_files', () => {
    const a = createComponent('a', { layer: 'frontend' });
    const owner: ArchitectureComponent = createComponent({
      name: 'owner',
      layer: 'backend',
      file: 'src/x.ts',
    });
    const b = createComponent('b', { layer: 'backend' });

    const connToFile = createConnection(a, 'FILE:src/x.ts');
    const connFromFile = createConnection('FILE:src/x.ts', b);

    const components = [a, owner, b];
    const connections = [connToFile, connFromFile];

    const result = traceDataflow(a, components, connections, { direction: 'forward' });

    // The path should contain the owner's real component id...
    expect(result.components_touched).toContain(owner.component_id);
    // ...and NOT a synthetic FILE:src/x.ts node.
    expect(result.components_touched).not.toContain('FILE:src/x.ts');
    // ...and the trace must still REACH the far endpoint (b) through the resolved owner —
    // touching the owner id alone doesn't prove the path continued past it.
    expect(result.components_touched).toContain(b.component_id);
    const somePathReachesB = result.paths.some(p =>
      p.steps.some(s => s.component.id === b.component_id)
    );
    expect(somePathReachesB).toBe(true);
  });

  it('f2 closure: owner-resolution must not DELETE a path relative to resolveFileNodes:false', () => {
    // Ground truth (auditor probe, this review pass): a -> b -> FILE:src/y.ts, where `a` owns
    // src/y.ts via source.config_files. With the default resolveFileNodes:true, the FILE: hop
    // resolves back to `a`, which is already on the BFS path (start node) — a naive
    // `if (current.visited.has(nextId)) continue;` silently drops the branch and the path is
    // never recorded. resolveFileNodes:false (always-synthesize) has no such collision and
    // reports the path.
    //
    // The contract is NOT "the two modes always report the same path count" — that framing
    // is wrong, and a fix built on it only clamps the count. Owner resolution is ALLOWED to
    // merge two branches whose endpoints resolve to the SAME component, because they are one
    // architectural relationship expressed through two files. What it must never do is drop a
    // branch's representation. So the real contract is:
    //   1. branches that resolve to DIFFERENT components stay distinct (see the CE1 case below);
    //   2. every real component reachable with resolveFileNodes:false is still reachable with
    //      it on (see the direction case below);
    //   3. a blocked branch is recorded as a terminal step, not discarded.
    const a: ArchitectureComponent = createComponent({
      name: 'a',
      layer: 'frontend',
      file: 'src/y.ts',
    });
    const b = createComponent('b', { layer: 'backend' });

    const connAtoB = createConnection(a, b);
    const connBtoFile = createConnection(b, 'FILE:src/y.ts');

    const components = [a, b];
    const connections = [connAtoB, connBtoFile];

    const resolved = traceDataflow(a, components, connections, { direction: 'forward' });
    const unresolved = traceDataflow(a, components, connections, {
      direction: 'forward',
      resolveFileNodes: false,
    });

    // Before the fix: resolved.paths.length === 0, unresolved.paths.length === 1.
    expect(resolved.paths.length).toBe(unresolved.paths.length);
    expect(resolved.paths.length).toBeGreaterThan(0);
  });

  it('f2 CE1: a blocked branch beside a surviving one is still reported', () => {
    // The defect the first fix missed. A node-level "did anything advance" flag is masked by
    // any surviving sibling edge, so this shape regressed to 1 path vs 2 even after that fix.
    // Measured before the per-edge fix: resolved 1, unresolved 2. The two FILE:/real targets
    // are DIFFERENT components, so no merge is permitted here.
    const a = createComponent({ name: 'a', layer: 'frontend', file: 'src/f1.ts' });
    const b = createComponent('b', { layer: 'backend' });
    const c = createComponent('c', { layer: 'backend' });
    const components = [a, b, c];
    const connections = [
      createConnection(a, b),
      createConnection(b, 'FILE:src/f1.ts'),
      createConnection(b, c),
    ];

    const resolved = traceDataflow(a, components, connections, { direction: 'forward' });
    const unresolved = traceDataflow(a, components, connections, {
      direction: 'forward',
      resolveFileNodes: false,
    });

    expect(resolved.paths.length).toBe(unresolved.paths.length);
  });

  it('f2 CE2: two edges onto the SAME owner merge, and the branch stays represented', () => {
    // Deliberately NOT a count-equality assertion. Both FILE: hops resolve to `a`, so they are
    // one relationship and merging them to a single path is the correct answer under owner
    // resolution. What must hold is that the branch is represented at all — the path closes
    // back on the owner rather than vanishing.
    const a = createComponent({ name: 'a', layer: 'frontend', file: 'src/f1.ts' });
    a.source.config_files = ['src/f1.ts', 'src/f2.ts'];
    const b = createComponent('b', { layer: 'backend' });
    const components = [a, b];
    const connections = [
      createConnection(a, b),
      createConnection(b, 'FILE:src/f1.ts'),
      createConnection(b, 'FILE:src/f2.ts'),
    ];

    const resolved = traceDataflow(a, components, connections, { direction: 'forward' });

    expect(resolved.paths.length).toBeGreaterThan(0);
    const ids = resolved.paths[0].steps.map((s) => s.component.id);
    expect(ids).toEqual([a.component_id, b.component_id, a.component_id]);
  });

  it('f2: no real component reachable with resolveFileNodes:false is lost, in any direction', () => {
    // `both` is the default for the explore MCP tool, so the earlier forward-only coverage
    // left the most-used direction untested.
    const a = createComponent({ name: 'a', layer: 'frontend', file: 'src/f1.ts' });
    const b = createComponent('b', { layer: 'backend' });
    const c = createComponent('c', { layer: 'backend' });
    const components = [a, b, c];
    const connections = [
      createConnection(a, b),
      createConnection(b, 'FILE:src/f1.ts'),
      createConnection(b, c),
    ];

    for (const direction of ['forward', 'backward', 'both'] as const) {
      const resolved = traceDataflow(c, components, connections, { direction });
      const unresolved = traceDataflow(c, components, connections, {
        direction,
        resolveFileNodes: false,
      });
      const realReachable = unresolved.components_touched.filter((id) => !id.startsWith('FILE:'));
      for (const id of realReachable) {
        expect(resolved.components_touched).toContain(id);
      }
    }
  });

  it('resolveFileNodes: false restores the synthetic node', () => {
    const a = createComponent('a', { layer: 'frontend' });
    const owner: ArchitectureComponent = createComponent({
      name: 'owner',
      layer: 'backend',
      file: 'src/x.ts',
    });
    const b = createComponent('b', { layer: 'backend' });

    const connToFile = createConnection(a, 'FILE:src/x.ts');
    const connFromFile = createConnection('FILE:src/x.ts', b);

    const components = [a, owner, b];
    const connections = [connToFile, connFromFile];

    const result = traceDataflow(a, components, connections, {
      direction: 'forward',
      resolveFileNodes: false,
    });

    expect(result.components_touched).toContain('FILE:src/x.ts');
  });
});
