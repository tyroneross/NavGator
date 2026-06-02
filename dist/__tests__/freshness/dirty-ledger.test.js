import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { markDirty, readDirty, clearDirty } from '../../freshness/dirty-ledger.js';
let root;
beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'nv-dirty-'));
    fs.mkdirSync(path.join(root, '.navgator'), { recursive: true });
});
afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
});
describe('dirty ledger', () => {
    it('starts empty', () => {
        expect(readDirty(root)).toEqual([]);
    });
    it('marks and reads paths, deduped and sorted', () => {
        markDirty(['b.ts', 'a.ts', 'b.ts'], root);
        expect(readDirty(root)).toEqual(['a.ts', 'b.ts']);
    });
    it('accumulates across calls', () => {
        markDirty(['a.ts'], root);
        markDirty(['c.ts'], root);
        expect(readDirty(root)).toEqual(['a.ts', 'c.ts']);
    });
    it('clears only the drained subset, leaving late arrivals', () => {
        markDirty(['a.ts', 'b.ts', 'c.ts'], root);
        clearDirty(['a.ts', 'b.ts'], root);
        expect(readDirty(root)).toEqual(['c.ts']);
    });
    it('tolerates a corrupt ledger by resetting to empty', () => {
        fs.writeFileSync(path.join(root, '.navgator', 'dirty.json'), '{not json');
        expect(readDirty(root)).toEqual([]);
        markDirty(['a.ts'], root);
        expect(readDirty(root)).toEqual(['a.ts']);
    });
});
//# sourceMappingURL=dirty-ledger.test.js.map