import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  drain,
  drainUntilClean,
  reconcileClean,
  type DrainResult,
  type DrainScanLifecycle,
  type DrainScanOutcome,
} from '../../freshness/drainer.js';
import { markDirty, readDirty } from '../../freshness/dirty-ledger.js';
import { acquireScanLease } from '../../freshness/scan-lock.js';
import { scanLockPath } from '../../freshness/paths.js';
import { readStamp } from '../../freshness/stamp.js';

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'nv-drain-'));
  fs.mkdirSync(path.join(root, '.navgator', 'architecture'), { recursive: true });
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

const okScan = async (
  _root: string,
  _changed: string[],
  lifecycle: DrainScanLifecycle,
) => {
  await lifecycle.onLeaseAcquired();
  await lifecycle.beforeLeaseRelease();
  return { status: 'completed' as const };
};

describe('drainer', () => {
  it('drains the dirty set, scans once, clears, and writes a stamp', async () => {
    markDirty(['a.ts', 'b.ts'], root);
    let scans = 0;
    const res: DrainResult = await drain(root, {
      scanFn: async (_root, _changed, lifecycle) => {
        scans++;
        await lifecycle.onLeaseAcquired();
        await lifecycle.beforeLeaseRelease();
        return { status: 'completed' };
      },
      minIntervalMs: 0,
    });
    expect(res.status).toBe('drained');
    expect(scans).toBe(1);
    expect(readDirty(root)).toEqual([]);
    const stamp = readStamp(root);
    expect(stamp?.dirty_count).toBe(0);
    expect(stamp?.scan_in_flight).toBe(false);
  });

  it('with an empty dirty set refreshes the stamp without scanning', async () => {
    let scans = 0;
    const res = await drain(root, {
      scanFn: async () => {
        scans++;
        return { status: 'completed' };
      },
      minIntervalMs: 0,
    });
    expect(res.status).toBe('clean');
    expect(scans).toBe(0);
    expect(readStamp(root)).not.toBeNull();
  });

  it('does not publish clean when a mark arrives after the empty snapshot', async () => {
    let scans = 0;
    const res = await drain(root, {
      scanFn: async () => {
        scans += 1;
        return { status: 'completed' };
      },
      minIntervalMs: 0,
      _afterEmptySnapshot: () => markDirty(['late.ts'], root),
    });

    expect(res.status).toBe('debounced');
    expect(scans).toBe(0);
    expect(readDirty(root)).toEqual(['late.ts']);
    expect(readStamp(root)).toBeNull();
  });

  it('does not double-acquire and preserves dirty work when scan() returns busy', async () => {
    markDirty(['a.ts'], root);
    const held = acquireScanLease(scanLockPath(root), 'other', { startHeartbeat: false });
    expect(held.ok).toBe(true);
    if (!held.ok) throw new Error(held.message);
    let scans = 0;
    try {
      const res = await drain(root, {
        scanFn: async () => {
          scans += 1;
          return { status: 'busy', retryable: true, message: 'lease held' };
        },
        minIntervalMs: 0,
      });
      expect(scans).toBe(1); // scan() owns contention; drainer did not pre-acquire
      expect(res.status).toBe('busy');
      expect(res.error).toContain('lease held');
      expect(readDirty(root)).toEqual(['a.ts']);
      expect(readStamp(root)).toBeNull();
    } finally {
      held.lease.release();
    }
  });

  it('keeps late arrivals marked while only clearing what it drained', async () => {
    markDirty(['a.ts'], root);
    const scanFn = async (_root: string, _changed: string[], lifecycle: DrainScanLifecycle) => {
      await lifecycle.onLeaseAcquired();
      markDirty(['late.ts'], root);
      await lifecycle.beforeLeaseRelease();
      return { status: 'completed' as const };
    }; // arrives mid-scan
    const res = await drain(root, { scanFn, minIntervalMs: 0 });
    expect(res.status).toBe('drained');
    expect(readDirty(root)).toEqual(['late.ts']);
  });

  it('preserves a repeated late edit and reconciles while the scan lease is held', async () => {
    markDirty(['a.ts'], root);
    let contenderWasBusy = false;
    const scanFn = async (
      _root: string,
      _changed: string[],
      lifecycle: DrainScanLifecycle,
    ): Promise<DrainScanOutcome> => {
      const held = acquireScanLease(scanLockPath(root), 'drain-test', { startHeartbeat: false });
      expect(held.ok).toBe(true);
      if (!held.ok) throw new Error(held.message);
      try {
        await lifecycle.onLeaseAcquired();
        // Same path, new ledger inode: the late event must not be erased.
        markDirty(['a.ts'], root);
        const contender = acquireScanLease(scanLockPath(root), 'new-scan', {
          startHeartbeat: false,
        });
        contenderWasBusy = !contender.ok && contender.retryable;
        await lifecycle.beforeLeaseRelease();
      } finally {
        held.lease.release();
      }
      return { status: 'completed' };
    };

    const result = await drain(root, { scanFn, minIntervalMs: 0 });
    expect(result.status).toBe('drained');
    expect(contenderWasBusy).toBe(true);
    expect(readDirty(root)).toEqual(['a.ts']);
    expect(readStamp(root)?.scan_in_flight).toBe(false);
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

  it('treats an unknown/missing scan outcome as error and preserves dirty work', async () => {
    markDirty(['a.ts'], root);
    const res = await drain(root, {
      scanFn: async () => undefined as never,
      minIntervalMs: 0,
    });
    expect(res.status).toBe('error');
    expect(res.error).toContain('unknown outcome');
    expect(readDirty(root)).toEqual(['a.ts']);
  });

  it('keeps concurrent busy drainers safe without a stale in-flight stamp', async () => {
    markDirty(['a.ts'], root);
    const busyScan = async () => ({
      status: 'busy' as const,
      retryable: true as const,
      message: 'canonical lease held',
    });

    const results = await Promise.all([
      drain(root, { scanFn: busyScan, minIntervalMs: 0 }),
      drain(root, { scanFn: busyScan, minIntervalMs: 0 }),
    ]);

    expect(results.every((result) => result.status === 'busy')).toBe(true);
    expect(readDirty(root)).toEqual(['a.ts']);
    expect(readStamp(root)).toBeNull();
    const architectureDir = path.join(root, '.navgator', 'architecture');
    expect(fs.readdirSync(architectureDir).some((name) => name.includes('.tmp.'))).toBe(false);
  });

  it('does not resurrect in-flight after the winning drainer completed', async () => {
    markDirty(['a.ts'], root);
    let calls = 0;
    let winnerStarted!: () => void;
    let busyStarted!: () => void;
    let finishWinner!: () => void;
    let finishBusy!: () => void;
    const winnerReady = new Promise<void>((resolve) => { winnerStarted = resolve; });
    const busyReady = new Promise<void>((resolve) => { busyStarted = resolve; });
    const winnerGate = new Promise<void>((resolve) => { finishWinner = resolve; });
    const busyGate = new Promise<void>((resolve) => { finishBusy = resolve; });
    const scanFn = async (
      _root: string,
      _changed: string[],
      lifecycle: DrainScanLifecycle,
    ): Promise<DrainScanOutcome> => {
      calls += 1;
      if (calls === 1) {
        await lifecycle.onLeaseAcquired();
        winnerStarted();
        await winnerGate;
        await lifecycle.beforeLeaseRelease();
        return { status: 'completed' };
      }
      busyStarted();
      await busyGate;
      return { status: 'busy', retryable: true, message: 'winner held lease' };
    };

    const winner = drain(root, { scanFn, minIntervalMs: 0 });
    await winnerReady;
    const contender = drain(root, { scanFn, minIntervalMs: 0 });
    await busyReady;

    finishWinner();
    expect((await winner).status).toBe('drained');
    expect(readStamp(root)?.scan_in_flight).toBe(false);

    finishBusy();
    expect((await contender).status).toBe('busy');
    expect(readStamp(root)?.scan_in_flight).toBe(false);
    expect(readDirty(root)).toEqual([]);
  });
});

describe('drainUntilClean (trailing-edge guarantee)', () => {
  it('keeps draining until the ledger is empty, even with late arrivals', async () => {
    markDirty(['a.ts'], root);
    let calls = 0;
    const scanFn = async (
      _root: string,
      _changed: string[],
      lifecycle: DrainScanLifecycle,
    ) => {
      calls++;
      await lifecycle.onLeaseAcquired();
      if (calls === 1) markDirty(['late.ts'], root); // arrives during first scan
      await lifecycle.beforeLeaseRelease();
      return { status: 'completed' as const };
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
    expect(results[results.length - 1]!.status).toBe('error');
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
