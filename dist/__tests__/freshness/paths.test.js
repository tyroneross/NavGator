import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { navgatorBase, dirtyLedgerPath, scanLockPath, stampPath } from '../../freshness/paths.js';
describe('freshness paths', () => {
    const root = '/tmp/example-project';
    it('navgatorBase is <root>/.navgator in local mode', () => {
        expect(navgatorBase(root)).toBe(path.join(root, '.navgator'));
    });
    it('dirty ledger sits at the navgator base', () => {
        expect(dirtyLedgerPath(root)).toBe(path.join(root, '.navgator', 'dirty.json'));
    });
    it('scan lock sits at the navgator base', () => {
        expect(scanLockPath(root)).toBe(path.join(root, '.navgator', 'scan.lock'));
    });
    it('stamp sits inside architecture next to the graph', () => {
        expect(stampPath(root)).toBe(path.join(root, '.navgator', 'architecture', 'freshness.json'));
    });
});
//# sourceMappingURL=paths.test.js.map