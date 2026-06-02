/**
 * The dirty-set ledger: an append-only set of changed paths since the last clean
 * drain. The PostToolUse hook appends here (fast, non-blocking); the drainer
 * reads it, scans, and clears the drained subset. Late arrivals (marked while a
 * scan is in flight) survive a partial clear and are picked up next drain.
 */
import * as fs from 'fs';
import * as path from 'path';
import { dirtyLedgerPath } from './paths.js';

interface DirtyFile {
  version: 1;
  paths: string[];
  updated_at: number;
}

function load(root: string): DirtyFile {
  const p = dirtyLedgerPath(root);
  if (!fs.existsSync(p)) return { version: 1, paths: [], updated_at: 0 };
  try {
    const parsed = JSON.parse(fs.readFileSync(p, 'utf8')) as DirtyFile;
    if (parsed?.version === 1 && Array.isArray(parsed.paths)) return parsed;
  } catch {
    /* corrupt -> reset; never block the hook or drainer */
  }
  return { version: 1, paths: [], updated_at: 0 };
}

function save(root: string, data: DirtyFile): void {
  const p = dirtyLedgerPath(root);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, p); // atomic on same filesystem
}

/** Append paths to the dirty set (deduped, sorted). Safe to call concurrently-ish. */
export function markDirty(paths: string[], root: string): void {
  const data = load(root);
  const set = new Set(data.paths);
  for (const raw of paths) {
    const v = raw.trim();
    if (v) set.add(v);
  }
  save(root, { version: 1, paths: [...set].sort(), updated_at: Date.now() });
}

/** Read the current dirty set (sorted). */
export function readDirty(root: string): string[] {
  return load(root).paths;
}

/** Remove the given drained paths, leaving anything that arrived later. */
export function clearDirty(drained: string[], root: string): void {
  const data = load(root);
  const drop = new Set(drained);
  save(root, {
    version: 1,
    paths: data.paths.filter((p) => !drop.has(p)),
    updated_at: Date.now(),
  });
}
