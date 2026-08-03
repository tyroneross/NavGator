/**
 * scanRemote(url, opts) — parse a GitHub URL, ensure a shallow clone in the
 * cache, run the existing scan pipeline against the clone, and record the
 * remote origin against the project registry entry.
 *
 * `scan()` already owns its own lease and already calls `registerProject()`
 * internally (src/scanner.ts) — this module does neither.
 */
import { parseGitHubUrl } from './github-url.js';
import { ensureClone } from './clone.js';
import { scan } from '../scanner.js';
import * as projectsModule from '../projects.js';
/**
 * Read-modify-write helper for the project registry's origin metadata.
 *
 * Sibling chunk C6 is adding `updateProjectMeta(root, patch)` to
 * `src/projects.ts` in the same parallel batch as this chunk. It may not
 * exist yet at any given moment during that batch, so this is looked up
 * dynamically (not statically imported/typed) and is a no-op — never a
 * throw — when absent. Once C6 lands, this starts working with no further
 * change needed here.
 */
async function recordRemoteOrigin(cloneDir, url, cachePath) {
    const mod = projectsModule;
    if (typeof mod.updateProjectMeta !== 'function')
        return;
    try {
        await mod.updateProjectMeta(cloneDir, {
            origin: { kind: 'remote', url, cachePath },
        });
    }
    catch {
        // Non-critical — mirrors registerProject's own swallow-and-continue policy.
    }
}
/**
 * Parse a GitHub URL, ensure the clone exists (or is refreshed), run the
 * scan, and record the remote origin. Never throws on a malformed URL —
 * returns a typed `invalid_url` result instead.
 */
export async function scanRemote(url, opts = {}) {
    const parsed = parseGitHubUrl(url);
    if (!parsed) {
        return { status: 'invalid_url', url };
    }
    const ref = opts.ref ?? parsed.ref;
    const cloneResult = await ensureClone({ owner: parsed.owner, repo: parsed.repo, ref }, {
        cacheRoot: opts.cacheRoot,
        refresh: opts.refresh,
        timeoutMs: opts.timeoutMs,
        execFileImpl: opts.execFileImpl,
    });
    const outcome = await scan(cloneResult.dir, { mode: 'auto' });
    if (outcome.status === 'busy') {
        return {
            status: 'busy',
            retryable: true,
            message: outcome.message,
            clonePath: cloneResult.dir,
        };
    }
    await recordRemoteOrigin(cloneResult.dir, url, cloneResult.dir);
    return {
        status: outcome.status,
        clonePath: cloneResult.dir,
        cloned: cloneResult.cloned,
        parsed,
        scan: outcome,
    };
}
//# sourceMappingURL=scan-remote.js.map