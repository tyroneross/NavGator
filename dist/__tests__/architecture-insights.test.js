import { describe, expect, it } from 'vitest';
import { detectImportCycles, detectLayerViolations, getTopFanOut, getTopHotspots, } from '../architecture-insights.js';
import { createComponent, createConnection } from './helpers.js';
describe('architecture insights', () => {
    it('surfaces internal hotspots by import fan-in', () => {
        const core = createComponent({ name: 'core/types', type: 'component', file: 'src/core/types.ts' });
        const a = createComponent({ name: 'cdp/driver', type: 'component', file: 'src/cdp/driver.ts' });
        const b = createComponent({ name: 'mcp/server', type: 'component', file: 'src/mcp/server.ts' });
        const c = createComponent({ name: 'media/session', type: 'component', file: 'src/media/session.ts' });
        const hotspots = getTopHotspots([core, a, b, c], [
            createConnection(a, core, { connection_type: 'imports' }),
            createConnection(b, core, { connection_type: 'imports' }),
            createConnection(c, core, { connection_type: 'imports' }),
        ]);
        expect(hotspots[0].component.name).toBe('core/types');
        expect(hotspots[0].count).toBe(3);
    });
    it('surfaces high fan-out internal modules', () => {
        const driver = createComponent({ name: 'cdp/driver', type: 'component', file: 'src/cdp/driver.ts' });
        const deps = Array.from({ length: 8 }, (_, index) => createComponent({ name: `core/dep-${index}`, type: 'component', file: `src/core/dep-${index}.ts` }));
        const fanOut = getTopFanOut([driver, ...deps], deps.map((dep) => createConnection(driver, dep, { connection_type: 'imports' })));
        expect(fanOut[0].component.name).toBe('cdp/driver');
        expect(fanOut[0].count).toBe(8);
    });
    it('detects upward inferred layer imports', () => {
        const core = createComponent({ name: 'core/types', type: 'component', file: 'src/core/types.ts' });
        const cdp = createComponent({ name: 'cdp/driver', type: 'component', file: 'src/cdp/driver.ts' });
        const violations = detectLayerViolations([core, cdp], [createConnection(cdp, core, { connection_type: 'imports' }), createConnection(core, cdp, { connection_type: 'imports' })]);
        expect(violations).toHaveLength(1);
        expect(violations[0].from.name).toBe('cdp/driver');
        expect(violations[0].to.name).toBe('core/types');
    });
    it('detects import cycles', () => {
        const a = createComponent({ name: 'core/a', type: 'component', file: 'src/core/a.ts' });
        const b = createComponent({ name: 'core/b', type: 'component', file: 'src/core/b.ts' });
        const c = createComponent({ name: 'core/c', type: 'component', file: 'src/core/c.ts' });
        const cycles = detectImportCycles([a, b, c], [
            createConnection(a, b, { connection_type: 'imports' }),
            createConnection(b, c, { connection_type: 'imports' }),
            createConnection(c, a, { connection_type: 'imports' }),
        ]);
        expect(cycles).toHaveLength(1);
        expect(cycles[0]).toEqual(['core/a', 'core/b', 'core/c', 'core/a']);
    });
});
//# sourceMappingURL=architecture-insights.test.js.map