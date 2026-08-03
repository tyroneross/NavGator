/**
 * Cross-process advisory lock for the project registry.
 *
 * ## Why a lock at all
 *
 * Version-stamped compare-and-swap alone does NOT prevent lost updates. Two
 * writers that start in the same tick both read revision R before either
 * saves, so both pass their own CAS check and both write R+1 — one entry is
 * lost, and neither writer ever sees a mismatch to journal. CAS catches the
 * unlucky interleaving; it is blind to the lockstep one, which is the common
 * case when a dashboard request and a CLI scan land together. Mutual exclusion
 * is what actually closes it. CAS stays on top as the detector for anything
 * that slips past (a writer that ignored the lock, a stale steal, a filesystem
 * that does not honour O_EXCL).
 *
 * ## Why not `acquireScanLease` (src/scan-lock.ts)
 *
 * NavGator already ships a hardened cross-process lease, reused for a non-scan
 * path by `withDirtyLedgerMutationLock` (src/freshness/dirty-ledger.ts). It is
 * the right primitive for scans and the wrong one here, for two checkable
 * reasons:
 *
 * 1. **Both writers must share one protocol or the lock is worthless.** The
 *    second registry writer is the Next.js dashboard, which compiles as a
 *    separate unit with its own node_modules and cannot import `src/`. A lock
 *    only one of the two contending processes takes provides no exclusion at
 *    all. So the protocol has to be simple enough to mirror byte-for-byte —
 *    `open(path, 'wx')` plus a JSON record is; scan-lock's O_EXCL-candidate +
 *    hard-link publication + generation-tokened recovery election is not.
 * 2. **`acquireScanLease` is synchronous, and its retry helper blocks.**
 *    `withDirtyLedgerMutationLock` spins on `Atomics.wait` (dirty-ledger.ts:126),
 *    which parks the whole thread. In the CLI that is merely rude; inside the
 *    Next.js server it would stall every concurrent request for the duration of
 *    the wait. Registry writes need an async acquire.
 *
 * This is deliberately NOT a third general-purpose lock: it is scoped to one
 * file, is not exported beyond the registry modules, and holds its critical
 * section for a single load-mutate-save — measured at ~8-9 ms on a real
 * 1434-entry / ~500 KB registry, both uncontended and under 12-way contention.
 * A contended write can run up to MAX_CAS_ATTEMPTS cycles inside that section,
 * so treat the figure as the common case, not a ceiling.
 *
 * ## Deadlock safety
 *
 * The registry lock is a leaf. `scan()` acquires the scan lease on
 * `<project-root>/.navgator/scan.lock` and then calls `registerProject`, which
 * takes this lock on `~/.navgator/projects.json.lock` — a different resource in
 * a different directory. Nothing acquires a scan lease while holding the
 * registry lock, so there is no lock-ordering cycle.
 *
 * ## Failure policy
 *
 * Fail-open. If the lock cannot be acquired within the budget, the caller
 * proceeds unlocked and records that it did. A registry write is non-critical
 * to the scan that triggered it, and a wedged lock must never be able to stop
 * NavGator from working. The residual race is then caught by CAS and journaled.
 *
 * Mirrored at `web/lib/server/registry-lock.ts`; both write the SAME lock file
 * with the SAME record shape, which is the entire point. The shared oracle in
 * `src/__tests__/registry-concurrency-oracle.test.ts` holds them to it.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

export const REGISTRY_LOCK_FILENAME = 'projects.json.lock';

/**
 * A lock older than this is treated as abandoned.
 *
 * MUST stay below LOCK_ACQUIRE_TIMEOUT_MS. With the reverse ordering an
 * orphaned lock is unreclaimable within a single acquire: the acquirer spends
 * its whole budget polling a lock that has not yet aged out, gives up, and
 * proceeds unlocked. Measured with the original 10s/2s pair, a lock orphaned 3s
 * earlier returned `acquired: false` after 2008 ms, and EVERY writer in EVERY
 * process ran unprotected for the remaining 7s — disabling the one mechanism
 * that prevents cross-process loss, on top of a 2s stall each.
 *
 * 3 s is still ~375x the measured critical section (~8 ms under 12-way
 * contention on a 1434-entry registry), so a responsive holder is not stolen
 * from. A holder stalled longer than this — a long GC pause, a suspended
 * laptop, a hung network mount — CAN be stolen from: there is no heartbeat.
 * That overlap is caught by the revision compare-and-swap and journaled as a
 * conflict, which is why the CAS layer exists underneath this one.
 */
export const LOCK_STALE_MS = 3_000;

/**
 * Total acquire budget before giving up and proceeding unlocked. Deliberately
 * longer than LOCK_STALE_MS so one acquire can always outlast an orphan.
 */
export const LOCK_ACQUIRE_TIMEOUT_MS = 5_000;

/**
 * How far a lock record's self-reported timestamp may lead the local clock
 * before we stop believing it. Container/VM clock skew produces a modest lead
 * with no malice involved; anything past this is not a usable age.
 */
const CLOCK_SKEW_TOLERANCE_MS = 60_000;

const POLL_MIN_MS = 2;
const POLL_MAX_MS = 12;

interface LockRecord {
  pid: number;
  token: string;
  ts: number;
}

export interface RegistryLockHandle {
  /** False when the budget expired and the caller is proceeding unlocked. */
  acquired: boolean;
  /** Milliseconds spent waiting. */
  waitedMs: number;
  /** Idempotent, owner-safe: removes the file only if this holder still owns it. */
  release: () => Promise<void>;
}

export function registryLockPath(dir: string): string {
  return path.join(dir, REGISTRY_LOCK_FILENAME);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Jittered backoff so N contending writers do not retry in lockstep. */
function pollDelay(): number {
  return POLL_MIN_MS + Math.floor(Math.random() * (POLL_MAX_MS - POLL_MIN_MS));
}

/**
 * Exclusive create. `wx` is O_CREAT|O_EXCL, atomic on POSIX: exactly one
 * concurrent caller can succeed.
 */
async function tryCreate(lockPath: string, record: LockRecord): Promise<boolean> {
  let handle: fs.promises.FileHandle;
  try {
    handle = await fs.promises.open(lockPath, 'wx');
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'EEXIST') return false;
    throw error;
  }
  try {
    await handle.writeFile(JSON.stringify(record), 'utf-8');
  } catch (error) {
    // The file exists but has no record in it. Without this cleanup a transient
    // ENOSPC/EIO strands an EMPTY lock whose unparseable record forces every
    // other writer onto the mtime staleness path — blocking the registry for a
    // full LOCK_STALE_MS because of a disk hiccup, with a no-op release.
    await handle.close().catch(() => undefined);
    await fs.promises.unlink(lockPath).catch(() => undefined);
    throw error;
  }
  await handle.close();
  return true;
}

/**
 * Remove the lock if its holder is long gone.
 *
 * Staleness is judged by the record's own timestamp, with mtime as the fallback
 * for a record that is missing or torn (a process killed between create and
 * write). PID liveness is deliberately not consulted: PIDs are recycled and are
 * meaningless if `~/.navgator` is on a network filesystem, whereas a timestamp
 * is correct in both cases.
 *
 * The steal re-reads the record immediately before unlinking and proceeds only
 * if it is byte-identical to the one it judged. Without that check the unlink
 * can land AFTER a third process has already stolen and taken a fresh lock,
 * destroying a live holder's lock — the `wx` create arbitrates who acquires
 * next, but it does not protect the file from a late unlink, so "only one can
 * win the create" is the wrong argument for this being safe.
 *
 * The re-read narrows the window to the microseconds between two adjacent
 * reads; it does not close it. POSIX has no atomic compare-and-delete. The
 * residue is covered one layer down: if two writers do end up overlapping, the
 * revision compare-and-swap detects it and journals a conflict rather than
 * losing an entry.
 */
async function stealIfStale(lockPath: string, staleMs: number): Promise<void> {
  let age: number | null = null;
  let observed: string | null = null;
  try {
    const raw = await fs.promises.readFile(lockPath, 'utf-8');
    observed = raw;
    const record = JSON.parse(raw) as LockRecord;
    if (typeof record?.ts === 'number' && Number.isFinite(record.ts)) {
      // A future-dated ts can NEVER age out, so a single skewed or bogus record
      // would wedge every writer onto the fail-open unlocked path permanently —
      // nothing would ever clear it. Past the skew tolerance, stop trusting the
      // self-reported value and let mtime (the OS's clock) decide.
      age =
        record.ts > Date.now() + CLOCK_SKEW_TOLERANCE_MS ? null : Date.now() - record.ts;
    }
  } catch {
    // Unreadable or unparseable — fall through to mtime.
  }

  if (age === null) {
    try {
      const stat = await fs.promises.stat(lockPath);
      // A future-dated mtime is unusable for the same reason. A lock whose age
      // cannot be established at all is treated as stale rather than allowed to
      // block forever: anyone able to plant one could corrupt the registry
      // directly, so refusing to age it buys nothing and costs availability.
      age =
        stat.mtimeMs > Date.now() + CLOCK_SKEW_TOLERANCE_MS
          ? staleMs + 1
          : Date.now() - stat.mtimeMs;
    } catch {
      return; // Already gone; the next create attempt will win it.
    }
  }

  if (age <= staleMs) return;

  // Re-read and confirm this is still the same abandoned record before removing
  // it, so a lock created after our staleness read is not destroyed.
  try {
    const confirm = await fs.promises.readFile(lockPath, 'utf-8');
    if (observed !== null && confirm !== observed) return;
  } catch {
    return; // Gone or unreadable now — nothing to remove.
  }

  await fs.promises.unlink(lockPath).catch(() => undefined);
}

export interface AcquireOptions {
  timeoutMs?: number;
  staleMs?: number;
}

/**
 * Acquire the registry lock, or return `acquired: false` once the budget is
 * spent. Never throws: contention returns `acquired: false`, and so does a
 * genuine filesystem failure, so a writer is never blocked by the lock's own
 * problems.
 */
export async function acquireRegistryLock(
  dir: string,
  options: AcquireOptions = {}
): Promise<RegistryLockHandle> {
  const timeoutMs = options.timeoutMs ?? LOCK_ACQUIRE_TIMEOUT_MS;
  const staleMs = options.staleMs ?? LOCK_STALE_MS;
  const lockPath = registryLockPath(dir);
  const token = crypto.randomBytes(8).toString('hex');
  // Monotonic. A backward wall-clock step (NTP correction, VM resume) would
  // otherwise stall `Date.now() - startedAt` below the budget and keep the loop
  // polling the filesystem for the length of the step.
  const startedAt = performance.now();
  const elapsed = () => performance.now() - startedAt;
  // Second, independent bound so the loop terminates even if the timer misbehaves.
  const maxIterations = Math.ceil(timeoutMs / POLL_MIN_MS) + 16;
  let iterations = 0;

  try {
    await fs.promises.mkdir(dir, { recursive: true });
  } catch {
    return { acquired: false, waitedMs: 0, release: async () => undefined };
  }

  const release = async (): Promise<void> => {
    try {
      const raw = await fs.promises.readFile(lockPath, 'utf-8');
      const record = JSON.parse(raw) as LockRecord;
      // Owner-safe: if our lock was stolen after a stall, the file now belongs
      // to someone else and deleting it would release THEIR critical section.
      if (record?.token !== token) return;
      await fs.promises.unlink(lockPath);
    } catch {
      // Already released, stolen, or unreadable — nothing owed.
    }
  };

  for (; iterations < maxIterations; iterations++) {
    try {
      if (await tryCreate(lockPath, { pid: process.pid, token, ts: Date.now() })) {
        return { acquired: true, waitedMs: Math.round(elapsed()), release };
      }
    } catch {
      // A filesystem that refuses O_EXCL, a permission change, a read-only
      // mount. Proceed unlocked rather than failing the registry write.
      return { acquired: false, waitedMs: Math.round(elapsed()), release: async () => undefined };
    }

    if (elapsed() >= timeoutMs) break;

    await stealIfStale(lockPath, staleMs);
    await sleep(pollDelay());
  }

  // Budget spent. Fail open: the caller proceeds unlocked and records that it
  // did, rather than a wedged lock being able to stop a registry write.
  return { acquired: false, waitedMs: Math.round(elapsed()), release: async () => undefined };
}

/**
 * Run `fn` under the registry lock. `fn` receives whether the lock was actually
 * held, so a caller can record an unlocked write rather than pretend it was
 * serialized. Always releases, including on throw.
 */
export async function withRegistryFileLock<T>(
  dir: string,
  fn: (acquired: boolean) => Promise<T>,
  options: AcquireOptions = {}
): Promise<T> {
  const lock = await acquireRegistryLock(dir, options);
  try {
    return await fn(lock.acquired);
  } finally {
    await lock.release();
  }
}
