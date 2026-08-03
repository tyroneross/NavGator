/**
 * `navgator arch-diff [--base <ref>] [--record] [--json] [--agent]` —
 * pre-merge architecture diff (Living Architecture slice 4).
 *
 * Shows how the current branch's architecture differs from the canonical
 * (default-branch) baseline — or a named `--base` ref — BEFORE merging, so a
 * reviewer sees topology drift up front rather than discovering it after the
 * merge lands. Read-only unless `--record` is passed.
 *
 * Registration is C8's (docs/plans/2026-08-03-portfolio-remote-gitaware.md):
 * this module only exports `registerArchDiffCommand`.
 */
import { Command } from 'commander';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { wrapInEnvelope } from '../../agent-output.js';
import { pruneBranchSnapshots, writeSnapshotForCurrentRef } from '../../git-aware/canonical.js';
import { premergeDiff } from '../../git-aware/premerge-diff.js';

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 3000;

interface ArchDiffCommandOptions {
  base?: string;
  record?: boolean;
  prune?: boolean;
  json?: boolean;
  agent?: boolean;
}

/**
 * f9: live refs to protect from `pruneBranchSnapshots` — local branches plus
 * any branch checked out in a linked worktree (a worktree's branch can be
 * "current" for that worktree without appearing as the repo's HEAD, so it
 * must never be pruned out from under it). Best-effort: a non-git directory
 * or a git binary that fails degrades to an empty list rather than throwing,
 * matching the fail-degrade pattern the rest of this module and
 * `src/git-aware/refs.ts` already use — an empty list means "prune
 * everything under branches/", which is the safe read for "not a git repo."
 */
async function listLiveRefs(root: string): Promise<string[]> {
  const refs = new Set<string>();

  try {
    const { stdout } = await execFileAsync(
      'git',
      ['branch', '--format=%(refname:short)'],
      { cwd: root, timeout: GIT_TIMEOUT_MS }
    );
    for (const line of stdout.split('\n')) {
      const trimmed = line.trim();
      if (trimmed) refs.add(trimmed);
    }
  } catch {
    // Non-git directory, or git unavailable — fall through to worktree check.
  }

  try {
    const { stdout } = await execFileAsync(
      'git',
      ['worktree', 'list', '--porcelain'],
      { cwd: root, timeout: GIT_TIMEOUT_MS }
    );
    for (const line of stdout.split('\n')) {
      const match = line.match(/^branch refs\/heads\/(.+)$/);
      if (match && match[1]) refs.add(match[1]);
    }
  } catch {
    // Best-effort — no worktrees to add.
  }

  return Array.from(refs);
}

export function registerArchDiffCommand(program: Command): void {
  program
    .command('arch-diff')
    .description('Pre-merge architecture diff: current branch vs. canonical (or a named --base ref)')
    .option('--base <ref>', 'Diff against this ref\'s recorded snapshot instead of the canonical baseline')
    .option('--record', 'Also write the current ref\'s snapshot before diffing (canonical if on the default branch, else branches/<slug>)')
    .option('--prune', 'Remove branch-delta snapshots (branches/<slug>/) for refs that no longer exist as a local branch or worktree, before diffing')
    .option('--json', 'Output as JSON')
    .option('--agent', 'Output wrapped in agent envelope (implies --json)')
    .action(async (options: ArchDiffCommandOptions) => {
      try {
        const root = process.cwd();
        const isAgent = !!options.agent;
        const isJson = !!options.json || isAgent;

        let pruned: { removed: string[] } | undefined;
        if (options.prune) {
          const liveRefs = await listLiveRefs(root);
          pruned = await pruneBranchSnapshots(root, liveRefs);
        }

        let recorded: { path: string; ref: string | null; isDefault: boolean } | undefined;
        if (options.record) {
          recorded = await writeSnapshotForCurrentRef(root);
        }

        const result = await premergeDiff(root, { base: options.base });

        const data = { ...result, recorded: recorded ?? null, pruned: pruned ?? null };

        if (isAgent) {
          console.log(wrapInEnvelope('arch-diff', data));
        } else if (isJson) {
          console.log(JSON.stringify(data, null, 2));
        } else {
          printHuman(data);
        }

        // House convention (mirrors scan-remote): exitCode 2 signals "ran
        // fine, nothing to report yet" — never a crash, but never silently
        // 0 as though the diff itself succeeded.
        if (!result.available) {
          process.exitCode = 2;
        }
      } catch (error) {
        console.error('arch-diff failed:', error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });
}

function printHuman(data: {
  base: string;
  head: string | null;
  available: boolean;
  reason?: string;
  diff?: import('../../types.js').DiffResult;
  significance?: { significance: string; triggers: string[] };
  recorded: { path: string; ref: string | null; isDefault: boolean } | null;
  pruned: { removed: string[] } | null;
}): void {
  console.log('NavGator Pre-Merge Architecture Diff');
  console.log('='.repeat(60));

  if (data.pruned) {
    console.log(
      data.pruned.removed.length > 0
        ? `Pruned ${data.pruned.removed.length} stale branch snapshot(s): ${data.pruned.removed.join(', ')}`
        : 'Pruned 0 stale branch snapshots (nothing to remove)'
    );
  }

  if (data.recorded) {
    console.log(
      `Recorded snapshot for "${data.recorded.ref ?? '(unknown)'}" -> ${data.recorded.path} (${data.recorded.isDefault ? 'canonical' : 'branch'})`
    );
  }

  console.log(`Base: ${data.base}`);
  console.log(`Head: ${data.head ?? '(unresolved)'}`);
  console.log('');

  if (!data.available) {
    console.log(`No diff available: ${data.reason}`);
    return;
  }

  const diff = data.diff!;
  const sig = data.significance!;
  console.log(`Significance: ${sig.significance} (${sig.triggers.join(', ') || 'none'})`);
  console.log(`Total changes: ${diff.stats.total_changes}`);
  console.log('');

  console.log(`Components added (${diff.components.added.length}):`);
  for (const c of diff.components.added) console.log(`  + ${c.name} (${c.type}, ${c.layer})`);
  console.log(`Components removed (${diff.components.removed.length}):`);
  for (const c of diff.components.removed) console.log(`  - ${c.name} (${c.type}, ${c.layer})`);
  console.log(`Components modified (${diff.components.modified.length}):`);
  for (const c of diff.components.modified) console.log(`  ~ ${c.name}: ${c.changes.join('; ')}`);
  console.log('');

  console.log(`Connections added (${diff.connections.added.length}):`);
  for (const c of diff.connections.added) console.log(`  + ${c.from_name} -> ${c.to_name} (${c.type})`);
  console.log(`Connections removed (${diff.connections.removed.length}):`);
  for (const c of diff.connections.removed) console.log(`  - ${c.from_name} -> ${c.to_name} (${c.type})`);
}
