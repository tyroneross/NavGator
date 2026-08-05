import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { loadIndex, loadAllComponents, loadAllConnections } from '../../storage.js';
import { getConfig } from '../../config.js';
import { wrapInEnvelope } from '../../agent-output.js';
import { getGitInfo } from '../../git.js';
import { setup, isSetupComplete, formatSetupStatus } from '../../setup.js';
import { buildExecutiveSummary } from '../../agent-output.js';
import { isSandboxMode } from '../../sandbox.js';
import { scan } from '../../scanner.js';
import { deleteDashboardSession, mintBootstrapNonce, mintDashboardToken, writeDashboardSession, } from '../../dashboard-session.js';
import { EXIT_CODES } from '../exit-codes.js';
// =============================================================================
// SHARED HELPERS
// =============================================================================
/**
 * Open a URL in the user's browser WITHOUT going through a shell.
 *
 * The previous form was `exec(`${openCmd} ${url}`)`, which does two bad
 * things at once: it interposes a `/bin/sh -c <whole command line>` process
 * whose argv is a second copy of the URL in the process table, and it leaves
 * the unquoted `?` and `&` in the URL exposed to shell globbing and job
 * control. An argv array goes straight to `execvp` — no shell, no second
 * copy, no quoting to get wrong.
 *
 * This is hygiene, not the control. What actually keeps a `ps`-reading
 * attacker from getting a usable credential is that the value in this URL is
 * a single-use, short-TTL nonce rather than the session token (see
 * `src/dashboard-session.ts`). `spawn` alone would still print the URL in
 * the child's own argv.
 *
 * `start` on Windows is a `cmd.exe` builtin rather than an executable, so it
 * cannot be `spawn`ed directly; `cmd /c start ""` is the argv-array
 * equivalent (the empty string is the window title `start` otherwise steals
 * from the first quoted argument).
 */
export function browserOpenArgv(url, platform = process.platform) {
    if (platform === 'darwin')
        return { command: 'open', args: [url] };
    if (platform === 'win32')
        return { command: 'cmd', args: ['/c', 'start', '', url] };
    return { command: 'xdg-open', args: [url] };
}
/**
 * `spawnFn` is injectable so a test can assert on the EXACT argv without
 * launching a browser. The default is the real `spawn`; no production call
 * site passes anything.
 */
export function openInBrowser(url, spawnFn = spawn) {
    const { command, args } = browserOpenArgv(url);
    try {
        const child = spawnFn(command, args, {
            stdio: 'ignore',
            detached: true,
        });
        // A browser launcher that fails (headless box, no xdg-open) must not
        // take the dashboard down with it — the URL is already on stdout.
        child.on('error', () => { });
        child.unref();
    }
    catch {
        // Same reasoning as above.
    }
}
/**
 * The one place the browser-open URL is built.
 *
 * Both `navgator ui` call sites go through this, so there is exactly one
 * line to audit for "does a secret that must not enter an argv end up in an
 * argv". It takes the NONCE, and there is no parameter it could accept the
 * session token through.
 */
export function bootstrapUrl(port, bootstrapNonce) {
    return `http://localhost:${port}/?nvt=${bootstrapNonce}`;
}
export async function launchWebUI(options) {
    const port = options.port || 3000;
    const projectPath = options.projectPath || process.cwd();
    // Resolve the package-safe dashboard launcher relative to package root.
    const cliDir = path.dirname(fileURLToPath(import.meta.url));
    const packageRoot = path.resolve(cliDir, '..', '..', '..');
    const serverJs = path.join(packageRoot, 'web', 'server.cjs');
    const cliEntry = path.join(packageRoot, 'dist', 'cli', 'index.js');
    if (!fs.existsSync(serverJs) || !fs.existsSync(cliEntry)) {
        throw new Error(`NavGator dashboard server not found at:\n  ${serverJs}\n\n` +
            'Run `npm run build` from the NavGator root to build the web UI.');
    }
    // SEC-001: mint a per-launch capability token so the dashboard trust
    // boundary is not "any loopback process" but "the process that ran
    // `navgator ui`". See web/proxy.ts for enforcement and
    // src/dashboard-session.ts for the two-secret lifecycle.
    //
    // `token` is the session credential and NEVER enters an argv or a URL. The
    // separate single-use `bootstrapNonce` is the only value the browser-open
    // URL carries, so the only secret the process table can leak is one the
    // proxy burns on first use and expires after ~5 minutes.
    const token = mintDashboardToken();
    const bootstrapNonce = mintBootstrapNonce();
    writeDashboardSession(token, port);
    const child = spawn('node', [serverJs], {
        env: {
            ...process.env,
            NODE_ENV: 'production',
            PORT: String(port),
            HOSTNAME: '127.0.0.1',
            NAVGATOR_PROJECT_PATH: projectPath,
            NAVGATOR_CLI_ENTRY: cliEntry,
            NAVGATOR_DASHBOARD_TOKEN: token,
            NAVGATOR_DASHBOARD_BOOTSTRAP: bootstrapNonce,
        },
        cwd: packageRoot,
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    // Wait for "Ready" or listening message.
    //
    // The child's output is FORWARDED to this process's stdio, not just
    // string-matched. The previous version consumed stdout/stderr solely to
    // look for "ready" and threw the rest away, which is why the proxy's
    // "running WITHOUT session auth" warning — the one thing that was supposed
    // to make degraded mode loud — never reached a terminal. Anything the
    // dashboard says about its own security posture has to be visible.
    child.stdout?.pipe(process.stdout);
    child.stderr?.pipe(process.stderr);
    await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            resolve(); // proceed even if no explicit "Ready" message after 5s
        }, 5000);
        const onData = (data) => {
            const msg = data.toString();
            if (msg.includes('Ready') || msg.includes('ready') || msg.includes('started') || msg.includes('listening')) {
                clearTimeout(timeout);
                resolve();
            }
        };
        child.stdout?.on('data', onData);
        child.stderr?.on('data', onData);
        child.on('error', (err) => {
            clearTimeout(timeout);
            reject(err);
        });
        child.on('exit', (code) => {
            if (code !== null && code !== 0) {
                clearTimeout(timeout);
                reject(new Error(`Server exited with code ${code}`));
            }
        });
    });
    return {
        port,
        process: child,
        token,
        bootstrapNonce,
        bootstrapUrl: bootstrapUrl(port, bootstrapNonce),
    };
}
async function launchUI(projectPath) {
    const resolvedPath = projectPath || process.cwd();
    const port = 3000;
    console.log('');
    console.log('🐊 NavGator Dashboard');
    console.log(`   Project: ${resolvedPath}`);
    console.log('');
    const { process: serverProcess, bootstrapUrl: url } = await launchWebUI({
        port,
        projectPath: resolvedPath,
    });
    // `url` becomes an argv, so it may only ever carry the SINGLE-USE
    // bootstrap nonce — never the session token. `ps -axww` on macOS shows
    // other users' full argv, so anything here is public to every account on
    // the box; the proxy burns this value on first redemption and expires it
    // after ~5 minutes, so what leaks is worthless by the time it is read.
    console.log(`Dashboard running at: http://localhost:${port}`);
    console.log('');
    console.log('Press Ctrl+C to stop');
    console.log('');
    openInBrowser(url);
    // Keep process running, clean up child on exit
    const cleanup = () => {
        console.log('\nShutting down...');
        serverProcess.kill();
        // The session token must not outlive the server it authenticates.
        deleteDashboardSession();
        // A hard abort mid-signal-handler, not a normal unwind — process.exit()
        // stays here rather than exitCode (see exit-codes.ts's header).
        process.exit(EXIT_CODES.SUCCESS);
    };
    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
}
async function runScan() {
    console.log('NavGator - Scanning architecture...\n');
    const result = await scan(process.cwd(), {
        prompts: true,
        verbose: false,
    });
    if (result.status === 'busy') {
        console.error(`Scan busy: ${result.message}`);
        process.exitCode = EXIT_CODES.NO_DATA;
        return;
    }
    console.log('\n========================================');
    console.log(result.status === 'noop' ? 'SCAN NO CHANGES' : 'SCAN COMPLETE');
    console.log('========================================\n');
    const byType = {};
    for (const c of result.components) {
        byType[c.type] = (byType[c.type] || 0) + 1;
    }
    console.log('COMPONENTS:');
    for (const [type, count] of Object.entries(byType)) {
        console.log(`  ${type}: ${count}`);
    }
    console.log(`\nFiles scanned: ${result.stats.files_scanned}`);
    console.log(`Scan completed in ${result.stats.scan_duration_ms}ms`);
}
async function showStatus() {
    const config = getConfig();
    const index = await loadIndex(config);
    if (!index) {
        console.log('No architecture data found. Run `navgator setup` first.');
        return;
    }
    console.log('NavGator - Architecture Status\n');
    console.log('========================================');
    const lastScan = new Date(index.last_scan);
    const hoursSince = Math.round((Date.now() - index.last_scan) / (1000 * 60 * 60));
    console.log(`Last scan: ${lastScan.toLocaleString()} (${hoursSince}h ago)`);
    console.log(`Total components: ${index.stats.total_components}`);
    console.log(`Total connections: ${index.stats.total_connections}`);
    if (index.stats.outdated_count > 0) {
        console.log(`Outdated packages: ${index.stats.outdated_count}`);
    }
    console.log('\nCOMPONENTS BY TYPE:');
    for (const [type, count] of Object.entries(index.stats.components_by_type)) {
        console.log(`  ${type}: ${count}`);
    }
}
function showPostSetupGuidance() {
    console.log('');
    console.log('  Your architecture dashboard is ready!');
    console.log('');
    console.log('  What NavGator gives you:');
    console.log('    - Interactive SVG diagrams (zoom, pan, click) + Mermaid export');
    console.log('    - LLM call site tracking with provider/model analysis');
    console.log('    - Component & connection maps with code-level evidence');
    console.log('');
    console.log('  Quick reference:');
    console.log('    navgator          Open the welcome menu');
    console.log('    navgator ui       Launch the full dashboard');
    console.log('    navgator scan     Re-scan the project');
    console.log('    navgator diagram  Generate a Mermaid diagram');
    console.log('');
}
export async function showWelcomeMenu(context) {
    if (context === 'no-command') {
        const NAVGATOR_LOGO = `
  _   _             ____       _
 | \\ | | __ ___   _/ ___| __ _| |_ ___  _ __
 |  \\| |/ _\` \\ \\ / / |  _ / _\` | __/ _ \\| '__|
 | |\\  | (_| |\\ V /| |_| | (_| | || (_) | |
 |_| \\_|\\__,_| \\_/  \\____|\\__,_|\\__\\___/|_|

  Architecture Connection Tracker
  Know your stack before you change it
`;
        console.log(NAVGATOR_LOGO);
        console.log('  Tip: Run `navgator ui` to launch the full dashboard.\n');
    }
    console.log('  What would you like to do?\n');
    console.log('  1) Launch the dashboard UI');
    console.log('  2) Run a scan');
    console.log('  3) View project status');
    console.log('  4) Exit');
    console.log('');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise((resolve) => {
        rl.question('  Choose (1-4): ', resolve);
    });
    rl.close();
    switch (answer.trim()) {
        case '1':
            await launchUI();
            break;
        case '2':
            await runScan();
            break;
        case '3':
            await showStatus();
            break;
        default:
            console.log('');
            break;
    }
}
// =============================================================================
// SETUP COMMAND
// =============================================================================
export function registerSetupCommand(program) {
    program
        .command('setup')
        .description('Initialize NavGator with a two-phase scan (fast initial + deep follow-up)')
        .option('-f, --fast', 'Run fast scan only (skip deep analysis)')
        .option('-v, --verbose', 'Show detailed progress')
        .option('--no-diagram', 'Skip diagram generation')
        .action(async (options) => {
        try {
            console.log('');
            console.log('🐊 NavGator - Architecture Connection Tracker');
            console.log('   Know your stack before you change it');
            console.log('');
            // Check if already set up
            const status = await isSetupComplete();
            if (status.hasScanned && !status.stale) {
                console.log('NavGator is already set up for this project.');
                console.log(`Last scan: ${status.lastScan?.toLocaleString()}`);
                console.log(`Scan depth: ${status.phase}`);
                console.log('');
                await showWelcomeMenu('post-setup');
                return;
            }
            // Progress callback
            const onProgress = (phase, message) => {
                const icon = phase === 'FAST' ? '⚡' : '🔍';
                console.log(`${icon} [${phase}] ${message}`);
            };
            // Run setup
            const result = await setup({
                fastOnly: options.fast,
                generateDiagram: options.diagram !== false,
                verbose: options.verbose,
                onProgress,
            });
            // Display results
            console.log(formatSetupStatus(result));
            // Show diagram preview if generated
            if (result.diagram) {
                console.log('Architecture Diagram Preview:');
                console.log('─'.repeat(60));
                // Show first 30 lines
                const lines = result.diagram.split('\n').slice(0, 30);
                console.log(lines.join('\n'));
                if (result.diagram.split('\n').length > 30) {
                    console.log('... (run `navgator diagram` to see full diagram)');
                }
                console.log('');
            }
            // Show post-setup guidance + welcome menu
            showPostSetupGuidance();
            await showWelcomeMenu('post-setup');
        }
        catch (error) {
            console.error('Setup failed:', error);
            process.exitCode = EXIT_CODES.OPERATIONAL;
        }
    });
}
// =============================================================================
// UI COMMAND
// =============================================================================
export function registerUICommand(program) {
    program
        .command('ui')
        .description('Launch the NavGator dashboard in your browser')
        .option('-p, --port <port>', 'Port to serve on', '3000')
        .option('--path <path>', 'Project path to analyze (defaults to current directory)')
        .option('--no-open', 'Don\'t open browser automatically')
        .action(async (options) => {
        try {
            if (isSandboxMode()) {
                console.log('Web UI not available in sandbox mode.');
                return;
            }
            const port = parseInt(options.port, 10);
            const projectPath = options.path
                ? (await import('path')).resolve(options.path)
                : process.cwd();
            console.log('');
            console.log('🐊 NavGator Dashboard');
            console.log(`   Project: ${projectPath}`);
            console.log('');
            const { process: serverProcess, bootstrapUrl: url } = await launchWebUI({
                port,
                projectPath,
            });
            // Nonce, not token — see the identical call site in launchUI() above
            // for why nothing else may go in this URL.
            console.log(`Dashboard running at: http://localhost:${port}`);
            console.log('');
            console.log('Press Ctrl+C to stop');
            console.log('');
            // Try to open browser
            if (options.open !== false) {
                openInBrowser(url);
            }
            else {
                // With no browser launch there is no other way to redeem the
                // nonce, so print it. A terminal is not the process table — this
                // is visible to the invoking user, not to every account on the
                // machine.
                console.log('Open this one-time link to authenticate (valid for 5 minutes, single use):');
                console.log(`  ${url}`);
                console.log('');
            }
            // Keep process running, clean up child on exit
            const cleanup = () => {
                console.log('\nShutting down...');
                serverProcess.kill();
                deleteDashboardSession();
                // Hard abort from a signal handler — see the `ui` cleanup above.
                process.exit(EXIT_CODES.SUCCESS);
            };
            process.on('SIGINT', cleanup);
            process.on('SIGTERM', cleanup);
        }
        catch (error) {
            console.error('Failed to start UI:', error);
            process.exitCode = EXIT_CODES.OPERATIONAL;
        }
    });
}
// =============================================================================
// HISTORY COMMAND
// =============================================================================
export function registerHistoryCommand(program) {
    program
        .command('history')
        .description('Show architecture change timeline')
        .option('--json', 'Output as JSON')
        .option('--agent', 'Output wrapped in agent envelope (implies --json)')
        .option('-n, --limit <n>', 'Show last N entries', '20')
        .option('-s, --significance <level>', 'Filter by significance (major, minor, patch)')
        .action(async (options) => {
        try {
            const { loadTimeline, formatTimeline } = await import('../../diff.js');
            const config = getConfig();
            const timeline = await loadTimeline(config);
            if (options.agent) {
                let entries = [...timeline.entries].reverse();
                if (options.significance) {
                    entries = entries.filter((e) => e.significance === options.significance);
                }
                entries = entries.slice(0, parseInt(options.limit, 10));
                console.log(wrapInEnvelope('history', entries));
                return;
            }
            const output = formatTimeline(timeline, {
                limit: parseInt(options.limit, 10),
                significance: options.significance,
                json: options.json,
            });
            console.log(output);
        }
        catch (error) {
            console.error('Failed to load history:', error);
            process.exitCode = EXIT_CODES.OPERATIONAL;
        }
    });
}
// =============================================================================
// DIFF COMMAND
// =============================================================================
export function registerDiffCommand(program) {
    program
        .command('diff [entry-id]')
        .description('Show detailed architecture diff (most recent if no ID given)')
        .option('--json', 'Output as JSON')
        .option('--agent', 'Output wrapped in agent envelope (implies --json)')
        .action(async (entryId, options) => {
        try {
            const { loadTimeline, formatDiffSummary } = await import('../../diff.js');
            const config = getConfig();
            const timeline = await loadTimeline(config);
            if (timeline.entries.length === 0) {
                console.log('No timeline entries found. Run `navgator scan` at least twice to see diffs.');
                process.exitCode = EXIT_CODES.NO_DATA;
                return;
            }
            let entry;
            if (entryId) {
                entry = timeline.entries.find((e) => e.id === entryId);
                if (!entry) {
                    console.error(`Timeline entry "${entryId}" not found.`);
                    console.log('Available entries:');
                    for (const e of timeline.entries.slice(-5).reverse()) {
                        console.log(`  ${e.id}  (${new Date(e.timestamp).toLocaleString()})`);
                    }
                    process.exitCode = EXIT_CODES.NOT_FOUND;
                    return;
                }
            }
            else {
                entry = timeline.entries[timeline.entries.length - 1];
            }
            if (options.agent) {
                console.log(wrapInEnvelope('diff', entry));
                return;
            }
            console.log(formatDiffSummary(entry, options.json));
        }
        catch (error) {
            console.error('Failed to load diff:', error);
            process.exitCode = EXIT_CODES.OPERATIONAL;
        }
    });
}
// =============================================================================
// PROJECTS COMMAND
// =============================================================================
export function registerProjectsCommand(program) {
    program
        .command('projects')
        .description('List all registered NavGator projects')
        .option('--json', 'Output as JSON')
        .option('--agent', 'Output wrapped in agent envelope (implies --json)')
        .action(async (options) => {
        try {
            const { listProjects, formatProjectsList } = await import('../../projects.js');
            const projects = await listProjects();
            if (options.agent) {
                console.log(wrapInEnvelope('projects', projects));
                return;
            }
            console.log(formatProjectsList(projects, options.json));
        }
        catch (error) {
            console.error('Failed to list projects:', error);
            process.exitCode = EXIT_CODES.OPERATIONAL;
        }
    });
}
// =============================================================================
// REGISTRY-LOG COMMAND
// =============================================================================
const VALID_JOURNAL_ACTORS = ['cli', 'mcp', 'web-route'];
const VALID_JOURNAL_OPS = [
    'load',
    'save',
    'register',
    'update',
    'remove',
    'conflict',
];
function isValidJournalActor(value) {
    return VALID_JOURNAL_ACTORS.includes(value);
}
function isValidJournalOp(value) {
    return VALID_JOURNAL_OPS.includes(value);
}
export function registerRegistryLogCommand(program) {
    program
        .command('registry-log')
        .description('Show recent reads and writes of the project registry')
        .option('--limit <n>', 'Most recent N entries', '50')
        .option('--actor <actor>', 'Filter to cli, mcp, or web-route')
        .option('--op <op>', 'Filter to load, save, register, update, remove, or conflict')
        .option('--conflicts', 'Only lost-update conflict records')
        .option('--json', 'Output as JSON')
        .option('--agent', 'Output wrapped in agent envelope (implies --json)')
        .action(async (options) => {
        try {
            const { readJournal, formatJournal } = await import('../../registry-journal.js');
            if (options.actor && !isValidJournalActor(options.actor)) {
                console.error(`Invalid --actor "${options.actor}". Valid values: ${VALID_JOURNAL_ACTORS.join(', ')}`);
                process.exitCode = EXIT_CODES.USAGE;
                return;
            }
            if (options.op && !isValidJournalOp(options.op)) {
                console.error(`Invalid --op "${options.op}". Valid values: ${VALID_JOURNAL_OPS.join(', ')}`);
                process.exitCode = EXIT_CODES.USAGE;
                return;
            }
            const parsedLimit = Number.parseInt(options.limit, 10);
            const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 50;
            const events = readJournal({
                limit,
                actor: options.actor,
                op: options.op,
                conflictsOnly: Boolean(options.conflicts),
            });
            if (options.agent) {
                console.log(wrapInEnvelope('registry-log', events));
                return;
            }
            if (options.json) {
                console.log(JSON.stringify(events, null, 2));
                return;
            }
            console.log(formatJournal(events, {
                filtered: Boolean(options.actor || options.op || options.conflicts),
            }));
        }
        catch (error) {
            console.error('Failed to load registry journal:', error);
            process.exitCode = EXIT_CODES.OPERATIONAL;
        }
    });
}
// =============================================================================
// SUMMARY COMMAND
// =============================================================================
export function registerSummaryCommand(program) {
    program
        .command('summary')
        .description('Output executive summary with risks, blockers, and next actions (JSON)')
        .option('--agent', 'Wrap output in agent envelope')
        .action(async (options) => {
        try {
            const config = getConfig();
            const components = await loadAllComponents(config);
            const connections = await loadAllConnections(config);
            const projectPath = process.cwd();
            // Try to get git info for context
            const gitInfo = await getGitInfo(projectPath) || undefined;
            const summary = buildExecutiveSummary(components, connections, projectPath, gitInfo);
            if (options.agent) {
                console.log(wrapInEnvelope('summary', summary));
            }
            else {
                console.log(JSON.stringify(summary, null, 2));
            }
        }
        catch (error) {
            console.error('Summary generation failed:', error);
            process.exitCode = EXIT_CODES.OPERATIONAL;
        }
    });
}
//# sourceMappingURL=misc.js.map