/**
 * Cross-process advisory lock for the project registry — web twin.
 *
 * This is a deliberate mirror of `src/registry-lock.ts`. Read that file for the
 * full rationale; the short version is that version-stamped compare-and-swap
 * alone cannot prevent lost updates. Two writers that start in the same tick
 * both read revision R before either saves, so both pass their own CAS check
 * and both write R+1 — one entry is lost, and neither writer sees a mismatch to
 * journal. Mutual exclusion is what actually closes that; CAS is the detector
 * for whatever slips past.
 *
 * The duplication is not incidental here, it is the requirement: the two
 * contending writers are the `navgator` CLI process and this Next.js server,
 * which compile separately and cannot import each other. A lock only one of
 * them takes provides no exclusion at all. So both sides must write the SAME
 * lock file with the SAME record shape and the SAME staleness rule — which is
 * exactly why the protocol is `open(path, 'wx')` plus a small JSON record, and
 * not `src/scan-lock.ts`'s hard-link publication protocol (unmirrorable in
 * practice) or its synchronous `Atomics.wait` retry (which would park the
 * Next.js server's thread and stall every concurrent request).
 *
 * Any change here must be made in `src/registry-lock.ts` too. The shared oracle
 * in `src/__tests__/registry-concurrency-oracle.test.ts` holds both copies to
 * one contract, the same arrangement `web/lib/server/atomic-write.ts` uses.
 *
 * Fail-open: if the lock cannot be acquired within the budget, the caller
 * proceeds unlocked and records that it did. A wedged lock must never be able
 * to stop the dashboard from registering a project.
 */

import * as fs from "fs/promises";
import * as path from "path";
import { randomBytes } from "crypto";

export const REGISTRY_LOCK_FILENAME = "projects.json.lock";

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
  let handle: Awaited<ReturnType<typeof fs.open>>;
  try {
    handle = await fs.open(lockPath, "wx");
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "EEXIST") return false;
    throw error;
  }
  try {
    await handle.writeFile(JSON.stringify(record), "utf-8");
  } catch (error) {
    // The file exists but has no record in it. Without this cleanup a transient
    // ENOSPC/EIO strands an EMPTY lock whose unparseable record forces every
    // other writer onto the mtime staleness path — blocking the registry for a
    // full LOCK_STALE_MS because of a disk hiccup, with a no-op release.
    await handle.close().catch(() => undefined);
    await fs.unlink(lockPath).catch(() => undefined);
    throw error;
  }
  await handle.close();
  return true;
}

/**
 * Remove the lock if its holder is long gone.
 *
 * Staleness is judged by the record's own timestamp, with mtime as the fallback
 * for a record that is missing or torn. PID liveness is deliberately not
 * consulted: PIDs are recycled and are meaningless if `~/.navgator` sits on a
 * network filesystem, whereas a timestamp is correct in both cases.
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
    const raw = await fs.readFile(lockPath, "utf-8");
    observed = raw;
    const record = JSON.parse(raw) as LockRecord;
    if (typeof record?.ts === "number" && Number.isFinite(record.ts)) {
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
      const stat = await fs.stat(lockPath);
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
    const confirm = await fs.readFile(lockPath, "utf-8");
    if (observed !== null && confirm !== observed) return;
  } catch {
    return; // Gone or unreadable now — nothing to remove.
  }

  await fs.unlink(lockPath).catch(() => undefined);
}

export interface AcquireOptions {
  timeoutMs?: number;
  staleMs?: number;
}

/**
 * Acquire the registry lock, or return `acquired: false` once the budget is
 * spent. Never throws for contention; a genuine filesystem failure is also
 * converted to `acquired: false` so a writer is never blocked by the lock's own
 * problems.
 */
export async function acquireRegistryLock(
  dir: string,
  options: AcquireOptions = {}
): Promise<RegistryLockHandle> {
  const timeoutMs = options.timeoutMs ?? LOCK_ACQUIRE_TIMEOUT_MS;
  const staleMs = options.staleMs ?? LOCK_STALE_MS;
  const lockPath = registryLockPath(dir);
  const token = randomBytes(8).toString("hex");
  // Monotonic. A backward wall-clock step (NTP correction, VM resume) would
  // otherwise stall `Date.now() - startedAt` below the budget and keep the loop
  // polling the filesystem for the length of the step.
  const startedAt = performance.now();
  const elapsed = () => performance.now() - startedAt;
  // Second, independent bound so the loop terminates even if the timer misbehaves.
  const maxIterations = Math.ceil(timeoutMs / POLL_MIN_MS) + 16;
  let iterations = 0;

  try {
    await fs.mkdir(dir, { recursive: true });
  } catch {
    return { acquired: false, waitedMs: 0, release: async () => undefined };
  }

  const release = async (): Promise<void> => {
    try {
      const raw = await fs.readFile(lockPath, "utf-8");
      const record = JSON.parse(raw) as LockRecord;
      // Owner-safe: if our lock was stolen after a stall, the file now belongs
      // to someone else and deleting it would release THEIR critical section.
      if (record?.token !== token) return;
      await fs.unlink(lockPath);
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
