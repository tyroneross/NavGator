/**
 * The background drainer. Coalesces the dirty set and runs one incremental scan
 * through scan()'s single-writer lease, then writes an honest stamp. Designed to be
 * invoked repeatedly and cheaply (by the hook, the orchestrator, or a timer):
 *  - busy      -> scan() could not acquire the shared lease; dirty work stays.
 *  - debounced -> a drain ran within minIntervalMs; skipped (dirty set kept).
 *  - clean     -> nothing dirty; stamp refreshed only.
 *  - drained   -> scanned, cleared the drained subset, stamp updated.
 *  - error     -> scan threw; dirty set left intact for a retry.
 */
import { captureDirtySnapshot, clearDirtySnapshot, readDirty, withDirtyLedgerMutationLock, } from './dirty-ledger.js';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { computeStamp, readStamp } from './stamp.js';
import { stampPath } from './paths.js';
export { captureDirtySnapshot } from './dirty-ledger.js';
/**
 * Stamp writes must remain safe now that multiple drainers may reach scan()
 * concurrently. The shared stamp writer uses a fixed `.tmp` path, so this
 * lane uses a unique same-directory candidate before the atomic rename.
 */
function writeDrainStamp(root, stamp) {
    const target = stampPath(root);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const candidate = `${target}.tmp.${process.pid}.${crypto.randomUUID()}`;
    try {
        fs.writeFileSync(candidate, JSON.stringify(stamp, null, 2), 'utf8');
        fs.renameSync(candidate, target);
    }
    finally {
        try {
            fs.unlinkSync(candidate);
        }
        catch { /* renamed or best effort */ }
    }
}
/**
 * Serialize drain-side reconciliation and recheck the canonical ledger before
 * publishing. A concurrent mark is an immutable event; freshness read
 * boundaries overlay that ledger even if its best-effort stamp refresh races
 * this publication or the marking process exits immediately afterward.
 */
function writeHonestDrainStamp(root, proposed, options = {}) {
    return withDirtyLedgerMutationLock(root, () => {
        const dirty = readDirty(root);
        if (options.requireClean && dirty.length > 0)
            return false;
        writeDrainStamp(root, {
            ...proposed,
            generated_at: dirty.length > 0
                ? options.dirtyGeneratedAt ?? proposed.generated_at
                : options.cleanGeneratedAt ?? proposed.generated_at,
            dirty_files: dirty,
            dirty_count: dirty.length,
        });
        return true;
    });
}
export async function drain(root, opts) {
    const minInterval = opts.minIntervalMs ?? 3000;
    // Debounce off the last stamp's generated_at (only when there IS prior state).
    const prior = readStamp(root);
    if (prior && Date.now() - prior.generated_at < minInterval) {
        return { status: 'debounced', scanned: 0 };
    }
    const dirtySnapshot = captureDirtySnapshot(root);
    const dirty = dirtySnapshot.paths;
    if (dirty.length === 0) {
        opts._afterEmptySnapshot?.();
        const proposed = await computeStamp(root, { inFlight: false });
        const published = writeHonestDrainStamp(root, proposed, { requireClean: true });
        return published
            ? { status: 'clean', scanned: 0 }
            : { status: 'debounced', scanned: 0 };
    }
    let outcome;
    let leaseAcquired = false;
    let reconciledBeforeRelease = false;
    let failureSettledBeforeRelease = false;
    const onLeaseAcquired = async () => {
        leaseAcquired = true;
        const proposed = await computeStamp(root, {
            inFlight: true,
            generatedAt: prior?.generated_at,
        });
        writeHonestDrainStamp(root, proposed, {
            dirtyGeneratedAt: prior?.generated_at,
        });
    };
    const beforeLeaseRelease = async () => {
        if (reconciledBeforeRelease)
            return;
        reconciledBeforeRelease = true;
        await reconcileClean(root, dirtySnapshot);
    };
    const onLeaseFailureBeforeRelease = async () => {
        if (failureSettledBeforeRelease)
            return;
        failureSettledBeforeRelease = true;
        const proposed = await computeStamp(root, {
            inFlight: false,
            generatedAt: prior?.generated_at,
        });
        writeHonestDrainStamp(root, proposed, {
            dirtyGeneratedAt: prior?.generated_at,
        });
    };
    try {
        outcome = await opts.scanFn(root, dirty, {
            onLeaseAcquired,
            beforeLeaseRelease,
            onLeaseFailureBeforeRelease,
        });
    }
    catch (e) {
        // Lifecycle cleanup must happen under the canonical lease. If the scanner
        // did not invoke it, leave any in-flight marker conservative for a retry.
        return { status: 'error', scanned: 0, error: e instanceof Error ? e.message : String(e) };
    }
    const outcomeStatus = outcome?.status;
    if (outcomeStatus !== 'completed' &&
        outcomeStatus !== 'noop' &&
        outcomeStatus !== 'busy') {
        const proposed = await computeStamp(root, {
            inFlight: false,
            generatedAt: prior?.generated_at,
        });
        writeHonestDrainStamp(root, proposed, {
            dirtyGeneratedAt: prior?.generated_at,
        });
        return { status: 'error', scanned: 0, error: 'scan returned an unknown outcome' };
    }
    if (outcome.status === 'busy') {
        // No lease-acquired callback means this attempt never wrote in-flight.
        if (leaseAcquired) {
            return { status: 'error', scanned: 0, error: 'busy returned after lease acquisition' };
        }
        return { status: 'busy', scanned: 0, error: outcome.message };
    }
    if (!leaseAcquired || !reconciledBeforeRelease) {
        // A completed scanner that skipped the lease-held callback is unsafe: it
        // may already have released, so post-hoc ledger clearing could erase late
        // work or race a new scan. Preserve everything and require a retry.
        return {
            status: 'error',
            scanned: 0,
            error: 'scan completed without lease-held freshness lifecycle',
        };
    }
    return { status: 'drained', scanned: dirty.length };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/**
 * Trailing-edge guarantee. A single `drain()` can leave the *final* edits of a
 * burst undrained (debounced) or skipped (busy). This loops past those states —
 * sleeping out the debounce window between tries — until the ledger is actually
 * empty, so the view self-heals within ~minIntervalMs of edits stopping instead
 * of waiting for the 5-minute autoRefresh backstop. The hook spawns this
 * detached, so the sleeps never block an edit. Returns every attempt's result.
 */
export async function drainUntilClean(root, opts) {
    const maxAttempts = opts.maxAttempts ?? 12;
    const baseWait = opts.waitMs ?? opts.minIntervalMs ?? 3000;
    const results = [];
    for (let i = 0; i < maxAttempts; i++) {
        const res = await drain(root, { scanFn: opts.scanFn, minIntervalMs: opts.minIntervalMs });
        results.push(res);
        const settled = res.status === 'drained' || res.status === 'clean';
        if (settled && readDirty(root).length === 0)
            break; // ledger truly empty → done
        if (res.status === 'error')
            break; // a scan that throws won't fix itself by retrying
        await sleep(res.status === 'busy' ? Math.min(1000, baseWait) : baseWait);
    }
    return results;
}
/**
 * Stamp coherence for scans that do not originate in the drainer. For example,
 * `autoRefreshIfStale` captures this snapshot, forces its paths into an auto-mode
 * scan, then reconciles before releasing the scan lease. Only the captured
 * immutable events are cleared; events arriving during the scan remain dirty.
 */
export async function reconcileClean(root, snapshot = captureDirtySnapshot(root)) {
    // Delete only immutable event filenames captured before the scan. Late
    // events, including repeated edits to the same path, have distinct names.
    clearDirtySnapshot(snapshot, root);
    const prior = readStamp(root);
    const completedAt = Date.now();
    const proposed = await computeStamp(root, {
        inFlight: false,
        generatedAt: completedAt,
    });
    writeHonestDrainStamp(root, proposed, {
        cleanGeneratedAt: completedAt,
        dirtyGeneratedAt: prior?.generated_at,
    });
}
//# sourceMappingURL=drainer.js.map