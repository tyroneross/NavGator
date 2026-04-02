import { Command } from 'commander';
import { loadAllComponents, loadAllConnections } from '../../storage.js';
import { getConfig } from '../../config.js';
import { wrapInEnvelope } from '../../agent-output.js';
import { checkDataAvailability } from './helpers.js';

export function registerDeadCommand(program: Command): void {
  program
    .command('dead')
    .description('List potentially dead components — detected but with no connections')
    .option('--json', 'Output as JSON')
    .option('--agent', 'Output wrapped in agent envelope (implies --json)')
    .action(async (options) => {
      try {
        const dataWarning = checkDataAvailability();
        if (dataWarning) {
          console.log(dataWarning);
          return;
        }

        const config = getConfig();
        const components = await loadAllComponents(config);
        const connections = await loadAllConnections(config);

        // Find connected component IDs
        const connectedIds = new Set<string>();
        for (const conn of connections) {
          connectedIds.add(conn.from.component_id);
          connectedIds.add(conn.to.component_id);
        }

        // Orphaned = non-code components with 0 connections
        const orphanTypes = new Set(['npm', 'pip', 'spm', 'queue', 'service', 'llm', 'infra', 'database', 'framework', 'cron', 'config']);
        const orphans = components.filter(c =>
          orphanTypes.has(c.type) &&
          !connectedIds.has(c.component_id) &&
          c.status === 'active'
        );

        if (options.agent) {
          console.log(wrapInEnvelope('dead', orphans));
          return;
        }

        if (options.json) {
          console.log(JSON.stringify(orphans.map(o => ({ name: o.name, type: o.type, layer: o.role.layer })), null, 2));
          return;
        }

        if (orphans.length === 0) {
          console.log('No dead components found. All detected components have connections.');
          return;
        }

        console.log(`NavGator - Dead Components (${orphans.length})\n`);
        console.log('These components were detected but have zero connections.\n');

        // Group by type
        const byType = new Map<string, typeof orphans>();
        for (const o of orphans) {
          if (!byType.has(o.type)) byType.set(o.type, []);
          byType.get(o.type)!.push(o);
        }

        for (const [type, group] of [...byType.entries()].sort((a, b) => b[1].length - a[1].length)) {
          const label = type === 'database' ? 'Unused DB models'
            : type === 'config' ? 'Unused env vars'
            : type === 'queue' ? 'Unused queues'
            : type === 'infra' ? 'Unused infra'
            : type === 'npm' ? 'Unused packages'
            : `Unused ${type}`;

          console.log(`${label} (${group.length}):`);
          for (const o of group.slice(0, 10)) {
            const version = o.version ? `@${o.version}` : '';
            console.log(`  ${o.name}${version}`);
          }
          if (group.length > 10) {
            console.log(`  ... and ${group.length - 10} more`);
          }
          console.log('');
        }
      } catch (error) {
        console.error('Dead code detection failed:', error);
        process.exit(1);
      }
    });
}
