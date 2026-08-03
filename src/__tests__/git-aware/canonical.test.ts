import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFileSync } from 'child_process';
import {
  writeSnapshotForCurrentRef,
  readCanonicalSnapshot,
  readBranchSnapshot,
  pruneBranchSnapshots,
} from '../../git-aware/canonical.js';
import {
  canonicalSnapshotPath,
  branchSnapshotDir,
  branchSnapshotPath,
} from '../../git-aware/paths.js';
import { slugifyRef } from '../../git-aware/refs.js';

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

describe('git-aware canonical + branch-delta snapshot storage', () => {
  let tmp: string;
  let priorGlobal: string | undefined;
  let priorNoSystem: string | undefined;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-canonical-test-'));
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

  it('writes canonical/snapshot.json on the default branch and leaves branches/ absent', async () => {
    const result = await writeSnapshotForCurrentRef(tmp);
    expect(result.isDefault).toBe(true);
    expect(result.ref).toBe('main');
    expect(result.path).toBe(canonicalSnapshotPath(tmp));
    expect(fs.existsSync(canonicalSnapshotPath(tmp))).toBe(true);
    expect(fs.existsSync(branchSnapshotDir(tmp))).toBe(false);
  });

  it('FALSIFIER: a feature-branch write never changes canonical/snapshot.json', async () => {
    await writeSnapshotForCurrentRef(tmp);
    const canonicalBytesBefore = fs.readFileSync(canonicalSnapshotPath(tmp));

    git(tmp, ['checkout', '-q', '-b', 'feat/a']);
    const result = await writeSnapshotForCurrentRef(tmp);

    const canonicalBytesAfter = fs.readFileSync(canonicalSnapshotPath(tmp));
    expect(canonicalBytesAfter.equals(canonicalBytesBefore)).toBe(true);

    expect(result.isDefault).toBe(false);
    expect(result.ref).toBe('feat/a');
    const expectedBranchPath = branchSnapshotPath(tmp, slugifyRef('feat/a'));
    expect(result.path).toBe(expectedBranchPath);
    expect(fs.existsSync(expectedBranchPath)).toBe(true);
  });

  it('readCanonicalSnapshot round-trips a written snapshot', async () => {
    await writeSnapshotForCurrentRef(tmp);
    const snapshot = await readCanonicalSnapshot(tmp);
    expect(snapshot).not.toBeNull();
    expect(snapshot?.snapshot_version).toBe('2.0');
  });

  it('readCanonicalSnapshot returns null when nothing has been written', async () => {
    expect(await readCanonicalSnapshot(tmp)).toBeNull();
  });

  it('readBranchSnapshot returns null for a ref with no snapshot', async () => {
    expect(await readBranchSnapshot(tmp, 'never-written')).toBeNull();
  });

  it('a corrupt snapshot file reads back as null without throwing', async () => {
    const target = canonicalSnapshotPath(tmp);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, '{ not valid json');
    await expect(readCanonicalSnapshot(tmp)).resolves.toBeNull();
  });

  it('readBranchSnapshot defaults to the current ref when ref is omitted', async () => {
    git(tmp, ['checkout', '-q', '-b', 'feat/b']);
    await writeSnapshotForCurrentRef(tmp);
    const snapshot = await readBranchSnapshot(tmp);
    expect(snapshot).not.toBeNull();
  });

  it('pruneBranchSnapshots removes snapshots for refs no longer live', async () => {
    git(tmp, ['checkout', '-q', '-b', 'feat/stale']);
    await writeSnapshotForCurrentRef(tmp);
    const staleSlug = slugifyRef('feat/stale');
    expect(fs.existsSync(path.join(branchSnapshotDir(tmp), staleSlug))).toBe(true);

    const { removed } = await pruneBranchSnapshots(tmp, ['main']);
    expect(removed).toContain(staleSlug);
    expect(fs.existsSync(path.join(branchSnapshotDir(tmp), staleSlug))).toBe(false);
  });

  it('pruneBranchSnapshots is a no-op when branches/ does not exist', async () => {
    const { removed } = await pruneBranchSnapshots(tmp, []);
    expect(removed).toEqual([]);
  });
});
