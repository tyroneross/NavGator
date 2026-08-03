/**
 * Single source of truth for Living Architecture slice-3 storage locations.
 *
 * Docs: docs/living-architecture.md:71-72 — "canonical-main plus worktree-delta
 * storage, so agents can separate committed architecture from local changes."
 *
 * Derived from NavGator config so local vs shared storage mode is honored
 * (mirrors src/freshness/paths.ts): getStoragePath() returns
 * `<base>/architecture`, and these two locations live inside that same base
 * as ADDITIVE subdirectories. Nothing here touches the existing
 * `.navgator/architecture/` layout (components.full.jsonl, graph.json, etc.)
 * — that remains the one working view every existing command reads.
 *
 * SHARED-MODE CAVEAT: in `shared` storage mode, getStoragePath() resolves one
 * path under `$HOME` and IGNORES projectRoot (config.ts:113-124), so every
 * project scanned in shared mode shares the SAME canonical/branches
 * directories. That mirrors the existing shared-mode behavior for the rest of
 * `.navgator/architecture/` and is not a new limitation introduced here.
 */
import * as path from 'path';
import { getConfig, getStoragePath } from '../config.js';

/** `<architecture-base>/canonical/snapshot.json` — the committed baseline. */
export function canonicalSnapshotPath(root: string): string {
  return path.join(getStoragePath(getConfig(), root), 'canonical', 'snapshot.json');
}

/** `<architecture-base>/branches` — parent dir for one subdir per branch/ref slug. */
export function branchSnapshotDir(root: string): string {
  return path.join(getStoragePath(getConfig(), root), 'branches');
}

/** `<architecture-base>/branches/<slug>/snapshot.json` — the local delta side. */
export function branchSnapshotPath(root: string, slug: string): string {
  return path.join(branchSnapshotDir(root), slug, 'snapshot.json');
}
