import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { writeStamp, readStamp } from '../../freshness/stamp.js';
let root;
beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'nv-stamp-'));
    fs.mkdirSync(path.join(root, '.navgator', 'architecture'), { recursive: true });
});
afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
});
describe('freshness stamp', () => {
    it('round-trips a stamp', () => {
        const stamp = {
            version: 1,
            generated_at: 123,
            commit_sha: 'abc1234',
            branch: 'main',
            dirty_files: ['x.ts'],
            dirty_count: 1,
            scan_in_flight: false,
        };
        writeStamp(root, stamp);
        expect(readStamp(root)).toEqual(stamp);
    });
    it('returns null when absent', () => {
        expect(readStamp(root)).toBeNull();
    });
    it('returns null on corrupt stamp rather than throwing', () => {
        fs.writeFileSync(path.join(root, '.navgator', 'architecture', 'freshness.json'), 'nope');
        expect(readStamp(root)).toBeNull();
    });
});
//# sourceMappingURL=stamp.test.js.map