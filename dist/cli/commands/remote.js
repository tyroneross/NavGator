import { scanRemote } from '../../remote/scan-remote.js';
import { wrapInEnvelope } from '../../agent-output.js';
/**
 * `navgator scan-remote <url>` — shallow-clone a GitHub repo into a local
 * cache and run the architecture scan against it. CLI-only by design: an
 * MCP-invokable version would put a network fetch (`git clone`) on a
 * prompt-injection-reachable path, so this stays human-initiated.
 */
export function registerScanRemoteCommand(program) {
    program
        .command('scan-remote <url>')
        .description('Shallow-clone a GitHub repo by URL into ~/.navgator/cache/remote and run the architecture scan against it')
        .option('--ref <ref>', 'Branch, tag, or commit-ish to check out (overrides a /tree/<ref> in the URL)')
        .option('--refresh', 'Force a clean re-clone instead of a shallow fetch + reset of the cached checkout')
        .option('--json', 'Output scan results as JSON')
        .option('--agent', 'Output wrapped in agent envelope (implies --json)')
        .action(async (url, options) => {
        try {
            const isAgent = !!options.agent;
            const isJson = !!options.json || isAgent;
            const origLog = console.log;
            if (isJson) {
                console.log = () => { };
            }
            const outcome = await scanRemote(url, {
                ref: options.ref,
                refresh: !!options.refresh,
            });
            if (isJson) {
                console.log = origLog;
            }
            if (outcome.status === 'invalid_url') {
                const data = { status: outcome.status, url: outcome.url };
                if (isAgent) {
                    console.log(wrapInEnvelope('scan-remote', data));
                }
                else if (isJson) {
                    console.log(JSON.stringify(data, null, 2));
                }
                else {
                    console.error(`Invalid GitHub URL: ${outcome.url}`);
                }
                process.exitCode = 2;
                return;
            }
            if (outcome.status === 'busy') {
                const data = {
                    status: outcome.status,
                    retryable: outcome.retryable,
                    message: outcome.message,
                    clonePath: outcome.clonePath,
                };
                if (isAgent) {
                    console.log(wrapInEnvelope('scan-remote', data));
                }
                else if (isJson) {
                    console.log(JSON.stringify(data, null, 2));
                }
                else {
                    console.error(`Scan busy: ${outcome.message}`);
                }
                process.exitCode = 2;
                return;
            }
            const scanResult = outcome.scan;
            const data = {
                status: outcome.status,
                clonePath: outcome.clonePath,
                cloned: outcome.cloned,
                owner: outcome.parsed.owner,
                repo: outcome.parsed.repo,
                components_found: scanResult.stats.components_found,
                connections_found: scanResult.stats.connections_found,
                scan_duration_ms: scanResult.stats.scan_duration_ms,
                files_scanned: scanResult.stats.files_scanned,
                warnings_count: scanResult.stats.warnings_count,
            };
            if (isAgent) {
                console.log(wrapInEnvelope('scan-remote', data));
            }
            else if (isJson) {
                console.log(JSON.stringify(data, null, 2));
            }
            else {
                console.log('\n========================================');
                console.log(outcome.status === 'noop' ? 'SCAN NO CHANGES' : 'SCAN COMPLETE');
                console.log('========================================\n');
                console.log(`Repo: ${outcome.parsed.owner}/${outcome.parsed.repo}`);
                console.log(`Cloned to: ${outcome.clonePath}`);
                console.log(`Components found: ${scanResult.stats.components_found}`);
                console.log(`Connections found: ${scanResult.stats.connections_found}`);
                console.log(`Files scanned: ${scanResult.stats.files_scanned}`);
                console.log(`Scan completed in ${scanResult.stats.scan_duration_ms}ms`);
            }
        }
        catch (error) {
            console.error('scan-remote failed:', error);
            process.exit(1);
        }
    });
}
//# sourceMappingURL=remote.js.map