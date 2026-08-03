/**
 * Canonical-main + branch-delta snapshot storage — Living Architecture slice 3.
 *
 * Docs: docs/living-architecture.md:71-72 — "canonical-main plus worktree-delta
 * storage, so agents can separate committed architecture from local changes."
 *
 * INVARIANT: `.navgator/architecture/` (components.full.jsonl,
 * connections.full.jsonl, graph.json, index.json, NAVSUMMARY.md, etc.) keeps
 * its exact current layout and remains the one working view every existing
 * command reads. This module is strictly ADDITIVE: it writes only under two
 * new subdirectories, `canonical/` and `branches/<slug>/`, resolved via
 * `./paths.ts`. Nothing here modifies, moves, or deletes any existing
 * architecture file.
 *
 * IMPORTANT — wiring: `scan()` does NOT call anything in this module and does
 * NOT maintain these files. They are written only when a caller explicitly
 * invokes `writeSnapshotForCurrentRef` — wired into new CLI commands by a
 * later chunk (C5's `navgator arch-diff --record`, C8's integration). A
 * reader of this file should not assume these snapshots are kept fresh by an
 * ordinary scan.
 *
 * Snapshot shape: built via the existing `buildCurrentSnapshot()`
 * (src/diff.ts:399) — deliberately not a second snapshot shape, since C5's
 * `computeArchitectureDiff()`/`classifySignificance()` (src/diff.ts:46,:180)
 * run against whatever this module writes.
 */
import * as fs from 'fs/promises';
import * as path from 'path';
import { getConfig } from '../config.js';
import { buildCurrentSnapshot } from '../diff.js';
import { atomicWriteJSON } from '../storage.js';
import { branchSnapshotDir, branchSnapshotPath, canonicalSnapshotPath } from './paths.js';
import { getCurrentRef, isDefaultBranch, slugifyRef } from './refs.js';
/**
 * Build a fresh snapshot from the current on-disk architecture data
 * (`buildCurrentSnapshot()`, which itself loads components/connections from
 * storage — no components/connections are threaded through this function)
 * and write it to the canonical path when on the default branch, or the
 * current ref's branch-delta path otherwise.
 *
 * In a non-git directory (or when the ref can't be resolved), the write
 * falls back to a branch path keyed by the literal ref `"unknown"` rather
 * than silently overwriting `canonical/` — canonical writes require a
 * positively-confirmed default branch.
 */
export async function writeSnapshotForCurrentRef(root) {
    const snapshot = await buildCurrentSnapshot(getConfig(), root);
    const [ref, onDefault] = await Promise.all([getCurrentRef(root), isDefaultBranch(root)]);
    const target = onDefault
        ? canonicalSnapshotPath(root)
        : branchSnapshotPath(root, slugifyRef(ref ?? 'unknown'));
    await atomicWriteJSON(target, snapshot);
    return { path: target, ref, isDefault: onDefault };
}
/** Read a snapshot file; `null` on missing file or corrupt/unparseable JSON. Never throws. */
async function readSnapshotFile(target) {
    try {
        const raw = await fs.readFile(target, 'utf-8');
        return JSON.parse(raw);
    }
    catch {
        return null;
    }
}
/** Read the canonical (default-branch) snapshot. `null` if it has never been written or is corrupt. */
export async function readCanonicalSnapshot(root) {
    return readSnapshotFile(canonicalSnapshotPath(root));
}
/**
 * Read a branch-delta snapshot. Defaults to the current ref when `ref` is
 * omitted. `null` if there is no snapshot for that ref, the ref can't be
 * resolved, or the file is corrupt.
 */
export async function readBranchSnapshot(root, ref) {
    const resolvedRef = ref ?? (await getCurrentRef(root));
    if (!resolvedRef)
        return null;
    return readSnapshotFile(branchSnapshotPath(root, slugifyRef(resolvedRef)));
}
/**
 * Remove branch-delta snapshots for refs that no longer exist. `liveRefs` is
 * the caller-supplied list of refs that ARE still live (e.g. from `git
 * branch --list` plus any active worktrees); any on-disk slug directory
 * under `branches/` whose name is not among the slugs of `liveRefs` is
 * deleted. Never throws; a missing `branches/` directory is a no-op.
 */
export async function pruneBranchSnapshots(root, liveRefs) {
    const dir = branchSnapshotDir(root);
    const liveSlugs = new Set(liveRefs.map((ref) => slugifyRef(ref)));
    let entries;
    try {
        entries = await fs.readdir(dir);
    }
    catch {
        return { removed: [] };
    }
    const removed = [];
    for (const entry of entries) {
        if (liveSlugs.has(entry))
            continue;
        try {
            await fs.rm(path.join(dir, entry), { recursive: true, force: true });
            removed.push(entry);
        }
        catch {
            // Best-effort: leave the entry in place rather than throw.
        }
    }
    return { removed };
}
//# sourceMappingURL=canonical.js.map