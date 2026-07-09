import { Command } from 'commander';
import { spawn } from 'child_process';
import { markDirty } from '../../freshness/dirty-ledger.js';
import { drain, drainUntilClean } from '../../freshness/drainer.js';
import { computeStamp, readStamp, type FreshnessStamp } from '../../freshness/stamp.js';
import { scan } from '../../scanner.js';

/** Production scanFn: run the real incremental scan; it persists everything. */
const realScan = async (root: string) => scan(root, { mode: 'incremental' });

/** Testable core: append paths to the dirty ledger. */
export function runMarkDirty(paths: string[], root: string): void {
  markDirty(paths, root);
}

/** Testable core: run a drain with the real scanner. */
export async function runDrain(root: string, minIntervalMs?: number) {
  return drain(root, { scanFn: realScan, minIntervalMs });
}

/** Testable core: drain repeatedly until the ledger is empty (trailing-edge). */
export async function runDrainUntilClean(root: string, minIntervalMs?: number) {
  return drainUntilClean(root, { scanFn: realScan, minIntervalMs });
}

/** Testable core: return the current stamp (computing a transient one if none). */
export async function runFreshness(root: string): Promise<FreshnessStamp> {
  return readStamp(root) ?? (await computeStamp(root, { inFlight: false }));
}

/**
 * Testable core: populate the enrichment cache by resolving boundary nodes
 * (npm/pip/spm/...) upstream, then return the drift report. This is the
 * network leg of the freshness axis — the offline scan only STAMPS from cache,
 * so this is what makes external enrichment actually resolve. Run it from
 * session-start, a cron, or the external-resolver agent (pinned to haiku).
 */
export async function runRefreshExternal(root: string, force?: boolean) {
  const { loadAllComponents } = await import('../../storage.js');
  const { loadCache } = await import('../../enrich/cache.js');
  const { refreshExternal } = await import('../../enrich/external-resolver.js');
  const components = await loadAllComponents(undefined, root);
  const cache = loadCache();
  return refreshExternal(components, cache, Date.now(), { force });
}

export function registerFreshnessCommands(program: Command): void {
  program
    .command('mark-dirty <paths...>')
    .description('Append changed file paths to the dirty-set ledger (used by the PostToolUse hook)')
    .option('--drain', 'Spawn a detached background drain after marking')
    .action((paths: string[], options: { drain?: boolean }) => {
      const root = process.cwd();
      runMarkDirty(paths, root);
      if (options.drain) {
        // Detached + unref so the hook returns immediately (non-blocking). Uses
        // --until-clean so the trailing edits of a burst still get drained.
        const child = spawn(process.execPath, [process.argv[1]!, 'drain', '--until-clean'], {
          cwd: root,
          detached: true,
          stdio: 'ignore',
        });
        child.unref();
      }
      console.log(JSON.stringify({ ok: true, marked: paths.length }));
    });

  program
    .command('drain')
    .description('Coalesce the dirty set and run an incremental scan under the single-writer lock')
    .option('--min-interval <ms>', 'Debounce window in ms', (v) => parseInt(v, 10))
    .option('--until-clean', 'Keep draining past debounce/busy until the ledger is empty (trailing-edge)')
    .action(async (options: { minInterval?: number; untilClean?: boolean }) => {
      if (options.untilClean) {
        const results = await runDrainUntilClean(process.cwd(), options.minInterval);
        console.log(JSON.stringify({ attempts: results.length, last: results[results.length - 1] }));
        return;
      }
      const result = await runDrain(process.cwd(), options.minInterval);
      console.log(JSON.stringify(result));
    });

  program
    .command('freshness')
    .description('Print the freshness stamp for the architecture view (honesty contract)')
    .action(async () => {
      console.log(JSON.stringify(await runFreshness(process.cwd()), null, 2));
    });

  program
    .command('refresh-external')
    .description('Resolve external boundary nodes (npm/pip/spm/...) upstream and populate the enrichment cache')
    .option('--force', 'Re-check every node, ignoring the freshness window')
    .action(async (options: { force?: boolean }) => {
      const report = await runRefreshExternal(process.cwd(), options.force);
      console.log(JSON.stringify(report, null, 2));
    });
}
