/**
 * Scan concurrency lock (Run 1.6 — item #4).
 *
 * Prevents two `navgator scan` processes from corrupting each other's
 * .navgator/architecture/ output. Lock file at `<storeDir>/scan.lock`
 * with `{pid, started_at, scan_type}`.
 *
 * Stale lock (>10 min OR PID gone) → auto-cleared on entry.
 * Live lock → second scan exits cleanly with a message and returns
 * `{ ok: false, message }` so the caller can surface the message and
 * exit 0 (not crash).
 *
 * The release function MUST be called in a `finally` block so the lock
 * releases on error paths too.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

export const LOCK_FILENAME = 'scan.lock';
export const STALE_LOCK_MS = 10 * 60 * 1000; // 10 minutes

interface LockFileShape {
  pid: number;
  started_at: number;
  scan_type: string;
}

export type LockResult =
  | { ok: true; release: () => void }
  | { ok: false; message: string };

function isPidAlive(pid: number): boolean {
  try {
    // Signal 0 → no signal sent, just probe permission/existence.
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readLockFile(lockPath: string): LockFileShape | null {
  try {
    const raw = fs.readFileSync(lockPath, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<LockFileShape>;
    if (
      typeof parsed.pid !== 'number' ||
      typeof parsed.started_at !== 'number' ||
      typeof parsed.scan_type !== 'string'
    ) {
      return null;
    }
    return parsed as LockFileShape;
  } catch {
    return null;
  }
}

function unlinkSilently(lockPath: string): void {
  try {
    fs.unlinkSync(lockPath);
  } catch {
    // ENOENT is fine (already gone). Anything else is best-effort cleanup.
  }
}

/**
 * Try to acquire an exclusive scan lock.
 *
 * - On success: returns `{ ok: true, release }`. Caller MUST call `release()`
 *   in a `finally` block.
 * - On contention with a live, non-stale lock: returns `{ ok: false, message }`.
 *   The caller should surface the message and exit cleanly (code 0).
 *
 * Stale locks (older than `STALE_LOCK_MS` OR pid no longer alive) are
 * auto-cleared and the call falls through to acquisition.
 */
export function acquireLock(
  storeDir: string,
  scanType: string = 'unknown'
): LockResult {
  // Best-effort: ensure the directory exists. If this fails the lock fails too.
  try {
    fs.mkdirSync(storeDir, { recursive: true });
  } catch {
    // If mkdir fails the open call below will surface a clearer error.
  }

  const lockPath = path.join(storeDir, LOCK_FILENAME);
  const now = Date.now();

  // 1. Check for an existing lock and decide live-vs-stale.
  if (fs.existsSync(lockPath)) {
    const existing = readLockFile(lockPath);
    if (existing) {
      const age = now - existing.started_at;
      const stale = age >= STALE_LOCK_MS || !isPidAlive(existing.pid);
      if (!stale) {
        const ageS = Math.round(age / 1000);
        return {
          ok: false,
          message: `Scan already in progress (pid ${existing.pid}, started ${ageS}s ago)`,
        };
      }
      // Stale → fall through and clear.
    }
    // Either corrupt or stale → unlink and continue.
    unlinkSilently(lockPath);
  }

  // 2. Atomically create the lock with O_EXCL semantics. Race-safe.
  let fd: number;
  try {
    fd = fs.openSync(lockPath, 'wx');
  } catch (err: unknown) {
    // Another process won the race between our existsSync and openSync. Surface
    // a contention message rather than crashing.
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === 'EEXIST') {
      const existing = readLockFile(lockPath);
      const detail =
        existing != null
          ? `pid ${existing.pid}, started ${Math.round((now - existing.started_at) / 1000)}s ago`
          : 'unknown owner';
      return {
        ok: false,
        message: `Scan already in progress (${detail})`,
      };
    }
    // Other errors are unexpected — bubble up via a contention message so the
    // CLI exits cleanly instead of crashing the user's terminal.
    return {
      ok: false,
      message: `Could not acquire scan lock: ${(err as Error).message}`,
    };
  }

  const payload: LockFileShape = {
    pid: process.pid,
    started_at: now,
    scan_type: scanType,
  };

  try {
    fs.writeSync(fd, JSON.stringify(payload));
  } finally {
    try {
      fs.closeSync(fd);
    } catch {
      // best-effort
    }
  }

  let released = false;
  return {
    ok: true,
    release: () => {
      if (released) return;
      released = true;
      unlinkSilently(lockPath);
    },
  };
}
