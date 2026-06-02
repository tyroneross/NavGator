import { Command } from 'commander';
import { spawn } from 'child_process';
import { markDirty } from '../../freshness/dirty-ledger.js';
import { drain } from '../../freshness/drainer.js';
import { computeStamp, readStamp, type FreshnessStamp } from '../../freshness/stamp.js';
import { scan } from '../../scanner.js';

/** Production scanFn: run the real incremental scan; it persists everything. */
const realScan = async (root: string): Promise<void> => {
  await scan(root, {});
};

/** Testable core: append paths to the dirty ledger. */
export function runMarkDirty(paths: string[], root: string): void {
  markDirty(paths, root);
}

/** Testable core: run a drain with the real scanner. */
export async function runDrain(root: string, minIntervalMs?: number) {
  return drain(root, { scanFn: realScan, minIntervalMs });
}

/** Testable core: return the current stamp (computing a transient one if none). */
export async function runFreshness(root: string): Promise<FreshnessStamp> {
  return readStamp(root) ?? (await computeStamp(root, { inFlight: false }));
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
        // Detached + unref so the hook returns immediately (non-blocking).
        const child = spawn(process.execPath, [process.argv[1]!, 'drain'], {
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
    .description('Coalesce the dirty set and run one incremental scan under the single-writer lock')
    .option('--min-interval <ms>', 'Debounce window in ms', (v) => parseInt(v, 10))
    .action(async (options: { minInterval?: number }) => {
      const result = await runDrain(process.cwd(), options.minInterval);
      console.log(JSON.stringify(result));
    });

  program
    .command('freshness')
    .description('Print the freshness stamp for the architecture view (honesty contract)')
    .action(async () => {
      console.log(JSON.stringify(await runFreshness(process.cwd()), null, 2));
    });
}
