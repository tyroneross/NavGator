import { Command } from 'commander';
import { loadAllComponents, loadAllConnections, loadFileMap } from '../../storage.js';
import { getConfig } from '../../config.js';
import { wrapInEnvelope } from '../../agent-output.js';
import { resolveComponent, findCandidates } from '../../resolve.js';
import { traceDataflow, formatTraceOutput } from '../../trace.js';

export function registerTraceCommand(program: Command): void {
  program
    .command('trace <component>')
    .description('Trace dataflow paths from a component through the architecture')
    .option('--direction <dir>', 'Trace direction: forward, backward, both', 'both')
    .option('--depth <n>', 'Maximum trace depth', '5')
    .option('--max-paths <n>', 'Maximum paths to show (default: 10)')
    .option('--all', 'Show all paths (overrides --max-paths)')
    .option('--production', 'Show only production paths')
    .option('--classification <class>', 'Filter by semantic classification')
    .option('--json', 'Output as JSON')
    .option('--agent', 'Output wrapped in agent envelope (implies --json)')
    .action(async (componentName, options) => {
      try {
        const config = getConfig();
        const components = await loadAllComponents(config);
        const connections = await loadAllConnections(config);
        const fileMap = await loadFileMap(config);

        const component = resolveComponent(componentName, components, fileMap);

        if (!component) {
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

        const result = traceDataflow(component, components, connections, {
          direction: options.direction as 'forward' | 'backward' | 'both',
          maxDepth: parseInt(options.depth, 10),
          filterClassification: options.production ? 'production' : options.classification,
          maxPaths: options.maxPaths ? parseInt(options.maxPaths, 10) : undefined,
          showAll: options.all,
        });

        if (options.agent) {
          console.log(wrapInEnvelope('trace', result));
          return;
        }

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        console.log(formatTraceOutput(result));
      } catch (error) {
        console.error('Trace failed:', error);
        process.exit(1);
      }
    });
}
