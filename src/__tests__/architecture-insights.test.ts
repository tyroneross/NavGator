import { describe, expect, it } from 'vitest';
import {
  detectImportCycles,
  detectLayerViolations,
  detectShallowModules,
  getModuleDepthSignals,
  getTopFanOut,
  getTopHotspots,
} from '../architecture-insights.js';
import { createComponent, createConnection } from './helpers.js';

describe('architecture insights', () => {
  it('surfaces internal hotspots by import fan-in', () => {
    const core = createComponent({ name: 'core/types', type: 'component', file: 'src/core/types.ts' });
    const a = createComponent({ name: 'cdp/driver', type: 'component', file: 'src/cdp/driver.ts' });
    const b = createComponent({ name: 'mcp/server', type: 'component', file: 'src/mcp/server.ts' });
    const c = createComponent({ name: 'media/session', type: 'component', file: 'src/media/session.ts' });

    const hotspots = getTopHotspots(
      [core, a, b, c],
      [
        createConnection(a, core, { connection_type: 'imports' }),
        createConnection(b, core, { connection_type: 'imports' }),
        createConnection(c, core, { connection_type: 'imports' }),
      ]
    );

    expect(hotspots[0].component.name).toBe('core/types');
    expect(hotspots[0].count).toBe(3);
  });

  it('surfaces high fan-out internal modules', () => {
    const driver = createComponent({ name: 'cdp/driver', type: 'component', file: 'src/cdp/driver.ts' });
    const deps = Array.from({ length: 8 }, (_, index) =>
      createComponent({ name: `core/dep-${index}`, type: 'component', file: `src/core/dep-${index}.ts` })
    );

    const fanOut = getTopFanOut(
      [driver, ...deps],
      deps.map((dep) => createConnection(driver, dep, { connection_type: 'imports' }))
    );

    expect(fanOut[0].component.name).toBe('cdp/driver');
    expect(fanOut[0].count).toBe(8);
  });

  it('detects upward inferred layer imports', () => {
    const core = createComponent({ name: 'core/types', type: 'component', file: 'src/core/types.ts' });
    const cdp = createComponent({ name: 'cdp/driver', type: 'component', file: 'src/cdp/driver.ts' });

    const violations = detectLayerViolations(
      [core, cdp],
      [createConnection(cdp, core, { connection_type: 'imports' }), createConnection(core, cdp, { connection_type: 'imports' })]
    );

    expect(violations).toHaveLength(1);
    expect(violations[0].from.name).toBe('cdp/driver');
    expect(violations[0].to.name).toBe('core/types');
  });

  it('detects import cycles', () => {
    const a = createComponent({ name: 'core/a', type: 'component', file: 'src/core/a.ts' });
    const b = createComponent({ name: 'core/b', type: 'component', file: 'src/core/b.ts' });
    const c = createComponent({ name: 'core/c', type: 'component', file: 'src/core/c.ts' });

    const cycles = detectImportCycles(
      [a, b, c],
      [
        createConnection(a, b, { connection_type: 'imports' }),
        createConnection(b, c, { connection_type: 'imports' }),
        createConnection(c, a, { connection_type: 'imports' }),
      ]
    );

    expect(cycles).toHaveLength(1);
    expect(cycles[0]).toEqual(['core/a', 'core/b', 'core/c', 'core/a']);
  });

  it('does NOT flag a deep module (high fan-in, low fan-out) as shallow', () => {
    // core/types is imported by 5 modules and imports nothing → deep.
    const core = createComponent({ name: 'core/types', type: 'component', file: 'src/core/types.ts' });
    const importers = Array.from({ length: 5 }, (_, index) =>
      createComponent({ name: `cdp/dep-${index}`, type: 'component', file: `src/cdp/dep-${index}.ts` })
    );

    const shallow = detectShallowModules(
      [core, ...importers],
      importers.map((dep) => createConnection(dep, core, { connection_type: 'imports' }))
    );

    expect(shallow.some((s) => s.component.name === 'core/types')).toBe(false);
  });

  it('flags a shallow module (imports many, used by few)', () => {
    // glue imports 6 modules, used by 1 → fanOut 6, fanIn 1, shallowness 3.
    const glue = createComponent({ name: 'glue/wire', type: 'component', file: 'src/glue/wire.ts' });
    const app = createComponent({ name: 'app/main', type: 'component', file: 'src/app/main.ts' });
    const deps = Array.from({ length: 6 }, (_, index) =>
      createComponent({ name: `core/dep-${index}`, type: 'component', file: `src/core/dep-${index}.ts` })
    );

    const shallow = detectShallowModules(
      [glue, app, ...deps],
      [
        createConnection(app, glue, { connection_type: 'imports' }),
        ...deps.map((dep) => createConnection(glue, dep, { connection_type: 'imports' })),
      ]
    );

    const flagged = shallow.find((s) => s.component.name === 'glue/wire');
    expect(flagged).toBeDefined();
    expect(flagged!.fanOut).toBe(6);
    expect(flagged!.fanIn).toBe(1);
    expect(flagged!.shallownessScore).toBeCloseTo(3);
  });

  it('computes fanIn / fanOut / shallownessScore on a known graph', () => {
    // Edges: a→b, a→c, d→a
    const a = createComponent({ name: 'core/a', type: 'component', file: 'src/core/a.ts' });
    const b = createComponent({ name: 'core/b', type: 'component', file: 'src/core/b.ts' });
    const c = createComponent({ name: 'core/c', type: 'component', file: 'src/core/c.ts' });
    const d = createComponent({ name: 'core/d', type: 'component', file: 'src/core/d.ts' });

    const signals = getModuleDepthSignals(
      [a, b, c, d],
      [
        createConnection(a, b, { connection_type: 'imports' }),
        createConnection(a, c, { connection_type: 'imports' }),
        createConnection(d, a, { connection_type: 'imports' }),
      ]
    );

    const byName = new Map(signals.map((s) => [s.component.name, s]));

    // a: imported by {d} (fanIn 1), imports {b,c} (fanOut 2) → 2/(1+1) = 1
    expect(byName.get('core/a')).toMatchObject({ fanIn: 1, fanOut: 2, shallownessScore: 1 });
    // b: imported by {a}, imports nothing → 0/(1+1) = 0
    expect(byName.get('core/b')).toMatchObject({ fanIn: 1, fanOut: 0, shallownessScore: 0 });
    // d: imported by none, imports {a} → 1/(0+1) = 1
    expect(byName.get('core/d')).toMatchObject({ fanIn: 0, fanOut: 1, shallownessScore: 1 });

    // Sorted by shallownessScore desc, tie-break by name: a and d tie at 1, a first.
    expect(signals[0].component.name).toBe('core/a');
  });
});
