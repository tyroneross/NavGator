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
