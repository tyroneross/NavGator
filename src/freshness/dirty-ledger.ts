/**
 * Concurrency-safe dirty ledger.
 *
 * Every mutation is an immutable, uniquely named event under `dirty.d/`.
 * A scan captures exact event filenames and clears only those files after it
 * finishes. Late writes — including another edit to the same path — land in a
 * different event and therefore cannot be erased by snapshot reconciliation.
 * `dirty.json` remains a read/migrate compatibility surface for older installs.
 */
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { acquireScanLease } from '../scan-lock.js';
import {
  dirtyEventsPath,
  dirtyLedgerPath,
  dirtyMutationLockPath,
  stampPath,
} from './paths.js';

interface DirtyEvent {
  version: 2;
  paths: string[];
  created_at: number;
}

interface LegacyDirtyFile {
  version: 1;
  paths: string[];
  updated_at: number;
}

export interface DirtyEventSnapshot {
  file: string;
  paths: string[];
}

export interface DirtyLedgerSnapshot {
  paths: string[];
  events: DirtyEventSnapshot[];
  legacyFingerprint?: string;
  legacyPaths: string[];
}

export interface DirtyLedgerTestHooks {
  afterEventList?: () => void;
  afterLegacyRead?: () => void;
  beforeSnapshotDelete?: () => void;
  beforeStampRename?: () => void;
}

function normalizedPaths(paths: string[]): string[] {
  return [...new Set(paths.map((value) => value.trim()).filter(Boolean))].sort();
}

function readEvent(filePath: string): DirtyEvent | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Partial<DirtyEvent>;
    if (parsed.version === 2 && Array.isArray(parsed.paths)) {
      return {
        version: 2,
        paths: normalizedPaths(parsed.paths),
        created_at: typeof parsed.created_at === 'number' ? parsed.created_at : 0,
      };
    }
  } catch {
    // A corrupt event is ignored; it never causes valid sibling events to reset.
  }
  return null;
}

function writeEvent(paths: string[], root: string): void {
  const values = normalizedPaths(paths);
  if (values.length === 0) return;
  const dir = dirtyEventsPath(root);
  fs.mkdirSync(dir, { recursive: true });
  const id = `${Date.now()}-${process.pid}-${crypto.randomUUID()}`;
  const candidate = path.join(dir, `.${id}.tmp`);
  const target = path.join(dir, `${id}.json`);
  const payload: DirtyEvent = { version: 2, paths: values, created_at: Date.now() };
  try {
    fs.writeFileSync(candidate, JSON.stringify(payload), { flag: 'wx' });
    fs.renameSync(candidate, target);
  } finally {
    try { fs.unlinkSync(candidate); } catch { /* renamed or best effort */ }
  }
}

function readLegacyFile(
  filePath: string,
  afterRead?: () => void,
): {
  paths: string[];
  fingerprint?: string;
} {
  let fd: number | undefined;
  try {
    // The bytes and identity must come from the same descriptor. Reading the
    // pathname and then statting it can pair old bytes with a concurrently
    // replaced inode, causing the replacement to be cleared as the snapshot.
    fd = fs.openSync(filePath, 'r');
    const parsed = JSON.parse(fs.readFileSync(fd, 'utf8')) as Partial<LegacyDirtyFile>;
    afterRead?.();
    if (parsed.version !== 1 || !Array.isArray(parsed.paths)) return { paths: [] };
    const stat = fs.fstatSync(fd, { bigint: true });
    return {
      paths: normalizedPaths(parsed.paths),
      fingerprint: `${stat.dev}:${stat.ino}:${stat.mtimeNs}:${stat.size}`,
    };
  } catch {
    return { paths: [] };
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch { /* best effort */ }
    }
  }
}

function readLegacy(
  root: string,
  afterRead?: () => void,
): ReturnType<typeof readLegacyFile> {
  return readLegacyFile(dirtyLedgerPath(root), afterRead);
}

function sleepSync(ms: number): void {
  if (ms <= 0) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Serialize event mutations with publication of a clean freshness stamp.
 * Actions are deliberately synchronous so a same-process callback cannot run
 * while the mutex is held and deadlock attempting a nested mutation.
 */
export function withDirtyLedgerMutationLock<T>(root: string, action: () => T): T {
  const lockPath = dirtyMutationLockPath(root);
  const deadline = Date.now() + 5000;
  while (true) {
    const acquired = acquireScanLease(lockPath, 'dirty-ledger-mutation', {
      startHeartbeat: false,
      gateWaitMs: Math.max(1, deadline - Date.now()),
    });
    if (acquired.ok) {
      try {
        return action();
      } finally {
        acquired.lease.release();
      }
    }
    if (!acquired.retryable || Date.now() >= deadline) {
      throw new Error(`Could not acquire dirty-ledger mutation lock: ${acquired.message}`);
    }
    sleepSync(2);
  }
}

function tryWithDirtyLedgerMutationLock(root: string, action: () => void): boolean {
  const acquired = acquireScanLease(dirtyMutationLockPath(root), 'dirty-stamp-refresh', {
    startHeartbeat: false,
    gateWaitMs: 50,
  });
  if (!acquired.ok) return false;
  try {
    action();
    return true;
  } finally {
    acquired.lease.release();
  }
}

function refreshStampAfterDirtyMutation(
  root: string,
  hooks: Pick<DirtyLedgerTestHooks, 'beforeStampRename'> = {},
): void {
  const target = stampPath(root);
  let current: Record<string, unknown>;
  try {
    current = JSON.parse(fs.readFileSync(target, 'utf8')) as Record<string, unknown>;
    if (current['version'] !== 1) return;
  } catch {
    // Missing/corrupt stamps are already non-authoritative. The freshness
    // command will synthesize a dirty view directly from the ledger.
    return;
  }
  const dirty = captureDirtySnapshot(root).paths;
  const candidate = `${target}.tmp.${process.pid}.${crypto.randomUUID()}`;
  try {
    fs.writeFileSync(candidate, JSON.stringify({
      ...current,
      dirty_files: dirty,
      dirty_count: dirty.length,
    }, null, 2), 'utf8');
    hooks.beforeStampRename?.();
    fs.renameSync(candidate, target);
  } finally {
    try { fs.unlinkSync(candidate); } catch { /* renamed or best effort */ }
  }
}

/** Capture an immutable event set; later events are excluded by filename. */
export function captureDirtySnapshot(
  root: string,
  hooks: Pick<DirtyLedgerTestHooks, 'afterEventList' | 'afterLegacyRead'> = {},
): DirtyLedgerSnapshot {
  const legacy = readLegacy(root, hooks.afterLegacyRead);
  const dir = dirtyEventsPath(root);
  let files: string[] = [];
  try {
    files = fs.readdirSync(dir).filter((file) => file.endsWith('.json')).sort();
  } catch {
    // No event directory yet.
  }
  hooks.afterEventList?.();
  const events: DirtyEventSnapshot[] = [];
  for (const file of files) {
    const event = readEvent(path.join(dir, file));
    if (event) events.push({ file, paths: event.paths });
  }
  return {
    paths: normalizedPaths([
      ...legacy.paths,
      ...events.flatMap((event) => event.paths),
    ]),
    events,
    legacyFingerprint: legacy.fingerprint,
    legacyPaths: legacy.paths,
  };
}

/** Append one immutable event. Concurrent writers never share a temp path. */
export function markDirty(
  paths: string[],
  root: string,
  hooks: Pick<DirtyLedgerTestHooks, 'beforeStampRename'> = {},
): void {
  if (normalizedPaths(paths).length === 0) return;
  // The immutable event is the canonical commit and intentionally takes no
  // global mutex: editor hooks must remain lossless under high fanout. Stamp
  // refresh is advisory/best-effort; freshness readers overlay this ledger so
  // a crash or permission error after the event cannot hide dirty work.
  writeEvent(paths, root);
  if (!fs.existsSync(stampPath(root))) return;
  try {
    // A delayed candidate must not overwrite a newer drain lifecycle stamp.
    // Refresh only while holding the same mutex used by drain-side writers.
    tryWithDirtyLedgerMutationLock(root, () => refreshStampAfterDirtyMutation(root, hooks));
  } catch {
    // The durable event is authoritative. A later read/drain self-heals stamp.
  }
}

export function readDirty(root: string): string[] {
  return captureDirtySnapshot(root).paths;
}

function clearCapturedLegacy(snapshot: DirtyLedgerSnapshot, root: string): void {
  if (!snapshot.legacyFingerprint) return;
  const target = dirtyLedgerPath(root);
  const retired = `${target}.retired.${process.pid}.${crypto.randomUUID()}`;
  try {
    // Rename first, then inspect the exact inode moved. If a legacy writer
    // replaced dirty.json after capture, its paths are migrated to an immutable
    // event instead of being unlinked as though they belonged to the snapshot.
    fs.renameSync(target, retired);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }

  let discard = false;
  try {
    const current = readLegacyFile(retired);
    if (current.fingerprint === snapshot.legacyFingerprint) {
      discard = true;
      return;
    }
    if (current.paths.length > 0) {
      writeEvent(current.paths, root);
      discard = true;
      return;
    }

    // Preserve an unreadable replacement at the compatibility pathname when
    // no newer writer has already recreated it.
    try {
      fs.linkSync(retired, target);
      discard = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') discard = true;
      else throw error;
    }
  } finally {
    if (discard) {
      try { fs.unlinkSync(retired); } catch { /* best effort */ }
    }
  }
}

/** Clear exactly the immutable events captured before a scan. */
export function clearDirtySnapshot(
  snapshot: DirtyLedgerSnapshot,
  root: string,
  hooks: Pick<DirtyLedgerTestHooks, 'beforeSnapshotDelete'> = {},
): void {
  hooks.beforeSnapshotDelete?.();
  withDirtyLedgerMutationLock(root, () => {
    const dir = dirtyEventsPath(root);
    for (const event of snapshot.events) {
      try { fs.unlinkSync(path.join(dir, event.file)); } catch { /* already cleared */ }
    }
    clearCapturedLegacy(snapshot, root);
  });
}

/**
 * Compatibility helper: clear selected paths from events visible at call time.
 * New events created after the snapshot are never inspected or removed.
 */
export function clearDirty(drained: string[], root: string): void {
  const drop = new Set(normalizedPaths(drained));
  if (drop.size === 0) return;
  const snapshot = captureDirtySnapshot(root);
  withDirtyLedgerMutationLock(root, () => {
    const dir = dirtyEventsPath(root);
    for (const event of snapshot.events) {
      const remaining = event.paths.filter((value) => !drop.has(value));
      if (remaining.length !== event.paths.length) {
        if (remaining.length > 0) writeEvent(remaining, root);
        try { fs.unlinkSync(path.join(dir, event.file)); } catch { /* already cleared */ }
      }
    }
    if (snapshot.legacyPaths.some((value) => drop.has(value))) {
      const remaining = snapshot.legacyPaths.filter((value) => !drop.has(value));
      if (remaining.length > 0) writeEvent(remaining, root);
      clearCapturedLegacy(snapshot, root);
    }
  });
}
