import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runMarkDirty, runFreshness } from '../../cli/commands/freshness.js';
import { readDirty } from '../../freshness/dirty-ledger.js';
let root;
beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'nv-cli-'));
    fs.mkdirSync(path.join(root, '.navgator', 'architecture'), { recursive: true });
});
afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
});
describe('freshness CLI helpers', () => {
    it('runMarkDirty appends to the ledger', () => {
        runMarkDirty(['src/a.ts'], root);
        expect(readDirty(root)).toEqual(['src/a.ts']);
    });
    it('runFreshness returns a stamp-shaped object even before any drain', async () => {
        const out = await runFreshness(root);
        expect(out).toHaveProperty('dirty_count');
        expect(out).toHaveProperty('scan_in_flight');
    });
});
//# sourceMappingURL=cli-freshness.test.js.map