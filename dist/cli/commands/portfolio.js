/**
 * NavGator Portfolio Command
 *
 * `navgator portfolio [dir]` — scan a folder of repos and build a cross-repo
 * map (shared dependencies, heuristic service-call edges, portfolio status).
 * With no `dir`, reports status over already-registered projects without
 * scanning anything.
 *
 * Registration is C8's (docs/plans/2026-08-03-portfolio-remote-gitaware.md):
 * this module only exports `registerPortfolioCommand`.
 */
import * as path from 'path';
import { getConfig } from '../../config.js';
import { loadAllComponents, loadAllConnections } from '../../storage.js';
import { listProjects } from '../../projects.js';
import { wrapInEnvelope } from '../../agent-output.js';
import { scanPortfolio, assertLocalStorageMode } from '../../portfolio/scan.js';
import { buildCrossRepoMap } from '../../portfolio/cross-repo.js';
/** Always present, in every output mode, per the plan's heuristic-labeling requirement. */
const SERVICE_CALL_DISCLAIMER = 'serviceCalls are heuristic/inferred (host-match or service-name-match) — not a verified call graph.';
export function registerPortfolioCommand(program) {
    program
        .command('portfolio [dir]')
        .description('Scan a folder of repos and build a cross-repo dependency/service map')
        .option('--depth <n>', 'Directory depth to search for repos (max 3)', '1')
        .option('--concurrency <n>', 'Concurrent repo scans (max 4)', '1')
        .option('--json', 'Output as JSON')
        .option('--agent', 'Output wrapped in agent envelope (implies --json)')
        .action(async (dir, options) => {
        try {
            const config = getConfig();
            if (!dir) {
                // Same shared-mode refusal scanPortfolio() applies for the scan
                // path: with no `dir`, this loop below fans out across every
                // registered project via loadAllComponents/loadAllConnections,
                // which in shared mode resolve to the SAME storage path for every
                // project (getStoragePath ignores projectRoot). Without this
                // guard, buildCrossRepoMap would silently fabricate cross-repo
                // sharing from N copies of one repo's data.
                assertLocalStorageMode(config);
                const projects = await listProjects();
                const inputs = [];
                for (const p of projects) {
                    const components = await loadAllComponents(config, p.path);
                    const connections = await loadAllConnections(config, p.path);
                    inputs.push({ repo: p.path, components, connections, lastScan: p.lastScan });
                }
                const map = buildCrossRepoMap(inputs);
                render(map, options, undefined);
                return;
            }
            const depth = parseInt(options.depth, 10);
            const concurrency = parseInt(options.concurrency, 10);
            const resolvedDir = path.resolve(dir);
            const scanResult = await scanPortfolio(resolvedDir, { depth, concurrency });
            const inputs = [];
            for (const r of scanResult.repos) {
                const canLoad = r.status === 'scanned' || r.status === 'noop';
                const components = canLoad ? await loadAllComponents(config, r.path) : [];
                const connections = canLoad ? await loadAllConnections(config, r.path) : [];
                inputs.push({
                    repo: r.path,
                    components,
                    connections,
                    scanStatus: r.status,
                });
            }
            const map = buildCrossRepoMap(inputs);
            render(map, options, scanResult);
        }
        catch (error) {
            console.error(`Portfolio failed: ${error instanceof Error ? error.message : String(error)}`);
            process.exitCode = 1;
        }
    });
}
function render(map, options, scanResult) {
    if (options.agent) {
        console.log(wrapInEnvelope('portfolio', {
            scan: scanResult ?? null,
            crossRepo: map,
            note: SERVICE_CALL_DISCLAIMER,
        }));
        return;
    }
    if (options.json) {
        console.log(JSON.stringify({
            scan: scanResult ?? null,
            crossRepo: map,
            note: SERVICE_CALL_DISCLAIMER,
        }, null, 2));
        return;
    }
    console.log('NavGator Portfolio');
    console.log('='.repeat(60));
    if (scanResult) {
        console.log(`Scanned ${scanResult.repos.length} repo(s) under ${scanResult.root}`);
        console.log(`  completed/noop: ${scanResult.scanned + scanResult.noop}  busy: ${scanResult.busy}  failed: ${scanResult.failed}`);
        for (const r of scanResult.repos) {
            const detail = r.status === 'busy' || r.status === 'failed'
                ? ` (${r.message ?? 'no detail'})`
                : r.stats
                    ? ` (${r.stats.components} components, ${r.stats.connections} connections)`
                    : '';
            console.log(`  - ${r.name}: ${r.status}${detail}`);
        }
        console.log('');
    }
    console.log(`Status: ${map.status.repoCount} repo(s), ${map.status.totalComponents} components, ${map.status.totalConnections} connections`);
    if (map.status.staleRepos.length > 0)
        console.log(`  Stale (>24h): ${map.status.staleRepos.join(', ')}`);
    if (map.status.failedRepos.length > 0)
        console.log(`  Failed: ${map.status.failedRepos.join(', ')}`);
    if (map.status.busyRepos.length > 0)
        console.log(`  Busy: ${map.status.busyRepos.join(', ')}`);
    console.log('');
    console.log(`Shared dependencies (${map.sharedDependencies.length}):`);
    for (const d of map.sharedDependencies) {
        const skew = d.versionSkew ? ' [version skew]' : '';
        const versions = d.repos.map((r) => `${r.repo}@${r.version ?? '?'}`).join(', ');
        console.log(`  - ${d.name} (${d.type})${skew}: ${versions}`);
    }
    console.log('');
    console.log(`Cross-repo service calls — ${SERVICE_CALL_DISCLAIMER} (${map.serviceCalls.length}):`);
    for (const e of map.serviceCalls) {
        console.log(`  - ${e.fromRepo}:${e.fromComponent} -> ${e.toRepo}:${e.toComponent} [${e.basis}, confidence ${e.confidence.toFixed(2)}]`);
    }
}
//# sourceMappingURL=portfolio.js.map