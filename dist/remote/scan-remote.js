/**
 * scanRemote(url, opts) — parse a GitHub URL, ensure a shallow clone in the
 * cache, run the existing scan pipeline against the clone, and record the
 * remote origin against the project registry entry.
 *
 * `scan()` already owns its own lease and already calls `registerProject()`
 * internally (src/scanner.ts) — this module does neither.
 */
import * as fs from 'fs';
import * as path from 'path';
import { parseGitHubUrl, validateRef } from './github-url.js';
import { ensureClone } from './clone.js';
import { scan } from '../scanner.js';
import { updateProjectMeta } from '../projects.js';
/**
 * Read-modify-write helper for the project registry's origin metadata.
 * `updateProjectMeta` landed in `src/projects.ts` as part of chunk C6 (f8
 * closure) — statically imported now instead of the prior dynamic
 * `typeof mod.updateProjectMeta === 'function'` lookup, which defeated
 * typecheck for this call and would have silently no-op'd on a rename.
 */
async function recordRemoteOrigin(cloneDir, url, cachePath) {
    try {
        await updateProjectMeta(cloneDir, {
            origin: { kind: 'remote', url, cachePath },
        });
    }
    catch {
        // Non-critical — mirrors registerProject's own swallow-and-continue policy.
    }
}
/**
 * Delete any `.navgator/architecture/` a cloned repo shipped in its own
 * commit history BEFORE the scan pipeline ever looks at it (SEC-002).
 *
 * Without this, an attacker-committed `index.json` + `hashes.json` that
 * matches the repo's own files makes `scan(dir, { mode: 'auto' })` select
 * the incremental/no-changes path and return the attacker's
 * components/connections/NAVSUMMARY.md verbatim — no file of the clone is
 * ever actually scanned. Deleting the directory first removes the fake
 * state; passing `mode: 'full'` below removes the *decision point* itself,
 * so a shipped index can never again select the noop path even if this
 * delete step were ever skipped.
 */
async function purgeShippedArchitectureDir(cloneDir) {
    const archDir = path.join(cloneDir, '.navgator');
    await fs.promises.rm(archDir, { recursive: true, force: true });
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
    // SEC-001: `opts.ref` is a SEPARATE input from the URL — it never passes
    // through `parseGitHubUrl`/`finalize`, so it must face the identical
    // control before it can reach `ensureClone`'s argv. Validate whichever ref
    // value wins (opts.ref, if given, otherwise the URL-parsed ref, which is
    // already validated but re-checked here for defense in depth) BEFORE any
    // subprocess is spawned.
    const rawRef = opts.ref ?? parsed.ref;
    let ref;
    if (rawRef !== undefined) {
        const validated = validateRef(rawRef);
        if (validated === null) {
            return { status: 'invalid_ref', url, ref: rawRef };
        }
        ref = validated;
    }
    const cloneResult = await ensureClone({ owner: parsed.owner, repo: parsed.repo, ref }, {
        cacheRoot: opts.cacheRoot,
        refresh: opts.refresh,
        timeoutMs: opts.timeoutMs,
        execFileImpl: opts.execFileImpl,
    });
    // SEC-002: a cloned repo may ship its own `.navgator/architecture/` with a
    // fabricated index/hashes/components/NAVSUMMARY.md designed to make the
    // scanner's `auto` mode select the no-changes noop path and return the
    // attacker's content verbatim. Delete whatever the clone shipped, then
    // force `mode: 'full'` so the noop path can never be selected regardless.
    await purgeShippedArchitectureDir(cloneResult.dir);
    // Mark the origin BEFORE scanning, not after. scan() registers the project
    // itself, so marking afterwards leaves a window in which a remote clone is
    // registered with no `origin` — and any interruption in that window (Ctrl-C,
    // lease contention, machine sleep) makes it permanent. Consumers that exclude
    // remote content by flag would then fail open on it.
    await recordRemoteOrigin(cloneResult.dir, url, cloneResult.dir);
    const outcome = await scan(cloneResult.dir, { mode: 'full', clearFirst: true });
    if (outcome.status === 'busy') {
        return {
            status: 'busy',
            retryable: true,
            message: outcome.message,
            clonePath: cloneResult.dir,
        };
    }
    // Re-assert after the scan: registerProject inside scan() does a
    // load-mutate-save that can drop the pre-scan marker if it read the registry
    // before it was written. Idempotent, so the belt-and-suspenders costs nothing.
    await recordRemoteOrigin(cloneResult.dir, url, cloneResult.dir);
    return {
        status: outcome.status,
        clonePath: cloneResult.dir,
        cloned: cloneResult.cloned,
        parsed,
        scan: outcome,
        origin: { kind: 'remote', url },
    };
}
//# sourceMappingURL=scan-remote.js.map