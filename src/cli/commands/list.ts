import { Command } from 'commander';
import { loadAllComponents } from '../../storage.js';
import { getConfig } from '../../config.js';
import { wrapInEnvelope } from '../../agent-output.js';
import { mergeComponentAliases } from '../../component-identity.js';
import { EXIT_CODES } from '../exit-codes.js';
import { checkDataAvailability } from './helpers.js';

export function registerListCommand(program: Command): void {
  program
    .command('list')
    .description('List all tracked components')
    .option('-t, --type <type>', 'Filter by type')
    .option('-l, --layer <layer>', 'Filter by layer')
    .option('--json', 'Output as JSON')
    .option('--agent', 'Output wrapped in agent envelope (implies --json)')
    .action(async (options) => {
      try {
        // Must run BEFORE loadAllComponents: checkDataAvailability walks up to
        // the project root and chdir()s there, which is what makes the load
        // return real data when invoked from a subdirectory. `list` and `find`
        // were the only two data commands probing the raw cwd instead, so from
        // `<project>/src` they returned an empty payload while their fourteen
        // siblings returned everything. That was a silent wrong answer before
        // the exit-code contract; once an agent branches on the code it becomes
        // an actively misleading NO_DATA on a project that has been scanned.
        const dataWarning = checkDataAvailability();
        if (dataWarning) {
          console.log(dataWarning);
          process.exitCode = EXIT_CODES.NO_DATA;
          return;
        }

        const config = getConfig();
        let components = await loadAllComponents(config);

        if (options.type) {
          components = components.filter((c) => c.type === options.type);
        }
        if (options.layer) {
          components = components.filter((c) => c.role.layer === options.layer);
        }

        // NO_DATA is decided above by checkDataAvailability(). An empty
        // result from a scan that DID run (e.g. a --type filter matching
        // nothing) is a legitimate empty answer, so it stays SUCCESS.

        if (options.agent) {
          console.log(wrapInEnvelope('list', components));
          return;
        }

        if (options.json) {
          console.log(JSON.stringify(components, null, 2));
          return;
        }

        if (components.length === 0) {
          // The "no NavGator data at all" case already returned above with
          // NO_DATA, so reaching here means a scan ran and tracked nothing.
          console.log('No components found. Try running `navgator scan` to refresh.');
          return;
        }

        // Deduplicate: merge components with same base name + type
        // "Railway Config" and "Railway" → keep the one with more connections
        const dedupedComponents = mergeComponentAliases(components);

        console.log(`NavGator - Components (${dedupedComponents.length})\n`);

        // Group by layer
        const byLayer: Record<string, typeof dedupedComponents> = {};
        for (const c of dedupedComponents) {
          if (!byLayer[c.role.layer]) byLayer[c.role.layer] = [];
          byLayer[c.role.layer].push(c);
        }

        for (const [layer, comps] of Object.entries(byLayer)) {
          console.log(`\n${layer.toUpperCase()}:`);
          for (const c of comps) {
            const version = c.version ? `@${c.version}` : '';
            console.log(`  ${c.name}${version} (${c.type})`);
          }
        }
      } catch (error) {
        console.error('List failed:', error);
        process.exitCode = EXIT_CODES.OPERATIONAL;
      }
    });
}
