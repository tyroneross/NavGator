import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as ts from 'typescript';
import {
  acquireScanLease,
  LOCK_TTL_MS,
  readScanLease,
  type ScanLease,
  type ScanLeaseRecord,
} from '../../freshness/scan-lock.js';
import { scanLockPath } from '../../freshness/paths.js';

let root: string;
let leases: ScanLease[];
let children: ChildProcess[];

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'nv-lock-'));
  fs.mkdirSync(path.join(root, '.navgator'), { recursive: true });
  leases = [];
  children = [];
});

afterEach(() => {
  vi.useRealTimers();
  for (const lease of leases) lease.release();
  for (const child of children) child.kill('SIGKILL');
  fs.rmSync(root, { recursive: true, force: true });
});

function acquire(options: Parameters<typeof acquireScanLease>[2] = {}): ScanLease {
  const result = acquireScanLease(scanLockPath(root), 'test', options);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.message);
  leases.push(result.lease);
  return result.lease;
}

function transpiledScanLockModule(targetRoot: string): string {
  const sourcePath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    'scan-lock.ts',
  );
  const modulePath = path.join(targetRoot, `scan-lock-under-test-${crypto.randomUUID()}.mjs`);
  const transpiled = ts.transpileModule(fs.readFileSync(sourcePath, 'utf-8'), {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  fs.writeFileSync(modulePath, transpiled);
  return modulePath;
}

describe('owner-safe scan lease', () => {
  it('uses the single canonical .navgator/scan.lock path', () => {
    const lease = acquire({ startHeartbeat: false });
    expect(lease.lockPath).toBe(path.join(root, '.navgator', 'scan.lock'));
    expect(fs.existsSync(lease.lockPath)).toBe(true);
    expect(readScanLease(lease.lockPath)?.token).toBe(lease.token);
    expect(readScanLease(lease.lockPath)?.owner_fingerprint).toBeTruthy();
    expect(fs.readdirSync(path.dirname(lease.lockPath))).toEqual(['scan.lock']);
  });

  it('uses O_EXCL semantics and refuses a second live owner', () => {
    acquire({ startHeartbeat: false });
    const second = acquireScanLease(scanLockPath(root), 'second', { startHeartbeat: false });
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.retryable).toBe(true);
      expect(second.message).toContain('Scan already in progress');
    }
  });

  it('distinguishes an operational publish failure from retryable contention', () => {
    const result = acquireScanLease(scanLockPath(root), 'test', {
      startHeartbeat: false,
      publishLease: () => {
        const error = new Error('hard links unavailable') as NodeJS.ErrnoException;
        error.code = 'EPERM';
        throw error;
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.retryable).toBe(false);
      expect(result.message).toContain('hard links unavailable');
    }
  });

  it('reports an operational dead-lease reclaim failure as nonretryable', () => {
    const lockPath = scanLockPath(root);
    const dead: ScanLeaseRecord = {
      version: 1,
      pid: Number.MAX_SAFE_INTEGER,
      token: 'dead-owner',
      started_at: Date.now() - LOCK_TTL_MS,
      heartbeat_at: Date.now() - LOCK_TTL_MS,
      scan_type: 'dead',
    };
    fs.writeFileSync(lockPath, JSON.stringify(dead));

    const result = acquireScanLease(lockPath, 'contender', {
      startHeartbeat: false,
      isPidAlive: () => false,
      reclaimUnlink: () => {
        const error = new Error('permission denied') as NodeJS.ErrnoException;
        error.code = 'EPERM';
        throw error;
      },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.retryable).toBe(false);
      expect(result.message).toContain('Could not reclaim scan lease');
      expect(result.message).toContain('permission denied');
    }
    expect(readScanLease(lockPath)?.token).toBe('dead-owner');
  });

  it('does not steal a fresh lock file before its owner finishes initialization', () => {
    const lockPath = scanLockPath(root);
    fs.writeFileSync(lockPath, '');
    const result = acquireScanLease(lockPath, 'contender', {
      ttlMs: 3000,
      startHeartbeat: false,
    });
    expect(result.ok).toBe(false);
    expect(fs.existsSync(lockPath)).toBe(true);
  });

  it('recovers an unreadable lock only after its stale grace period', () => {
    const lockPath = scanLockPath(root);
    fs.writeFileSync(lockPath, '{partial');
    const stale = new Date(Date.now() - 5000);
    fs.utimesSync(lockPath, stale, stale);
    const lease = acquire({ ttlMs: 3000, startHeartbeat: false });
    expect(lease.token).toBeTruthy();
  });

  it('refreshes heartbeat under fake time so a long scan remains live', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-09T19:00:00Z'));
    const lease = acquire({ ttlMs: 3000, heartbeatIntervalMs: 1000 });
    const before = readScanLease(lease.lockPath);
    vi.advanceTimersByTime(1000);
    const after = readScanLease(lease.lockPath);
    expect(after?.heartbeat_at).toBe((before?.heartbeat_at ?? 0) + 1000);
    expect(fs.readdirSync(path.dirname(lease.lockPath))).toEqual(['scan.lock']);

    const contender = acquireScanLease(lease.lockPath, 'contender', {
      ttlMs: 3000,
      startHeartbeat: false,
    });
    expect(contender.ok).toBe(false);
  });

  it('does not reclaim an expired heartbeat while its PID is still live', () => {
    const lockPath = scanLockPath(root);
    const staleAt = Date.now() - LOCK_TTL_MS - 1;
    const stale: ScanLeaseRecord = {
      version: 1,
      pid: process.pid,
      token: 'stale-owner',
      started_at: staleAt,
      heartbeat_at: staleAt,
      scan_type: 'full',
    };
    fs.writeFileSync(lockPath, JSON.stringify(stale));
    const result = acquireScanLease(lockPath, 'contender', { startHeartbeat: false });
    expect(result.ok).toBe(false);
    expect(readScanLease(lockPath)?.token).toBe('stale-owner');
  });

  it('recovers a valid lease after its owner PID is dead', () => {
    const lockPath = scanLockPath(root);
    const staleAt = Date.now() - LOCK_TTL_MS - 1;
    const stale: ScanLeaseRecord = {
      version: 1,
      pid: 12345,
      token: 'dead-owner',
      started_at: staleAt,
      heartbeat_at: staleAt,
      scan_type: 'full',
    };
    fs.writeFileSync(lockPath, JSON.stringify(stale));
    const lease = acquire({ startHeartbeat: false, isPidAlive: () => false });
    expect(lease.token).not.toBe('dead-owner');
  });

  it('recovers a live recycled PID when the process-start fingerprint changed', () => {
    const lockPath = scanLockPath(root);
    const stale: ScanLeaseRecord = {
      version: 1,
      pid: process.pid,
      token: 'prior-process',
      started_at: Date.now() - LOCK_TTL_MS,
      heartbeat_at: Date.now() - LOCK_TTL_MS,
      scan_type: 'full',
      owner_fingerprint: 'boot-a:start-old',
    };
    fs.writeFileSync(lockPath, JSON.stringify(stale));
    const lease = acquire({
      startHeartbeat: false,
      isPidAlive: () => true,
      getProcessFingerprint: () => 'boot-a:start-new',
      ownerFingerprint: 'boot-a:start-new',
    });
    expect(lease.token).not.toBe('prior-process');
  });

  it('release is token-safe and cannot remove a replacement owner', () => {
    const lease = acquire({ startHeartbeat: false });
    const replacement: ScanLeaseRecord = {
      version: 1,
      pid: process.pid,
      token: 'replacement-owner',
      started_at: Date.now(),
      heartbeat_at: Date.now(),
      scan_type: 'replacement',
    };
    fs.writeFileSync(lease.lockPath, JSON.stringify(replacement));
    lease.release();
    expect(readScanLease(lease.lockPath)?.token).toBe('replacement-owner');
  });

  it('keeps ownership and retries after a transient release unlink failure', async () => {
    let attempts = 0;
    const lease = acquire({
      heartbeatIntervalMs: 5,
      releaseRetryMs: 1,
      releaseUnlink: (lockPath) => {
        attempts += 1;
        if (attempts === 1) throw new Error('transient EPERM');
        fs.unlinkSync(lockPath);
      },
    });

    lease.release();
    expect(fs.existsSync(lease.lockPath)).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(attempts).toBeGreaterThanOrEqual(2);
    expect(fs.existsSync(lease.lockPath)).toBe(false);
  });

  it('observes a live lease held by another process', async () => {
    const lockPath = scanLockPath(root);
    const script = `
      const fs = require('node:fs');
      const path = require('node:path');
      const lockPath = process.argv[1];
      fs.mkdirSync(path.dirname(lockPath), { recursive: true });
      const now = Date.now();
      const fd = fs.openSync(lockPath, 'wx');
      fs.writeFileSync(fd, JSON.stringify({
        version: 1, pid: process.pid, token: 'child-owner',
        started_at: now, heartbeat_at: now, scan_type: 'child'
      }));
      fs.closeSync(fd);
      process.stdout.write('ready\\n');
      setInterval(() => {}, 1000);
    `;
    const child = spawn(process.execPath, ['-e', script, lockPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    children.push(child);
    await new Promise<void>((resolve, reject) => {
      child.stdout.once('data', () => resolve());
      child.once('error', reject);
      child.once('exit', (code) => {
        if (code !== null) reject(new Error(`lease child exited ${code}`));
      });
    });

    const result = acquireScanLease(lockPath, 'parent', { startHeartbeat: false });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain(`pid ${child.pid}`);
  });

  it('classifies every high-fanout gate handoff loser as retryable contention', async () => {
    const lockPath = scanLockPath(root);
    const held = acquire({ startHeartbeat: false });
    const modulePath = transpiledScanLockModule(root);
    const barrier = path.join(root, 'start-gate-fanout');
    const workerCount = 40;
    const runner = `
      import fs from 'node:fs';
      import { acquireScanLease } from ${JSON.stringify(pathToFileURL(modulePath).href)};
      const [lockPath, barrier] = process.argv.slice(1);
      while (!fs.existsSync(barrier)) {
        await new Promise((resolve) => setTimeout(resolve, 1));
      }
      const result = acquireScanLease(lockPath, 'fanout', {
        startHeartbeat: false,
        criticalSectionDelayMs: 2,
        gateWaitMs: 5000,
        gatePollMs: 1,
      });
      if (result.ok) result.lease.release();
      process.stdout.write(JSON.stringify(result.ok
        ? { ok: true }
        : { ok: false, retryable: result.retryable, message: result.message }) + '\\n');
    `;
    const pending = Array.from({ length: workerCount }, () => {
      const child = spawn(
        process.execPath,
        ['--input-type=module', '-e', runner, lockPath, barrier],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      );
      children.push(child);
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => { stdout += String(chunk); });
      child.stderr.on('data', (chunk) => { stderr += String(chunk); });
      return new Promise<{ ok: boolean; retryable?: boolean; message?: string }>((resolve, reject) => {
        child.once('error', reject);
        child.once('exit', (code) => {
          if (code !== 0) {
            reject(new Error(`fanout child exited ${code}: ${stderr}`));
            return;
          }
          resolve(JSON.parse(stdout.trim()) as {
            ok: boolean;
            retryable?: boolean;
            message?: string;
          });
        });
      });
    });
    fs.writeFileSync(barrier, 'go');
    const results = await Promise.all(pending);

    expect(
      results.filter((result) => result.ok || result.retryable !== true),
      JSON.stringify(results),
    ).toEqual([]);
    expect(results.every((result) => result.message?.includes('Scan already in progress'))).toBe(true);
    expect(readScanLease(lockPath)?.token).toBe(held.token);
  }, 20_000);

  it('allows exactly one winner when two processes reclaim the same dead lease', async () => {
    const lockPath = scanLockPath(root);
    const dead: ScanLeaseRecord = {
      version: 1,
      pid: Number.MAX_SAFE_INTEGER,
      token: 'dead-generation',
      started_at: Date.now() - LOCK_TTL_MS,
      heartbeat_at: Date.now() - LOCK_TTL_MS,
      scan_type: 'dead',
    };
    fs.writeFileSync(lockPath, JSON.stringify(dead));

    // Execute the current TypeScript source in independent Node processes.
    const modulePath = transpiledScanLockModule(root);

    const barrier = path.join(root, 'start-race');
    const runner = `
      import fs from 'node:fs';
      import { acquireScanLease } from ${JSON.stringify(pathToFileURL(modulePath).href)};
      const lockPath = process.argv[1];
      const barrier = process.argv[2];
      while (!fs.existsSync(barrier)) await new Promise((resolve) => setTimeout(resolve, 1));
      const result = acquireScanLease(lockPath, 'race', {
        startHeartbeat: false,
        criticalSectionDelayMs: 100,
        gateWaitMs: 2000,
        gatePollMs: 2,
      });
      if (!result.ok) {
        process.stdout.write(JSON.stringify(result) + '\\n');
        process.exit(0);
      }
      process.stdout.write(JSON.stringify({ ok: true, token: result.lease.token }) + '\\n');
      await new Promise((resolve) => setTimeout(resolve, 250));
      result.lease.release();
    `;
    const runChild = (): Promise<{ ok: boolean; retryable?: boolean; token?: string }> => {
      const child = spawn(
        process.execPath,
        ['--input-type=module', '-e', runner, lockPath, barrier],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      );
      children.push(child);
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => { stdout += String(chunk); });
      child.stderr.on('data', (chunk) => { stderr += String(chunk); });
      return new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('exit', (code) => {
          if (code !== 0) {
            reject(new Error(`race child exited ${code}: ${stderr}`));
            return;
          }
          resolve(JSON.parse(stdout.trim()) as { ok: boolean; retryable?: boolean; token?: string });
        });
      });
    };

    const first = runChild();
    const second = runChild();
    fs.writeFileSync(barrier, 'go');
    const results = await Promise.all([first, second]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(
      results.filter((result) => !result.ok && result.retryable),
      JSON.stringify(results),
    ).toHaveLength(1);
    expect(fs.existsSync(lockPath)).toBe(false);
    expect(fs.existsSync(`${lockPath}.acquire`)).toBe(false);
  }, 10_000);

  it('recovers an acquisition gate whose owner was killed', async () => {
    const lockPath = scanLockPath(root);
    const modulePath = transpiledScanLockModule(root);
    const runner = `
      import { acquireScanLease } from ${JSON.stringify(pathToFileURL(modulePath).href)};
      acquireScanLease(process.argv[1], 'killed-gate', {
        startHeartbeat: false,
        criticalSectionDelayMs: 10_000,
      });
    `;
    const child = spawn(
      process.execPath,
      ['--input-type=module', '-e', runner, lockPath],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    children.push(child);
    const gatePath = `${lockPath}.acquire`;
    const deadline = Date.now() + 3000;
    while (!fs.existsSync(gatePath) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(fs.existsSync(gatePath)).toBe(true);

    child.kill('SIGKILL');
    await new Promise<void>((resolve) => child.once('exit', () => resolve()));

    const recovered = acquireScanLease(lockPath, 'recovered', {
      startHeartbeat: false,
      gateWaitMs: 3000,
    });
    expect(recovered.ok).toBe(true);
    if (!recovered.ok) throw new Error(recovered.message);
    recovered.lease.release();
    expect(fs.existsSync(lockPath)).toBe(false);
    expect(fs.existsSync(gatePath)).toBe(false);
  }, 10_000);
});
