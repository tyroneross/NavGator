import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFileSync } from 'child_process';
import { Command } from 'commander';
import { premergeDiff } from '../../git-aware/premerge-diff.js';
import { registerArchDiffCommand } from '../../cli/commands/arch-diff.js';
import {
  canonicalSnapshotPath,
  branchSnapshotPath,
} from '../../git-aware/paths.js';
import { slugifyRef } from '../../git-aware/refs.js';
import type { Snapshot, SnapshotComponent, SnapshotConnection } from '../../types.js';

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

function component(overrides: Partial<SnapshotComponent> = {}): SnapshotComponent {
  return {
    component_id: 'COMP_default',
    name: 'default-component',
    type: 'npm',
    status: 'active',
    layer: 'backend',
    critical: false,
    ...overrides,
  };
}

function connection(overrides: Partial<SnapshotConnection> = {}): SnapshotConnection {
  return {
    connection_id: 'CONN_default',
    from: 'COMP_a',
    to: 'COMP_b',
    type: 'api-calls-db',
    from_name: 'a',
    to_name: 'b',
    ...overrides,
  };
}

function snapshot(components: SnapshotComponent[], connections: SnapshotConnection[]): Snapshot {
  return {
    snapshot_id: 'SNAP_test',
    snapshot_version: '2.0',
    timestamp: Date.now(),
    components,
    connections,
    stats: {
      total_components: components.length,
      total_connections: connections.length,
    },
  };
}

function writeSnapshotAt(target: string, snap: unknown): void {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(snap, null, 2), 'utf-8');
}

describe('premergeDiff — pre-merge architecture diff (slice 4)', () => {
  let tmp: string;
  let priorGlobal: string | undefined;
  let priorNoSystem: string | undefined;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-premerge-diff-test-'));
    priorGlobal = process.env['GIT_CONFIG_GLOBAL'];
    priorNoSystem = process.env['GIT_CONFIG_NOSYSTEM'];
    process.env['GIT_CONFIG_GLOBAL'] = '/dev/null';
    process.env['GIT_CONFIG_NOSYSTEM'] = '1';

    git(tmp, ['init', '-q', '--initial-branch=main']);
    git(tmp, ['config', 'user.email', 'test@navgator.local']);
    git(tmp, ['config', 'user.name', 'NavGator Test']);
    fs.writeFileSync(path.join(tmp, 'README.md'), '# test\n');
    git(tmp, ['add', '.']);
    git(tmp, ['commit', '-q', '-m', 'initial']);
    git(tmp, ['checkout', '-q', '-b', 'feat/x']);
  });

  afterEach(() => {
    if (priorGlobal === undefined) delete process.env['GIT_CONFIG_GLOBAL'];
    else process.env['GIT_CONFIG_GLOBAL'] = priorGlobal;
    if (priorNoSystem === undefined) delete process.env['GIT_CONFIG_NOSYSTEM'];
    else process.env['GIT_CONFIG_NOSYSTEM'] = priorNoSystem;
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      // Swallow cleanup errors — temp dir on some systems resists removal.
    }
  });

  it('reports added, removed, and modified components and connections', async () => {
    const baseSnap = snapshot(
      [
        component({ component_id: 'COMP_kept', name: 'kept', version: '1.0.0' }),
        component({ component_id: 'COMP_removed', name: 'removed-comp' }),
      ],
      [connection({ connection_id: 'CONN_removed', from_name: 'kept', to_name: 'removed-comp' })]
    );
    const headSnap = snapshot(
      [
        component({ component_id: 'COMP_kept', name: 'kept', version: '2.0.0' }),
        component({ component_id: 'COMP_added', name: 'added-comp' }),
      ],
      [connection({ connection_id: 'CONN_added', from_name: 'kept', to_name: 'added-comp' })]
    );

    writeSnapshotAt(canonicalSnapshotPath(tmp), baseSnap);
    writeSnapshotAt(branchSnapshotPath(tmp, slugifyRef('feat/x')), headSnap);

    const result = await premergeDiff(tmp);

    expect(result.available).toBe(true);
    expect(result.reason).toBeUndefined();
    expect(result.head).toBe('feat/x');
    expect(result.base).toBe('canonical');

    const diff = result.diff!;
    expect(diff.components.added.map((c) => c.name)).toEqual(['added-comp']);
    expect(diff.components.removed.map((c) => c.name)).toEqual(['removed-comp']);
    expect(diff.components.modified.map((c) => c.name)).toEqual(['kept']);
    expect(diff.components.modified[0].changes.join(' ')).toContain('1.0.0');
    expect(diff.connections.added.map((c) => c.to_name)).toEqual(['added-comp']);
    expect(diff.connections.removed.map((c) => c.to_name)).toEqual(['removed-comp']);

    expect(result.significance).toBeDefined();
    expect(result.significance!.significance).toMatch(/major|minor|patch/);
  });

  it('KEY ASSERTION: a missing base snapshot returns available:false with a non-empty reason and no diff object', async () => {
    // No canonical snapshot written at all.
    writeSnapshotAt(branchSnapshotPath(tmp, slugifyRef('feat/x')), snapshot([component()], []));

    const result = await premergeDiff(tmp);

    expect(result.available).toBe(false);
    expect(result.reason).toBeTruthy();
    expect(result.reason!.length).toBeGreaterThan(0);
    expect(result.diff).toBeUndefined();
    expect(result.significance).toBeUndefined();
  });

  it('a missing head (current-branch) snapshot returns available:false with a non-empty reason and no diff object', async () => {
    // Canonical exists, but no branch snapshot was ever recorded for feat/x.
    writeSnapshotAt(canonicalSnapshotPath(tmp), snapshot([component()], []));

    const result = await premergeDiff(tmp);

    expect(result.available).toBe(false);
    expect(result.reason).toBeTruthy();
    expect(result.diff).toBeUndefined();
    expect(result.significance).toBeUndefined();
  });

  it('--base <ref> reads that branch\'s snapshot rather than canonical', async () => {
    const canonicalSnap = snapshot([component({ component_id: 'COMP_c', name: 'from-canonical' })], []);
    const otherBranchSnap = snapshot([component({ component_id: 'COMP_o', name: 'from-other-branch' })], []);
    const headSnap = snapshot(
      [
        component({ component_id: 'COMP_o', name: 'from-other-branch' }),
        component({ component_id: 'COMP_h', name: 'head-only' }),
      ],
      []
    );

    writeSnapshotAt(canonicalSnapshotPath(tmp), canonicalSnap);
    writeSnapshotAt(branchSnapshotPath(tmp, slugifyRef('other-branch')), otherBranchSnap);
    writeSnapshotAt(branchSnapshotPath(tmp, slugifyRef('feat/x')), headSnap);

    const result = await premergeDiff(tmp, { base: 'other-branch' });

    expect(result.available).toBe(true);
    expect(result.base).toBe('other-branch');
    // "from-canonical" must NOT appear as removed — proves the canonical
    // snapshot was never consulted when --base was given.
    expect(result.diff!.components.removed.map((c) => c.name)).not.toContain('from-canonical');
    expect(result.diff!.components.added.map((c) => c.name)).toEqual(['head-only']);
  });

  it('a corrupt base snapshot degrades to available:false rather than throwing', async () => {
    fs.mkdirSync(path.dirname(canonicalSnapshotPath(tmp)), { recursive: true });
    fs.writeFileSync(canonicalSnapshotPath(tmp), '{ not valid json', 'utf-8');
    writeSnapshotAt(branchSnapshotPath(tmp, slugifyRef('feat/x')), snapshot([component()], []));

    await expect(premergeDiff(tmp)).resolves.toMatchObject({ available: false });
    const result = await premergeDiff(tmp);
    expect(result.reason).toBeTruthy();
    expect(result.diff).toBeUndefined();
  });

  it('a corrupt head snapshot degrades to available:false rather than throwing', async () => {
    writeSnapshotAt(canonicalSnapshotPath(tmp), snapshot([component()], []));
    const headPath = branchSnapshotPath(tmp, slugifyRef('feat/x'));
    fs.mkdirSync(path.dirname(headPath), { recursive: true });
    fs.writeFileSync(headPath, 'not json at all', 'utf-8');

    const result = await premergeDiff(tmp);
    expect(result.available).toBe(false);
    expect(result.reason).toBeTruthy();
    expect(result.diff).toBeUndefined();
  });

  it('the result shape has a stable key set in both the available and unavailable cases', async () => {
    writeSnapshotAt(canonicalSnapshotPath(tmp), snapshot([component()], []));
    writeSnapshotAt(branchSnapshotPath(tmp, slugifyRef('feat/x')), snapshot([component()], []));
    const available = await premergeDiff(tmp);
    expect(available.available).toBe(true);
    expect(Object.keys(available).sort()).toEqual(
      ['available', 'base', 'diff', 'head', 'significance'].sort()
    );

    fs.rmSync(canonicalSnapshotPath(tmp));
    const unavailable = await premergeDiff(tmp);
    expect(unavailable.available).toBe(false);
    expect(Object.keys(unavailable).sort()).toEqual(['available', 'base', 'head', 'reason'].sort());
  });

  it('on the default branch, head resolves to the canonical snapshot (no branches/ entry required)', async () => {
    git(tmp, ['checkout', '-q', 'main']);
    writeSnapshotAt(canonicalSnapshotPath(tmp), snapshot([component({ name: 'only-on-main' })], []));

    const result = await premergeDiff(tmp);

    // Comparing canonical to itself: available, zero changes, no throw.
    expect(result.available).toBe(true);
    expect(result.diff!.stats.total_changes).toBe(0);
  });

  // f6: `--base <default-branch>` must resolve to the canonical snapshot,
  // not `branches/<default-branch>/`, since `writeSnapshotForCurrentRef`
  // never writes a branch-delta snapshot for the default branch.
  it('f6: --base <default-branch> resolves the canonical snapshot rather than reporting no baseline', async () => {
    writeSnapshotAt(canonicalSnapshotPath(tmp), snapshot([component({ name: 'from-canonical' })], []));
    writeSnapshotAt(
      branchSnapshotPath(tmp, slugifyRef('feat/x')),
      snapshot([component({ name: 'from-canonical' }), component({ component_id: 'COMP_new', name: 'feature-only' })], [])
    );

    const result = await premergeDiff(tmp, { base: 'main' });

    expect(result.available).toBe(true);
    expect(result.reason).toBeUndefined();
    expect(result.base).toBe('main');
    expect(result.diff!.components.added.map((c) => c.name)).toEqual(['feature-only']);
    // "from-canonical" must not appear as removed — proves the canonical
    // snapshot (not an absent branches/main/ file) was read as the base.
    expect(result.diff!.components.removed).toEqual([]);
  });

  it('f6: --base <default-branch> still reports unavailable when no canonical snapshot has ever been recorded', async () => {
    // No canonical snapshot written — only a branch-delta snapshot for feat/x.
    writeSnapshotAt(branchSnapshotPath(tmp, slugifyRef('feat/x')), snapshot([component()], []));

    const result = await premergeDiff(tmp, { base: 'main' });

    expect(result.available).toBe(false);
    expect(result.reason).toBeTruthy();
    expect(result.reason).toMatch(/canonical snapshot/i);
  });

  // f9: `pruneBranchSnapshots` (src/git-aware/canonical.ts:102-127) had no
  // production caller before this fix — branch-delta snapshots accumulated
  // under branches/ forever. Wired behind `navgator arch-diff --prune`.
  it('f9: arch-diff --prune removes branch snapshots for refs that no longer exist as a live branch', async () => {
    // A snapshot for the still-current branch (feat/x) must survive.
    writeSnapshotAt(branchSnapshotPath(tmp, slugifyRef('feat/x')), snapshot([component()], []));

    // A snapshot for a branch that has since been deleted must be pruned.
    git(tmp, ['branch', 'stale-branch']);
    writeSnapshotAt(branchSnapshotPath(tmp, slugifyRef('stale-branch')), snapshot([component()], []));
    git(tmp, ['branch', '-D', 'stale-branch']);

    const prevCwd = process.cwd();
    process.chdir(tmp);
    const origLog = console.log;
    console.log = () => {};
    const prevExitCode = process.exitCode;
    try {
      const program = new Command();
      registerArchDiffCommand(program);
      await program.parseAsync(['node', 'navgator', 'arch-diff', '--prune', '--json']);
    } finally {
      console.log = origLog;
      process.exitCode = prevExitCode;
      process.chdir(prevCwd);
    }

    expect(fs.existsSync(branchSnapshotPath(tmp, slugifyRef('feat/x')))).toBe(true);
    expect(fs.existsSync(branchSnapshotPath(tmp, slugifyRef('stale-branch')))).toBe(false);
  });
});
