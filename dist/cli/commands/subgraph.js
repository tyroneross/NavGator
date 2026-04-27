import { loadAllComponents, loadAllConnections } from '../../storage.js';
import { getConfig } from '../../config.js';
import { wrapInEnvelope } from '../../agent-output.js';
import { extractSubgraph, subgraphToMermaid } from '../../subgraph.js';
import { checkDataAvailability } from './helpers.js';
export function registerSubgraphCommand(program) {
    program
        .command('subgraph')
        .description('Extract a focused subgraph from the architecture')
        .option('--focus <components>', 'Comma-separated component names to focus on')
        .option('--layer <layers>', 'Comma-separated layers to include')
        .option('--classification <class>', 'Filter connections by semantic classification')
        .option('--depth <n>', 'BFS depth from focus components', '2')
        .option('--max-nodes <n>', 'Maximum nodes in subgraph', '50')
        .option('--format <fmt>', 'Output format: json, mermaid', 'json')
        .option('--json', 'Output as JSON (same as --format json)')
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
            const subgraphOpts = {
                focus: options.focus ? options.focus.split(',').map((s) => s.trim()) : undefined,
                layers: options.layer
                    ? options.layer.split(',').map((s) => s.trim())
                    : undefined,
                classification: options.classification,
                depth: parseInt(options.depth, 10),
                maxNodes: parseInt(options.maxNodes, 10),
            };
            const result = extractSubgraph(components, connections, subgraphOpts);
            if (options.agent) {
                console.log(wrapInEnvelope('subgraph', result));
                return;
            }
            if (options.format === 'mermaid') {
                console.log(subgraphToMermaid(result));
                return;
            }
            // Default: JSON
            console.log(JSON.stringify(result, null, 2));
        }
        catch (error) {
            console.error('Subgraph extraction failed:', error);
            process.exit(1);
        }
    });
}
//# sourceMappingURL=subgraph.js.map