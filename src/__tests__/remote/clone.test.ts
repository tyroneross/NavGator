import { describe, it, expect, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ensureClone } from '../../remote/clone.js';

/** No test in this file touches the network — every git invocation is injected. */

function makeExecSpy() {
  const calls: Array<{ file: string; args: string[]; options: unknown }> = [];
  const impl = vi.fn(async (file: string, args: string[], options: unknown) => {
    calls.push({ file, args, options });
    return { stdout: '', stderr: '' };
  });
  return { impl, calls };
}

describe('ensureClone — argv construction (no network)', () => {
  it('builds the clone argv array element-by-element for a fresh clone', async () => {
    const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-clone-test-'));
    const { impl, calls } = makeExecSpy();

    const result = await ensureClone(
      { owner: 'torvalds', repo: 'linux' },
      { cacheRoot, execFileImpl: impl }
    );

    expect(calls).toHaveLength(1);
    expect(calls[0].file).toBe('git');
    expect(calls[0].args).toEqual([
      'clone',
      '--depth',
      '1',
      '--single-branch',
      'https://github.com/torvalds/linux.git',
      path.join(cacheRoot, 'torvalds', 'linux'),
    ]);
    expect(result.cloned).toBe(true);
    expect(result.dir).toBe(path.resolve(cacheRoot, 'torvalds', 'linux'));

    fs.rmSync(cacheRoot, { recursive: true, force: true });
  });

  it('includes --branch <ref> in the argv when a ref is given', async () => {
    const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-clone-test-'));
    const { impl, calls } = makeExecSpy();

    await ensureClone(
      { owner: 'torvalds', repo: 'linux', ref: 'v6.9' },
      { cacheRoot, execFileImpl: impl }
    );

    expect(calls[0].args).toEqual([
      'clone',
      '--depth',
      '1',
      '--single-branch',
      '--branch',
      'v6.9',
      'https://github.com/torvalds/linux.git',
      path.join(cacheRoot, 'torvalds', 'linux'),
    ]);

    fs.rmSync(cacheRoot, { recursive: true, force: true });
  });

  it('uses an argv ARRAY, never a shell-invoking string, for exec options', async () => {
    const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-clone-test-'));
    const { impl, calls } = makeExecSpy();

    await ensureClone({ owner: 'a', repo: 'b' }, { cacheRoot, execFileImpl: impl });

    expect(Array.isArray(calls[0].args)).toBe(true);
    for (const arg of calls[0].args) {
      expect(typeof arg).toBe('string');
    }
    const opts = calls[0].options as Record<string, unknown>;
    expect(opts.cwd).toBeDefined();
    expect(opts.timeout).toBeGreaterThan(0);
    // Hardened env: no interactive credential prompt, no system config.
    const env = opts.env as Record<string, string>;
    expect(env.GIT_TERMINAL_PROMPT).toBe('0');
    expect(env.GIT_CONFIG_NOSYSTEM).toBe('1');
    expect(env.GIT_ASKPASS).toBe('');

    fs.rmSync(cacheRoot, { recursive: true, force: true });
  });

  it('refreshes an existing cache entry with fetch + hard reset instead of re-cloning', async () => {
    const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-clone-test-'));
    const dest = path.join(cacheRoot, 'torvalds', 'linux');
    fs.mkdirSync(path.join(dest, '.git'), { recursive: true });
    const { impl, calls } = makeExecSpy();

    const result = await ensureClone(
      { owner: 'torvalds', repo: 'linux' },
      { cacheRoot, execFileImpl: impl }
    );

    expect(result.cloned).toBe(false);
    expect(calls.map((c) => c.args[0])).toEqual(['fetch', 'reset']);

    fs.rmSync(cacheRoot, { recursive: true, force: true });
  });

  it('--refresh forces a clean re-clone even when a cache entry exists', async () => {
    const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-clone-test-'));
    const dest = path.join(cacheRoot, 'torvalds', 'linux');
    fs.mkdirSync(path.join(dest, '.git'), { recursive: true });
    fs.writeFileSync(path.join(dest, 'stale-marker.txt'), 'stale');
    const { impl, calls } = makeExecSpy();

    const result = await ensureClone(
      { owner: 'torvalds', repo: 'linux' },
      { cacheRoot, refresh: true, execFileImpl: impl }
    );

    expect(result.cloned).toBe(true);
    expect(calls.map((c) => c.args[0])).toEqual(['clone']);
    expect(fs.existsSync(path.join(dest, 'stale-marker.txt'))).toBe(false);

    fs.rmSync(cacheRoot, { recursive: true, force: true });
  });

  it('cache-path containment holds: the resolved destination stays inside the cache root', async () => {
    const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-clone-test-'));
    const { impl } = makeExecSpy();

    const result = await ensureClone(
      { owner: 'safe-owner', repo: 'safe-repo' },
      { cacheRoot, execFileImpl: impl }
    );

    const resolvedRoot = path.resolve(cacheRoot);
    expect(result.dir.startsWith(resolvedRoot + path.sep)).toBe(true);

    fs.rmSync(cacheRoot, { recursive: true, force: true });
  });
});
