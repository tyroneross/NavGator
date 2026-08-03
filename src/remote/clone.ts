/**
 * Shallow-clone (or refresh) a validated GitHub repo into a per-repo cache
 * directory under `~/.navgator/cache/remote/<owner>/<repo>`.
 *
 * Security posture: every git invocation uses an argv ARRAY with
 * `shell: false` (never a template string, never `exec`/`execSync`), an
 * explicit timeout, and a hardened child environment so git can never
 * block on a credential prompt or read ambient system config. The exec
 * implementation is injectable so tests never touch the network.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFile as execFileCb, type ExecFileOptions } from 'child_process';
import { promisify } from 'util';

export interface GithubCloneTarget {
  owner: string;
  repo: string;
  ref?: string;
}

export interface ExecFileResult {
  stdout: string;
  stderr: string;
}

/** Injectable exec seam. Defaults to a promisified `child_process.execFile`. */
export type ExecFileImpl = (
  file: string,
  args: string[],
  options: ExecFileOptions
) => Promise<ExecFileResult>;

const defaultExecFile = promisify(execFileCb) as unknown as ExecFileImpl;

export interface EnsureCloneOptions {
  /** Override the cache root — test seam. Defaults to `~/.navgator/cache/remote`. */
  cacheRoot?: string;
  /** Force a clean re-clone instead of a shallow fetch + hard reset. */
  refresh?: boolean;
  /** Explicit timeout in ms for every git invocation. Default 30s. */
  timeoutMs?: number;
  /** Injected exec implementation — test seam, never touches the network. */
  execFileImpl?: ExecFileImpl;
}

export interface EnsureCloneResult {
  /** Absolute path to the checked-out repo. */
  dir: string;
  /** True if this call performed a fresh `git clone`; false if it refreshed an existing cache entry. */
  cloned: boolean;
}

const DEFAULT_TIMEOUT_MS = 30_000;

export function defaultCacheRoot(): string {
  return path.join(os.homedir(), '.navgator', 'cache', 'remote');
}

/**
 * Harden the child environment so git can never block waiting on input or
 * silently pick up host/system git config:
 *  - GIT_TERMINAL_PROMPT=0 disables the interactive credential prompt.
 *  - GIT_ASKPASS/SSH_ASKPASS are blanked so no askpass helper can be invoked.
 *  - GIT_SSH_COMMAND forces ssh BatchMode so a host-key prompt fails fast
 *    instead of hanging (defense in depth; https:// is the default URL).
 *  - GIT_CONFIG_NOSYSTEM=1 ignores /etc/gitconfig and any system-wide config.
 */
function hardenedEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
    GIT_ASKPASS: '',
    SSH_ASKPASS: '',
    GIT_SSH_COMMAND: 'ssh -oBatchMode=yes -oStrictHostKeyChecking=accept-new',
    GIT_CONFIG_NOSYSTEM: '1',
  };
}

function assertInsideCacheRoot(dest: string, cacheRoot: string): void {
  const resolvedDest = path.resolve(dest);
  const resolvedRoot = path.resolve(cacheRoot);
  if (resolvedDest !== resolvedRoot && !resolvedDest.startsWith(resolvedRoot + path.sep)) {
    throw new Error(
      `Refusing to clone outside the cache root: resolved destination "${resolvedDest}" escapes "${resolvedRoot}"`
    );
  }
}

/**
 * Ensure a validated {owner, repo, ref} target is cloned (or refreshed) in
 * the cache and return its on-disk path. Never accepts a raw URL string —
 * callers must pass output already validated by `parseGitHubUrl`.
 */
export async function ensureClone(
  target: GithubCloneTarget,
  opts: EnsureCloneOptions = {}
): Promise<EnsureCloneResult> {
  const cacheRoot = opts.cacheRoot ?? defaultCacheRoot();
  const dest = path.resolve(path.join(cacheRoot, target.owner, target.repo));

  // Defense in depth against a parser bug — reassert containment after
  // building the destination path, even though owner/repo are already
  // allowlist-validated by the caller.
  assertInsideCacheRoot(dest, cacheRoot);

  const exec = opts.execFileImpl ?? defaultExecFile;
  const timeout = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const env = hardenedEnv();

  const gitDirExists = fs.existsSync(path.join(dest, '.git'));

  if (gitDirExists && opts.refresh) {
    await fs.promises.rm(dest, { recursive: true, force: true });
  }

  if (gitDirExists && !opts.refresh) {
    const fetchArgs = ['fetch', '--depth', '1', 'origin', ...(target.ref ? [target.ref] : [])];
    await exec('git', fetchArgs, { cwd: dest, timeout, env });
    await exec('git', ['reset', '--hard', 'FETCH_HEAD'], { cwd: dest, timeout, env });
    return { dir: dest, cloned: false };
  }

  await fs.promises.mkdir(path.dirname(dest), { recursive: true });

  const url = `https://github.com/${target.owner}/${target.repo}.git`;
  const cloneArgs = [
    'clone',
    '--depth',
    '1',
    '--single-branch',
    ...(target.ref ? ['--branch', target.ref] : []),
    url,
    dest,
  ];
  await exec('git', cloneArgs, { cwd: cacheRoot, timeout, env });

  return { dir: dest, cloned: true };
}
