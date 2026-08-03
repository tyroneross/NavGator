/**
 * Pre-merge architecture diff — Living Architecture slice 4.
 *
 * Docs: docs/living-architecture.md — supplies criterion 3's invocation
 * surface: a reviewer can see how a branch changes system topology BEFORE
 * the merge, by diffing the current branch's snapshot against the canonical
 * (default-branch) baseline written by slice 3 (`./canonical.ts`).
 *
 * This module is a THIN caller. It writes no new diff logic: it reads two
 * snapshots via `./canonical.ts` and delegates entirely to the existing
 * `computeArchitectureDiff()` (src/diff.ts:46) and `classifySignificance()`
 * (src/diff.ts:180), which already operate on the `Snapshot` type
 * (src/types.ts:833) that C4's snapshots use.
 *
 * THE CENTRAL CONTRACT: when either side of the comparison has no snapshot
 * yet (never written, or on-disk but corrupt), this returns
 * `available: false` with an actionable `reason` — NEVER a diff object. An
 * empty `DiffResult` reads as "your branch changed nothing," which would be
 * the opposite of the truth (we simply don't have data) and is exactly the
 * failure that would make this review tool untrustworthy.
 */
import { computeArchitectureDiff, classifySignificance } from '../diff.js';
import type { DiffResult, DiffSignificance, DiffTrigger, Snapshot } from '../types.js';
import { readBranchSnapshot, readCanonicalSnapshot } from './canonical.js';
import { getCurrentRef, getDefaultBranch, isDefaultBranch } from './refs.js';

export interface PremergeDiffOptions {
  /** Named base ref to diff against (its branch-delta snapshot). Omit to use the canonical baseline. */
  base?: string;
}

export interface PremergeDiffResult {
  /** Label for the comparison base: the named `--base` ref, or `'canonical'` when none was given. */
  base: string;
  /** The resolved current ref (branch name, or short sha when detached). `null` in a non-git directory. */
  head: string | null;
  /** False whenever either snapshot is missing or corrupt — the diff/significance fields are absent in that case. */
  available: boolean;
  /** Actionable explanation, present only when `available` is false. */
  reason?: string;
  /** Present only when `available` is true. */
  diff?: DiffResult;
  /** Present only when `available` is true. */
  significance?: {
    significance: DiffSignificance;
    triggers: DiffTrigger[];
  };
}

/**
 * Compute the pre-merge diff between the base snapshot (canonical, or the
 * named `--base` ref's branch-delta snapshot) and the current branch's
 * snapshot.
 *
 * Never throws: a missing or corrupt snapshot on either side degrades to
 * `available: false` with a `reason` explaining what to run to fix it.
 */
export async function premergeDiff(
  root: string,
  opts: PremergeDiffOptions = {}
): Promise<PremergeDiffResult> {
  const head = await getCurrentRef(root);
  const baseLabel = opts.base ?? 'canonical';

  // f6: `writeSnapshotForCurrentRef` (C4) writes the DEFAULT branch's
  // snapshot to `canonical/` and NEVER to `branches/<slug>/` (see the
  // comment on `onDefault` below). So when the caller's explicit `--base`
  // ref names the default branch (e.g. `--base main`), the recorded
  // baseline lives in `canonical/`, not `branches/main/` — reading
  // `branches/main/` unconditionally would report "no snapshot" even though
  // a real baseline exists. Resolve `--base` against the default branch
  // first and read canonical in that case; only fall back to a branch-delta
  // read when `--base` names some other ref.
  const defaultBranch = opts.base ? await getDefaultBranch(root) : null;
  const baseIsDefaultBranch = !!opts.base && defaultBranch !== null && opts.base === defaultBranch;

  const baseSnapshot: Snapshot | null =
    opts.base && !baseIsDefaultBranch
      ? await readBranchSnapshot(root, opts.base)
      : await readCanonicalSnapshot(root);

  if (!baseSnapshot) {
    const reason = opts.base && !baseIsDefaultBranch
      ? `No recorded snapshot for base ref "${opts.base}". Run \`navgator arch-diff --base ${opts.base} --record\` on that branch first (or check out that branch and run it there).`
      : 'No canonical snapshot exists yet. Run `navgator arch-diff --record` on the default branch first to establish a baseline.';
    return { base: baseLabel, head, available: false, reason };
  }

  if (!head) {
    return {
      base: baseLabel,
      head,
      available: false,
      reason: `Could not resolve the current git ref in ${root} — is this a git repository?`,
    };
  }

  // `writeSnapshotForCurrentRef` (C4) writes the DEFAULT branch's snapshot to
  // `canonical/`, never to `branches/<slug>/` — so on the default branch the
  // "current-branch snapshot" IS the canonical one. Read from the matching
  // location or a legitimate baseline write would look like a missing
  // snapshot.
  const onDefault = await isDefaultBranch(root);
  const headSnapshot: Snapshot | null = onDefault
    ? baseSnapshot && !opts.base
      ? baseSnapshot // same file — avoid a redundant read when base is also canonical
      : await readCanonicalSnapshot(root)
    : await readBranchSnapshot(root, head);
  if (!headSnapshot) {
    return {
      base: baseLabel,
      head,
      available: false,
      reason: `No recorded snapshot for the current branch "${head}". Run \`navgator arch-diff --record\` on this branch first.`,
    };
  }

  const diff = computeArchitectureDiff(baseSnapshot, headSnapshot);
  const significance = classifySignificance(diff);

  return { base: baseLabel, head, available: true, diff, significance };
}
