/**
 * NavGator Portfolio Scan
 *
 * Sweeps every repo discovered under a folder through the existing `scan()`
 * entrypoint. Each repo call gets its own lease (scan() acquires/releases it
 * internally — src/scanner.ts:581-583, :2227-2231) and its own registerProject
 * call (src/scanner.ts:2131) — this module never re-acquires a lease and
 * never calls registerProject itself.
 */
import { scan } from '../scanner.js';
import { getConfig } from '../config.js';
import { discoverRepos } from './discover.js';
const DEFAULT_CONCURRENCY = 1;
const MAX_CONCURRENCY = 4;
/**
 * Refuse shared storage mode for any multi-repo portfolio operation.
 *
 * In shared mode `getStoragePath` ignores `projectRoot` entirely and
 * resolves one path under $HOME (src/config.ts:114-118), so every repo
 * touched in a portfolio sweep would read/write the SAME storage location.
 * For a scan that means silent overwrite of the previous repo's
 * architecture data; for a no-scan status read (see
 * src/cli/commands/portfolio.ts) it means every registered project loads
 * identical component/connection data, and `buildCrossRepoMap` fabricates
 * cross-repo sharing and service-call edges that don't exist
 * (src/portfolio/cross-repo.ts). Refusing beats either failure mode
 * appearing to work.
 *
 * Exported so every portfolio entrypoint that fans out across registered
 * projects — the CLI's no-dir status path and the MCP `portfolio` tool —
 * can call the same guard instead of re-deriving the shared-mode check.
 */
export function assertLocalStorageMode(config) {
    if (config.storageMode === 'shared') {
        throw new Error('navgator portfolio refuses to run in shared storage mode: NAVGATOR_MODE=shared ' +
            'resolves a single storage path under $HOME regardless of which repo is being scanned ' +
            '(getStoragePath ignores projectRoot in shared mode), so scanning multiple repos in one ' +
            'sweep would make every repo after the first overwrite the previous repo\'s architecture ' +
            'data. Switch to local mode (unset NAVGATOR_MODE/NAVGATOR_PATH, or set NAVGATOR_MODE=local) ' +
            'before running a portfolio scan.');
    }
}
/**
 * Scan every discovered repo under `dir`.
 *
 * Hard-refuses shared storage mode via `assertLocalStorageMode` — see that
 * function's doc comment for why.
 */
export async function scanPortfolio(dir, opts = {}) {
    const config = getConfig();
    assertLocalStorageMode(config);
    const discovered = discoverRepos(dir, { depth: opts.depth });
    const requestedConcurrency = opts.concurrency ?? DEFAULT_CONCURRENCY;
    const concurrency = Math.min(Math.max(1, Math.floor(requestedConcurrency)), MAX_CONCURRENCY);
    const repos = new Array(discovered.length);
    let cursor = 0;
    async function worker() {
        while (cursor < discovered.length) {
            const index = cursor++;
            const repo = discovered[index];
            repos[index] = await scanOneRepo(repo.path, repo.name);
        }
    }
    const workerCount = Math.min(concurrency, Math.max(discovered.length, 1));
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    let scanned = 0;
    let noop = 0;
    let busy = 0;
    let failed = 0;
    for (const r of repos) {
        if (r.status === 'scanned')
            scanned++;
        else if (r.status === 'noop')
            noop++;
        else if (r.status === 'busy')
            busy++;
        else if (r.status === 'failed')
            failed++;
    }
    return { root: dir, repos, scanned, noop, busy, failed };
}
/**
 * Scan a single repo, branching on scan()'s discriminated outcome.
 * `completed`/`noop` record stats; `busy` records the retryable message; a
 * thrown scan records `failed`. Every branch returns — none of them throws
 * out of this function — so the sweep in scanPortfolio() always continues.
 */
async function scanOneRepo(repoRoot, name) {
    try {
        const result = await scan(repoRoot, { mode: 'auto' });
        if (result.status === 'busy') {
            return {
                path: repoRoot,
                name,
                status: 'busy',
                retryable: true,
                message: result.message,
            };
        }
        return {
            path: repoRoot,
            name,
            status: result.status === 'noop' ? 'noop' : 'scanned',
            stats: {
                components: result.components.length,
                connections: result.connections.length,
                prompts: result.stats.prompts_found,
            },
        };
    }
    catch (error) {
        return {
            path: repoRoot,
            name,
            status: 'failed',
            message: error instanceof Error ? error.message : String(error),
        };
    }
}
//# sourceMappingURL=scan.js.map