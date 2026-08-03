import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFileSync } from 'child_process';
import {
  getDefaultBranch,
  getCurrentBranch,
  getCurrentRef,
  isDefaultBranch,
  isWorktree,
  slugifyRef,
} from '../../git-aware/refs.js';

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

describe('git-aware refs', () => {
  let tmp: string;
  let priorGlobal: string | undefined;
  let priorNoSystem: string | undefined;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-refs-test-'));
    priorGlobal = process.env['GIT_CONFIG_GLOBAL'];
    priorNoSystem = process.env['GIT_CONFIG_NOSYSTEM'];
    // Sandbox git config resolution away from this machine's real global/system
    // config so `getDefaultBranch`'s fallback tiers are deterministic in CI.
    // (A production caller intentionally does NOT set these — see refs.ts.)
    process.env['GIT_CONFIG_GLOBAL'] = '/dev/null';
    process.env['GIT_CONFIG_NOSYSTEM'] = '1';
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

  function initRepo(initialBranch: string): void {
    git(tmp, ['init', '-q', `--initial-branch=${initialBranch}`]);
    git(tmp, ['config', 'user.email', 'test@navgator.local']);
    git(tmp, ['config', 'user.name', 'NavGator Test']);
    fs.writeFileSync(path.join(tmp, 'README.md'), '# test\n');
    git(tmp, ['add', '.']);
    git(tmp, ['commit', '-q', '-m', 'initial']);
  }

  describe('non-git directory', () => {
    it('every function degrades safely', async () => {
      expect(await getDefaultBranch(tmp)).toBeNull();
      expect(await getCurrentBranch(tmp)).toBeNull();
      expect(await getCurrentRef(tmp)).toBeNull();
      expect(await isDefaultBranch(tmp)).toBe(false);
      expect(isWorktree(tmp)).toBe(false);
    });
  });

  describe('getDefaultBranch', () => {
    it('resolves from init.defaultBranch config when set', async () => {
      initRepo('trunk');
      git(tmp, ['config', 'init.defaultBranch', 'trunk']);
      expect(await getDefaultBranch(tmp)).toBe('trunk');
    });

    it('probes local main when nothing else resolves', async () => {
      initRepo('main');
      expect(await getDefaultBranch(tmp)).toBe('main');
    });

    it('probes local master when main is absent', async () => {
      initRepo('master');
      expect(await getDefaultBranch(tmp)).toBe('master');
    });

    it('returns null when nothing resolves', async () => {
      initRepo('trunk'); // no main, no master, no config, no origin
      expect(await getDefaultBranch(tmp)).toBeNull();
    });

    it('resolves from the origin symbolic HEAD', async () => {
      const originDir = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-origin-'));
      try {
        git(originDir, ['init', '-q', '--bare', '--initial-branch=main']);
        initRepo('main');
        git(tmp, ['remote', 'add', 'origin', originDir]);
        git(tmp, ['push', '-q', 'origin', 'main']);
        git(tmp, ['remote', 'set-head', 'origin', 'main']);

        expect(await getDefaultBranch(tmp)).toBe('main');
      } finally {
        fs.rmSync(originDir, { recursive: true, force: true });
      }
    });
  });

  describe('isDefaultBranch / getCurrentRef', () => {
    it('true on the default branch, false on a feature branch', async () => {
      initRepo('main');
      expect(await isDefaultBranch(tmp)).toBe(true);
      expect(await getCurrentRef(tmp)).toBe('main');

      git(tmp, ['checkout', '-q', '-b', 'feat/a']);
      expect(await isDefaultBranch(tmp)).toBe(false);
      expect(await getCurrentRef(tmp)).toBe('feat/a');
    });

    it('falls back to the short commit sha on detached HEAD', async () => {
      initRepo('main');
      const sha = git(tmp, ['rev-parse', '--short', 'HEAD']).trim();
      git(tmp, ['checkout', '-q', sha]);
      expect(await getCurrentBranch(tmp)).toBe('HEAD');
      expect(await getCurrentRef(tmp)).toBe(sha);
    });
  });

  describe('isWorktree', () => {
    it('false for a normal repo (.git is a directory)', async () => {
      initRepo('main');
      expect(fs.statSync(path.join(tmp, '.git')).isDirectory()).toBe(true);
      expect(isWorktree(tmp)).toBe(false);
    });

    it('true for a linked worktree (.git is a file)', async () => {
      initRepo('main');
      const worktreeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-worktree-'));
      fs.rmSync(worktreeDir, { recursive: true, force: true }); // `worktree add` requires an absent path
      try {
        git(tmp, ['worktree', 'add', '-q', worktreeDir, '-b', 'wt-branch']);
        expect(fs.statSync(path.join(worktreeDir, '.git')).isFile()).toBe(true);
        expect(isWorktree(worktreeDir)).toBe(true);
      } finally {
        try {
          git(tmp, ['worktree', 'remove', '--force', worktreeDir]);
        } catch {
          // best-effort
        }
        fs.rmSync(worktreeDir, { recursive: true, force: true });
      }
    });
  });

  describe('slugifyRef', () => {
    it('feat/a and feat_a produce different slugs', () => {
      const a = slugifyRef('feat/a');
      const b = slugifyRef('feat_a');
      expect(a).not.toBe(b);
      expect(b).toBe('feat_a'); // unchanged input carries no hash suffix
      expect(a).toMatch(/^feat__a_[0-9a-f]{8}$/);
    });

    it('a slug needing no sanitization carries no hash suffix', () => {
      expect(slugifyRef('main')).toBe('main');
      expect(slugifyRef('release-1.2.3')).toBe('release-1.2.3');
    });

    it('sanitizes a disallowed character to a single underscore, with a hash suffix', () => {
      expect(slugifyRef('feat:v2')).toMatch(/^feat_v2_[0-9a-f]{8}$/);
    });

    it('caps length at 100 characters and appends a hash when truncation changed the string', () => {
      const longRef = 'a'.repeat(150);
      const slug = slugifyRef(longRef);
      const match = slug.match(/^(a+)_([0-9a-f]{8})$/);
      expect(match).not.toBeNull();
      expect(match?.[1]?.length).toBe(100);
    });

    it('is deterministic for the same ref', () => {
      expect(slugifyRef('feat/a')).toBe(slugifyRef('feat/a'));
    });
  });
});

describe('slugifyRef path-traversal guard', () => {
  it('never returns a slug that resolves outside the branches dir', () => {
    for (const ref of ['..', '.']) {
      const slug = slugifyRef(ref);
      expect(slug).not.toBe(ref);
      // The slug must stay a single, non-relative path segment.
      expect(path.normalize(path.join('branches', slug)).startsWith('branches' + path.sep)).toBe(true);
    }
  });

  it('still leaves an ordinary dotted ref unchanged', () => {
    expect(slugifyRef('release-1.2.3')).toBe('release-1.2.3');
  });
});
