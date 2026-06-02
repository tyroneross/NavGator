/**
 * The background drainer. Coalesces the dirty set and runs one incremental scan
 * under the single-writer lock, then writes an honest stamp. Designed to be
 * invoked repeatedly and cheaply (by the hook, the orchestrator, or a timer):
 *  - busy      -> another drainer holds the lock; caller should not wait.
 *  - debounced -> a drain ran within minIntervalMs; skipped (dirty set kept).
 *  - clean     -> nothing dirty; stamp refreshed only.
 *  - drained   -> scanned, cleared the drained subset, stamp updated.
 *  - error     -> scan threw; dirty set left intact for a retry.
 */
import { readDirty, clearDirty } from './dirty-ledger.js';
import { acquireLock, releaseLock } from './scan-lock.js';
import { computeStamp, writeStamp, readStamp } from './stamp.js';

export type DrainStatus = 'busy' | 'debounced' | 'clean' | 'drained' | 'error';

export interface DrainResult {
  status: DrainStatus;
  scanned: number; // count of dirty paths drained
  error?: string;
}

export interface DrainOptions {
  /** Injected scanner. Production passes a wrapper over NavGator `scan()`. */
  scanFn: (root: string, changed: string[]) => Promise<void>;
  /** Skip if the last stamp was generated within this window (default 3000ms). */
  minIntervalMs?: number;
}

export async function drain(root: string, opts: DrainOptions): Promise<DrainResult> {
  const minInterval = opts.minIntervalMs ?? 3000;

  // Debounce off the last stamp's generated_at (only when there IS prior state).
  const prior = readStamp(root);
  if (prior && Date.now() - prior.generated_at < minInterval) {
    return { status: 'debounced', scanned: 0 };
  }

  if (!acquireLock(root)) {
    return { status: 'busy', scanned: 0 };
  }

  try {
    const dirty = readDirty(root);

    if (dirty.length === 0) {
      writeStamp(root, await computeStamp(root, { inFlight: false }));
      return { status: 'clean', scanned: 0 };
    }

    // Mark in-flight so concurrent readers see the truth during the scan.
    writeStamp(root, await computeStamp(root, { inFlight: true }));

    try {
      await opts.scanFn(root, dirty);
    } catch (e) {
      // Leave the dirty set intact; clear the in-flight flag honestly.
      writeStamp(root, await computeStamp(root, { inFlight: false }));
      return { status: 'error', scanned: 0, error: e instanceof Error ? e.message : String(e) };
    }

    const completedAt = Date.now();
    clearDirty(dirty, root); // clears only what we drained; late arrivals remain
    writeStamp(root, await computeStamp(root, { inFlight: false, generatedAt: completedAt }));
    return { status: 'drained', scanned: dirty.length };
  } finally {
    releaseLock(root);
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export interface DrainUntilCleanOptions extends DrainOptions {
  /** Max drain attempts before giving up (default 12). Bounds worst-case time. */
  maxAttempts?: number;
  /** Override the post-attempt wait; defaults to minIntervalMs (busy waits less). */
  waitMs?: number;
}

/**
 * Trailing-edge guarantee. A single `drain()` can leave the *final* edits of a
 * burst undrained (debounced) or skipped (busy). This loops past those states —
 * sleeping out the debounce window between tries — until the ledger is actually
 * empty, so the view self-heals within ~minIntervalMs of edits stopping instead
 * of waiting for the 5-minute autoRefresh backstop. The hook spawns this
 * detached, so the sleeps never block an edit. Returns every attempt's result.
 */
export async function drainUntilClean(
  root: string,
  opts: DrainUntilCleanOptions,
): Promise<DrainResult[]> {
  const maxAttempts = opts.maxAttempts ?? 12;
  const baseWait = opts.waitMs ?? opts.minIntervalMs ?? 3000;
  const results: DrainResult[] = [];
  for (let i = 0; i < maxAttempts; i++) {
    const res = await drain(root, { scanFn: opts.scanFn, minIntervalMs: opts.minIntervalMs });
    results.push(res);
    const settled = res.status === 'drained' || res.status === 'clean';
    if (settled && readDirty(root).length === 0) break; // ledger truly empty → done
    if (res.status === 'error') break; // a scan that throws won't fix itself by retrying
    await sleep(res.status === 'busy' ? Math.min(1000, baseWait) : baseWait);
  }
  return results;
}

/**
 * Stamp coherence for out-of-band scans. NavGator's existing `autoRefreshIfStale`
 * backstop runs an incremental scan WITHOUT going through the drainer, which
 * would leave the dirty ledger and stamp stale — making the stamp lie (report
 * dirty when the graph is actually current). Call this after any such scan to
 * reconcile: the incremental scan already covered every changed file via hashes,
 * so the whole ledger is safely cleared and a clean stamp written. Best-effort.
 */
export async function reconcileClean(root: string): Promise<void> {
  const all = readDirty(root);
  if (all.length > 0) clearDirty(all, root);
  writeStamp(root, await computeStamp(root, { inFlight: false }));
}
