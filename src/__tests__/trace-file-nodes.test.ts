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
    // reports the path. The contract: only node IDENTITY may differ between the two modes,
    // never the number of paths reported.
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
