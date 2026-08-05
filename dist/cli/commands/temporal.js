import { getConfig, getStoragePath } from '../../config.js';
import { isInitialized, listSnapshots, findFirstSeen, diffSince, } from '../../temporal/git-store.js';
import { wrapInEnvelope } from '../../agent-output.js';
import { EXIT_CODES } from '../exit-codes.js';
function getStoreDir() {
    return getStoragePath(getConfig());
}
function notInitMsg() {
    return 'No NavGator git history yet. Temporal tracking is opt-in — run `navgator scan --commit` (or set NAVGATOR_COMMIT=1) to start capturing snapshots.';
}
export function registerTemporalCommands(program) {
    // navgator first-seen <query>
    // Pickaxe-style search: when did this string (stable_id, component name, file
    // path, etc.) first appear in any snapshot?
    program
        .command('first-seen <query>')
        .description('Find the first scan that introduced a string (stable_id, name, file path)')
        .option('--json', 'Output as JSON')
        .option('--agent', 'Output wrapped in agent envelope (implies --json)')
        .action((query, options) => {
        const storeDir = getStoreDir();
        if (!isInitialized(storeDir)) {
            console.log(notInitMsg());
            if (options.json || options.agent)
                console.log(JSON.stringify({ query, hit: null }));
            process.exitCode = EXIT_CODES.NO_DATA;
            return;
        }
        const hit = findFirstSeen(storeDir, query);
        // Applied before any output branch so --agent/--json share the
        // human-mode code: a query matching no snapshot is NOT_FOUND.
        if (!hit) {
            process.exitCode = EXIT_CODES.NOT_FOUND;
        }
        if (options.agent) {
            console.log(wrapInEnvelope('first-seen', { query, hit }));
            return;
        }
        if (options.json) {
            console.log(JSON.stringify({ query, hit }, null, 2));
            return;
        }
        if (!hit) {
            console.log(`No snapshot contains "${query}".`);
            return;
        }
        console.log(`First seen in: ${hit.short_sha}`);
        console.log(`  date:    ${hit.date}`);
        console.log(`  message: ${hit.subject}`);
    });
    // navgator changes --since <sha|tag>
    // Diff stat between a past scan and HEAD.
    program
        .command('changes')
        .description('Show file-level changes between a past scan and the current state')
        .requiredOption('--since <ref>', 'Past scan sha (short or full) to compare against HEAD')
        .option('--json', 'Output as JSON')
        .option('--agent', 'Output wrapped in agent envelope (implies --json)')
        .action((options) => {
        const storeDir = getStoreDir();
        if (!isInitialized(storeDir)) {
            console.log(notInitMsg());
            process.exitCode = EXIT_CODES.NO_DATA;
            return;
        }
        const result = diffSince(storeDir, options.since);
        // A failed diff here is git rejecting `--since <ref>` (unknown
        // revision) — a bad argument value, USAGE — not a crash.
        if (!result.ok) {
            process.exitCode = EXIT_CODES.USAGE;
        }
        if (options.agent) {
            console.log(wrapInEnvelope('changes', { since: options.since, ok: result.ok, stat: result.stat, error: result.error }));
            return;
        }
        if (options.json) {
            console.log(JSON.stringify({ since: options.since, ok: result.ok, stat: result.stat, error: result.error }, null, 2));
            return;
        }
        if (!result.ok) {
            console.error(`changes failed: ${result.error}`);
            return;
        }
        if (result.stat.trim() === '') {
            console.log(`No changes since ${options.since}.`);
            return;
        }
        console.log(`Changes since ${options.since}:\n`);
        console.log(result.stat);
    });
    // navgator snapshots — list temporal snapshots (newest first)
    program
        .command('snapshots')
        .description('List temporal snapshots (committed by `navgator scan --commit`)')
        .option('-l, --limit <n>', 'Max snapshots to list', '20')
        .option('--json', 'Output as JSON')
        .option('--agent', 'Output wrapped in agent envelope (implies --json)')
        .action((options) => {
        const storeDir = getStoreDir();
        if (!isInitialized(storeDir)) {
            console.log(notInitMsg());
            if (options.json || options.agent)
                console.log(JSON.stringify({ snapshots: [] }));
            process.exitCode = EXIT_CODES.NO_DATA;
            return;
        }
        const snapshots = listSnapshots(storeDir, Number(options.limit) || 20);
        if (options.agent) {
            console.log(wrapInEnvelope('snapshots', { snapshots }));
            return;
        }
        if (options.json) {
            console.log(JSON.stringify({ snapshots }, null, 2));
            return;
        }
        if (snapshots.length === 0) {
            console.log('No snapshots yet.');
            return;
        }
        console.log(`${snapshots.length} snapshot(s):\n`);
        for (const s of snapshots) {
            console.log(`  ${s.short_sha}  ${s.date}  ${s.subject}`);
        }
    });
}
//# sourceMappingURL=temporal.js.map