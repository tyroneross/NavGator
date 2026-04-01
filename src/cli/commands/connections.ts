import { Command } from 'commander';
import { loadAllComponents, loadAllConnections, loadFileMap } from '../../storage.js';
import { getConfig } from '../../config.js';
import { wrapInEnvelope } from '../../agent-output.js';
import { resolveComponent, findCandidates } from '../../resolve.js';
import { resolveFileConnections, formatFileConnections } from '../../file-resolve.js';

export function registerConnectionsCommand(program: Command): void {
  program
    .command('connections <component>')
    .description('Show all connections for a specific component')
    .option('--json', 'Output as JSON')
    .option('--agent', 'Output wrapped in agent envelope (implies --json)')
    .option('--incoming', 'Show only incoming connections')
    .option('--outgoing', 'Show only outgoing connections')
    .action(async (componentName, options) => {
      try {
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

        const incoming = options.outgoing
          ? []
          : connections.filter((c) => c.to.component_id === component.component_id);

        const outgoing = options.incoming
          ? []
          : connections.filter((c) => c.from.component_id === component.component_id);

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

        if (!options.outgoing && incoming.length > 0) {
          console.log(`\nINCOMING (${incoming.length}):`);
          for (const conn of incoming) {
            const lineInfo = conn.code_reference.line_start ? `:${conn.code_reference.line_start}` : '';
            const symbolInfo = conn.code_reference.symbol ? ` (${conn.code_reference.symbol})` : '';
            console.log(`├── ${conn.connection_type}`);
            console.log(`│   └── ${conn.code_reference.file}${lineInfo}${symbolInfo}`);
          }
        }

        if (!options.incoming && outgoing.length > 0) {
          console.log(`\nOUTGOING (${outgoing.length}):`);
          for (const conn of outgoing) {
            const target = components.find((c) => c.component_id === conn.to.component_id);
            console.log(`├── ${conn.connection_type} → ${target?.name || 'unknown'}`);
          }
        }
      } catch (error) {
        console.error('Connections query failed:', error);
        process.exit(1);
      }
    });
}
