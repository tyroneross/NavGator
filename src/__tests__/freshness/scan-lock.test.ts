import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { acquireLock, releaseLock, LOCK_TTL_MS } from '../../freshness/scan-lock.js';
import { scanLockPath } from '../../freshness/paths.js';

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'nv-lock-'));
  fs.mkdirSync(path.join(root, '.navgator'), { recursive: true });
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('scan lock', () => {
  it('acquires when free', () => {
    expect(acquireLock(root)).toBe(true);
  });

  it('refuses a second live acquire', () => {
    expect(acquireLock(root)).toBe(true);
    expect(acquireLock(root)).toBe(false);
  });

  it('release frees the lock', () => {
    expect(acquireLock(root)).toBe(true);
    releaseLock(root);
    expect(acquireLock(root)).toBe(true);
  });

  it('steals a stale lock (heartbeat older than TTL)', () => {
    const lock = { pid: 999999, heartbeat_at: Date.now() - LOCK_TTL_MS - 1000 };
    fs.writeFileSync(scanLockPath(root), JSON.stringify(lock));
    expect(acquireLock(root)).toBe(true);
  });

  it('steals a lock whose PID is dead even if heartbeat is recent', () => {
    // PID 999999 is overwhelmingly unlikely to exist.
    const lock = { pid: 999999, heartbeat_at: Date.now() };
    fs.writeFileSync(scanLockPath(root), JSON.stringify(lock));
    expect(acquireLock(root)).toBe(true);
  });
});
