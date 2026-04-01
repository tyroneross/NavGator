import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { loadAllComponents } from '../../storage.js';
import { getConfig } from '../../config.js';
import { wrapInEnvelope } from '../../agent-output.js';

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
        const config = getConfig();
        let components = await loadAllComponents(config);

        if (options.type) {
          components = components.filter((c) => c.type === options.type);
        }
        if (options.layer) {
          components = components.filter((c) => c.role.layer === options.layer);
        }

        if (options.agent) {
          console.log(wrapInEnvelope('list', components));
          return;
        }

        if (options.json) {
          console.log(JSON.stringify(components, null, 2));
          return;
        }

        if (components.length === 0) {
          const cwd = process.cwd();
          const navDir = path.join(cwd, '.navgator', 'architecture');
          if (!fs.existsSync(navDir)) {
            console.log(`No NavGator data in ${cwd}`);
            console.log('Run `navgator scan` first, or `navgator projects` to find scanned projects.');
          } else {
            console.log('No components found. Try running `navgator scan` to refresh.');
          }
          return;
        }

        console.log(`NavGator - Components (${components.length})\n`);

        // Group by layer
        const byLayer: Record<string, typeof components> = {};
        for (const c of components) {
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
        process.exit(1);
      }
    });
}
