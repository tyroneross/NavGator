import { Command } from 'commander';
import { loadAllComponents, loadAllConnections, loadFileMap } from '../../storage.js';
import { getConfig } from '../../config.js';
import { wrapInEnvelope } from '../../agent-output.js';
import { resolveComponent, findCandidates } from '../../resolve.js';
import { resolveFileConnections, formatFileConnections } from '../../file-resolve.js';
import { checkDataAvailability } from './helpers.js';

export function registerConnectionsCommand(program: Command): void {
  program
    .command('connections <component>')
    .description('Show all connections for a specific component')
    .option('--json', 'Output as JSON')
    .option('--agent', 'Output wrapped in agent envelope (implies --json)')
    .option('--incoming', 'Show only incoming connections')
    .option('--outgoing', 'Show only outgoing connections')
    .option('--production', 'Show only production connections')
    .option('--test', 'Show only test connections')
    .action(async (componentName, options) => {
      try {
        const dataWarning = checkDataAvailability();
        if (dataWarning) {
          console.log(dataWarning);
          return;
        }
        const config = getConfig();
        const components = await loadAllComponents(config);
        const connections = await loadAllConnections(config);
        const fileMap = await loadFileMap(config);

        const component = resolveComponent(componentName, components, fileMap);

        if (!component) {
          // Fall back to file-level connections
          const { looksLikeFilePath } = await import('../../file-resolve.js');
          if (looksLikeFilePath(componentName)) {
            const fc = resolveFileConnections(componentName, connections);
            if (fc) {
              if (options.agent) {
                console.log(wrapInEnvelope('connections', fc));
                return;
              }
              if (options.json) {
                console.log(JSON.stringify(fc, null, 2));
                return;
              }
              console.log(formatFileConnections(fc));
              return;
            }
          }

          console.log(`Component "${componentName}" not found.`);
          const candidates = findCandidates(componentName, components);
          if (candidates.length > 0) {
            console.log('\nDid you mean:');
            for (const name of candidates) {
              console.log(`  - ${name}`);
            }
          }
          return;
        }

        // Apply classification filter
        let filteredConns = connections;
        if (options.production) {
          // Production = explicitly production + unknown/unclassified (not test/dev/migration)
          filteredConns = connections.filter(c => {
            const cls = (c as any).semantic?.classification;
            return !cls || cls === 'production' || cls === 'unknown' || cls === 'admin' || cls === 'analytics';
          });
        } else if (options.test) {
          filteredConns = connections.filter(c => {
            const cls = (c as any).semantic?.classification;
            return cls === 'test' || cls === 'dev-only';
          });
        }

        const incoming = options.outgoing
          ? []
          : filteredConns.filter((c) => c.to.component_id === component.component_id);

        const outgoing = options.incoming
          ? []
          : filteredConns.filter((c) => c.from.component_id === component.component_id);

        if (options.agent) {
          console.log(wrapInEnvelope('connections', { component, incoming, outgoing }));
          return;
        }

        if (options.json) {
          console.log(JSON.stringify({ component, incoming, outgoing }, null, 2));
          return;
        }

        console.log(`NavGator - Connections: ${component.name}\n`);
        console.log('========================================');
        console.log(`Component: ${component.name} (${component.type})`);
        console.log(`Layer: ${component.role.layer}`);

        // Classification badge helper
        const badge = (conn: typeof incoming[0]) => {
          const cls = (conn as any).semantic?.classification;
          if (!cls || cls === 'production') return '';
          return ` [${cls}]`;
        };

        if (!options.outgoing && incoming.length > 0) {
          console.log(`\nINCOMING (${incoming.length}):`);
          for (const conn of incoming) {
            const lineInfo = conn.code_reference.line_start ? `:${conn.code_reference.line_start}` : '';
            const symbolInfo = conn.code_reference.symbol ? ` (${conn.code_reference.symbol})` : '';
            console.log(`├── ${conn.connection_type}${badge(conn)}`);
            console.log(`│   └── ${conn.code_reference.file}${lineInfo}${symbolInfo}`);
          }
        }

        if (!options.incoming && outgoing.length > 0) {
          console.log(`\nOUTGOING (${outgoing.length}):`);
          for (const conn of outgoing) {
            const target = components.find((c) => c.component_id === conn.to.component_id);
            let targetName = target?.name || 'unknown';
            if (targetName === 'unknown' && conn.to.component_id?.startsWith('FILE:')) {
              targetName = conn.to.component_id.slice(5);
            }
            const lineInfo = conn.code_reference?.line_start ? `:${conn.code_reference.line_start}` : '';
            console.log(`├── ${conn.connection_type}${badge(conn)} → ${targetName}${lineInfo}`);
          }
        }
      } catch (error) {
        console.error('Connections query failed:', error);
        process.exit(1);
      }
    });
}
