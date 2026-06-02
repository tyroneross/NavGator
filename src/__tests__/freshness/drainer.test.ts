import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { drain, type DrainResult } from '../../freshness/drainer.js';
import { markDirty, readDirty } from '../../freshness/dirty-ledger.js';
import { acquireLock } from '../../freshness/scan-lock.js';
import { readStamp } from '../../freshness/stamp.js';

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'nv-drain-'));
  fs.mkdirSync(path.join(root, '.navgator', 'architecture'), { recursive: true });
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

const okScan = async () => {};

describe('drainer', () => {
  it('drains the dirty set, scans once, clears, and writes a stamp', async () => {
    markDirty(['a.ts', 'b.ts'], root);
    let scans = 0;
    const res: DrainResult = await drain(root, { scanFn: async () => { scans++; }, minIntervalMs: 0 });
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
