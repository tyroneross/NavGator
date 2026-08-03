import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { discoverRepos } from '../../portfolio/discover.js';

let tmp: string;

function makeGitDir(repoDir: string): void {
  fs.mkdirSync(repoDir, { recursive: true });
  fs.mkdirSync(path.join(repoDir, '.git'));
}

function makeGitFileWorktree(repoDir: string): void {
  fs.mkdirSync(repoDir, { recursive: true });
  fs.writeFileSync(path.join(repoDir, '.git'), 'gitdir: /elsewhere/.git/worktrees/x\n');
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-discover-'));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('discoverRepos', () => {
  it('finds repos with .git as a directory, counts a .git-file worktree, skips plain dirs', () => {
    makeGitDir(path.join(tmp, 'repo-a'));
    makeGitFileWorktree(path.join(tmp, 'repo-b'));
    fs.mkdirSync(path.join(tmp, 'plain-dir'));

    const found = discoverRepos(tmp);
    const names = found.map((r) => r.name).sort();
    expect(names).toEqual(['repo-a', 'repo-b']);

    const worktree = found.find((r) => r.name === 'repo-b');
    expect(worktree?.worktree).toBe(true);
    const normal = found.find((r) => r.name === 'repo-a');
    expect(normal?.worktree).toBe(false);
  });

  it('skips symlinked entries entirely', () => {
    makeGitDir(path.join(tmp, 'real-repo'));
    fs.symlinkSync(path.join(tmp, 'real-repo'), path.join(tmp, 'linked-repo'));

    const found = discoverRepos(tmp);
    const names = found.map((r) => r.name);
    expect(names).toContain('real-repo');
    expect(names).not.toContain('linked-repo');
  });

  it('never descends into node_modules', () => {
    makeGitDir(path.join(tmp, 'node_modules', 'some-pkg'));

    const found = discoverRepos(tmp, { depth: 3 });
    expect(found.some((r) => r.path.includes('node_modules'))).toBe(false);
  });

  it('respects --depth: a repo two levels deep is invisible at depth 1, visible at depth 2', () => {
    makeGitDir(path.join(tmp, 'group', 'nested-repo'));

    const shallow = discoverRepos(tmp, { depth: 1 });
    expect(shallow.length).toBe(0);

    const deep = discoverRepos(tmp, { depth: 2 });
    expect(deep.some((r) => r.name === 'nested-repo')).toBe(true);
  });

  it('caps depth at 3 even when a larger value is requested', () => {
    makeGitDir(path.join(tmp, 'a', 'b', 'c', 'toodeep'));
    const found = discoverRepos(tmp, { depth: 10 });
    expect(found.some((r) => r.name === 'toodeep')).toBe(false);
  });

  it('sorts deterministically by path', () => {
    makeGitDir(path.join(tmp, 'zeta'));
    makeGitDir(path.join(tmp, 'alpha'));
    const found = discoverRepos(tmp);
    expect(found.map((r) => r.name)).toEqual(['alpha', 'zeta']);
  });
});
