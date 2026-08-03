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
import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';
const defaultExecFile = promisify(execFileCb);
const DEFAULT_TIMEOUT_MS = 30_000;
export function defaultCacheRoot() {
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
function hardenedEnv() {
    return {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
        GIT_ASKPASS: '',
        SSH_ASKPASS: '',
        GIT_SSH_COMMAND: 'ssh -oBatchMode=yes -oStrictHostKeyChecking=accept-new',
        GIT_CONFIG_NOSYSTEM: '1',
    };
}
function assertInsideCacheRoot(dest, cacheRoot) {
    const resolvedDest = path.resolve(dest);
    const resolvedRoot = path.resolve(cacheRoot);
    if (resolvedDest !== resolvedRoot && !resolvedDest.startsWith(resolvedRoot + path.sep)) {
        throw new Error(`Refusing to clone outside the cache root: resolved destination "${resolvedDest}" escapes "${resolvedRoot}"`);
    }
}
/**
 * Ensure a validated {owner, repo, ref} target is cloned (or refreshed) in
 * the cache and return its on-disk path. Never accepts a raw URL string —
 * callers must pass output already validated by `parseGitHubUrl`.
 */
export async function ensureClone(target, opts = {}) {
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
//# sourceMappingURL=clone.js.map