import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { drain, drainUntilClean, reconcileClean } from '../../freshness/drainer.js';
import { markDirty, readDirty } from '../../freshness/dirty-ledger.js';
import { acquireLock } from '../../freshness/scan-lock.js';
import { readStamp } from '../../freshness/stamp.js';
let root;
beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'nv-drain-'));
    fs.mkdirSync(path.join(root, '.navgator', 'architecture'), { recursive: true });
});
afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
});
const okScan = async () => { };
describe('drainer', () => {
    it('drains the dirty set, scans once, clears, and writes a stamp', async () => {
        markDirty(['a.ts', 'b.ts'], root);
        let scans = 0;
        const res = await drain(root, { scanFn: async () => { scans++; }, minIntervalMs: 0 });
        expect(res.status).toBe('drained');
        expect(scans).toBe(1);
        expect(readDirty(root)).toEqual([]);
        const stamp = readStamp(root);
        expect(stamp?.dirty_count).toBe(0);
        expect(stamp?.scan_in_flight).toBe(false);
    });
    it('with an empty dirty set refreshes the stamp without scanning', async () => {
        let scans = 0;
        const res = await drain(root, { scanFn: async () => { scans++; }, minIntervalMs: 0 });
        expect(res.status).toBe('clean');
        expect(scans).toBe(0);
        expect(readStamp(root)).not.toBeNull();
    });
    it('returns busy when the lock is already held', async () => {
        markDirty(['a.ts'], root);
        acquireLock(root); // simulate another drainer
        const res = await drain(root, { scanFn: okScan, minIntervalMs: 0 });
        expect(res.status).toBe('busy');
        expect(readDirty(root)).toEqual(['a.ts']); // untouched
    });
    it('keeps late arrivals marked while only clearing what it drained', async () => {
        markDirty(['a.ts'], root);
        const scanFn = async () => { markDirty(['late.ts'], root); }; // arrives mid-scan
        const res = await drain(root, { scanFn, minIntervalMs: 0 });
        expect(res.status).toBe('drained');
        expect(readDirty(root)).toEqual(['late.ts']);
    });
    it('debounces: a second drain within minIntervalMs is skipped', async () => {
        markDirty(['a.ts'], root);
        await drain(root, { scanFn: okScan, minIntervalMs: 0 });
        markDirty(['b.ts'], root);
        const res = await drain(root, { scanFn: okScan, minIntervalMs: 60_000 });
        expect(res.status).toBe('debounced');
        expect(readDirty(root)).toEqual(['b.ts']); // preserved for next drain
    });
    it('on scan failure leaves the dirty set intact and reports error', async () => {
        markDirty(['a.ts'], root);
        const res = await drain(root, { scanFn: async () => { throw new Error('boom'); }, minIntervalMs: 0 });
        expect(res.status).toBe('error');
        expect(readDirty(root)).toEqual(['a.ts']);
    });
});
describe('drainUntilClean (trailing-edge guarantee)', () => {
    it('keeps draining until the ledger is empty, even with late arrivals', async () => {
        markDirty(['a.ts'], root);
        let calls = 0;
        const scanFn = async () => {
            calls++;
            if (calls === 1)
                markDirty(['late.ts'], root); // arrives during first scan
        };
        const results = await drainUntilClean(root, { scanFn, minIntervalMs: 0, waitMs: 0 });
        expect(readDirty(root)).toEqual([]); // self-healed
        expect(results.length).toBeGreaterThanOrEqual(2); // needed a second pass for late.ts
        expect(results.every((r) => r.status !== 'error')).toBe(true);
    });
    it('stops early on a scan error rather than looping', async () => {
        markDirty(['a.ts'], root);
        const results = await drainUntilClean(root, {
            scanFn: async () => { throw new Error('boom'); },
            minIntervalMs: 0,
            waitMs: 0,
            maxAttempts: 5,
        });
        expect(results[results.length - 1].status).toBe('error');
        expect(results.length).toBe(1);
        expect(readDirty(root)).toEqual(['a.ts']);
    });
});
describe('reconcileClean (stamp coherence for out-of-band scans)', () => {
    it('clears the ledger and writes a clean stamp', async () => {
        markDirty(['a.ts', 'b.ts'], root);
        await reconcileClean(root);
        expect(readDirty(root)).toEqual([]);
        const stamp = readStamp(root);
        expect(stamp?.dirty_count).toBe(0);
        expect(stamp?.scan_in_flight).toBe(false);
    });
});
//# sourceMappingURL=drainer.test.js.map