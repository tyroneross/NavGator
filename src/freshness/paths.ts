/**
 * Single source of truth for freshness-subsystem file locations.
 * Derived from NavGator config so local vs shared storage mode is honored:
 * getStoragePath() returns <base>/architecture, so its dirname is the base.
 */
import * as path from 'path';
import { getConfig, getStoragePath } from '../config.js';

/** The `.navgator` base dir for a project root (sibling of `architecture/`). */
export function navgatorBase(root: string): string {
  const storagePath = getStoragePath(getConfig(), root);
  return path.basename(storagePath) === 'architecture'
    ? path.dirname(storagePath)
    : storagePath;
}

/** Dirty-set ledger: append-only set of changed paths since the last clean drain. */
export function dirtyLedgerPath(root: string): string {
  return path.join(navgatorBase(root), 'dirty.json');
}

/** Immutable per-mutation events used by the concurrency-safe dirty ledger. */
export function dirtyEventsPath(root: string): string {
  return path.join(navgatorBase(root), 'dirty.d');
}

/** Short-lived mutex for ledger mutation and clean-stamp publication. */
export function dirtyMutationLockPath(root: string): string {
  return path.join(navgatorBase(root), 'dirty.lock');
}

/** Single-writer scan lock. */
export function scanLockPath(root: string): string {
  return path.join(navgatorBase(root), 'scan.lock');
}

/** Freshness stamp, stored next to the graph it describes. */
export function stampPath(root: string): string {
  return path.join(getStoragePath(getConfig(), root), 'freshness.json');
}
