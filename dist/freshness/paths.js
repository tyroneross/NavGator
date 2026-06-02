/**
 * Single source of truth for freshness-subsystem file locations.
 * Derived from NavGator config so local vs shared storage mode is honored:
 * getStoragePath() returns <base>/architecture, so its dirname is the base.
 */
import * as path from 'path';
import { getConfig, getStoragePath } from '../config.js';
/** The `.navgator` base dir for a project root (sibling of `architecture/`). */
export function navgatorBase(root) {
    return path.dirname(getStoragePath(getConfig(), root));
}
/** Dirty-set ledger: append-only set of changed paths since the last clean drain. */
export function dirtyLedgerPath(root) {
    return path.join(navgatorBase(root), 'dirty.json');
}
/** Single-writer scan lock. */
export function scanLockPath(root) {
    return path.join(navgatorBase(root), 'scan.lock');
}
/** Freshness stamp, stored next to the graph it describes. */
export function stampPath(root) {
    return path.join(navgatorBase(root), 'architecture', 'freshness.json');
}
//# sourceMappingURL=paths.js.map