/**
 * Single-writer scan lock. Under the parallel rally fleet many hooks fire at
 * once; only one drainer may scan at a time or the graph/ledger corrupts. The
 * lock is a JSON file holding the owner PID + a heartbeat. A lock is considered
 * stealable when its heartbeat is older than LOCK_TTL_MS OR its PID is dead, so
 * a crashed drainer never wedges the system.
 */
import * as fs from 'fs';
import * as path from 'path';
import { scanLockPath } from './paths.js';

export const LOCK_TTL_MS = 60_000;

interface Lock {
  pid: number;
  heartbeat_at: number;
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0); // signal 0 = existence check, doesn't kill
    return true;
  } catch {
    return false;
  }
}

function readLock(p: string): Lock | null {
  try {
    const l = JSON.parse(fs.readFileSync(p, 'utf8')) as Lock;
    if (typeof l?.pid === 'number' && typeof l?.heartbeat_at === 'number') return l;
  } catch {
    /* missing/corrupt -> treat as free */
  }
  return null;
}

/** Try to take the lock. Returns true on success, false if a live lock exists. */
export function acquireLock(root: string): boolean {
  const p = scanLockPath(root);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const existing = readLock(p);
  if (existing) {
    const fresh = Date.now() - existing.heartbeat_at < LOCK_TTL_MS;
    if (fresh && pidAlive(existing.pid)) return false; // genuinely held
    // else: stale or dead owner -> steal
  }
  fs.writeFileSync(p, JSON.stringify({ pid: process.pid, heartbeat_at: Date.now() } as Lock));
  return true;
}

/** Refresh the heartbeat mid-scan (call periodically for long scans). */
export function touchLock(root: string): void {
  try {
    fs.writeFileSync(
      scanLockPath(root),
      JSON.stringify({ pid: process.pid, heartbeat_at: Date.now() } as Lock),
    );
  } catch {
    /* best effort */
  }
}

/** Release the lock if we own it. */
export function releaseLock(root: string): void {
  const p = scanLockPath(root);
  const existing = readLock(p);
  if (existing && existing.pid === process.pid) {
    try {
      fs.rmSync(p, { force: true });
    } catch {
      /* best effort */
    }
  }
}
