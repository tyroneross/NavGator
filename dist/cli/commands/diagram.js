import * as fs from 'fs';
import { loadGraph, loadAllComponents, loadFileMap } from '../../storage.js';
import { getConfig } from '../../config.js';
import { generateMermaidDiagram, generateComponentDiagram, generateLayerDiagram, generateSummaryDiagram, wrapInMarkdown, } from '../../diagram.js';
import { resolveComponent, findCandidates } from '../../resolve.js';
import { checkDataAvailability } from './helpers.js';
export function registerDiagramCommand(program) {
    program
        .command('diagram')
        .description('Generate a Mermaid diagram of the architecture')
        .option('-f, --focus <component>', 'Center diagram on a specific component')
        .option('-l, --layer <layer>', 'Show only a specific layer')
        .option('-s, --summary', 'Show only top connected components')
        .option('-d, --direction <dir>', 'Diagram direction: TB, BT, LR, RL', 'TB')
        .option('--no-styles', 'Disable color styling')
        .option('--no-labels', 'Hide connection labels')
        .option('-o, --output <file>', 'Save to file instead of stdout')
        .option('-m, --max-nodes <n>', 'Maximum nodes to show', '50')
        .option('--markdown', 'Wrap diagram in markdown code block')
        .action(async (options) => {
        try {
            const dataWarning = checkDataAvailability();
            if (dataWarning) {
                console.log(dataWarning);
                return;
            }
            const config = getConfig();
            const graph = await loadGraph(config);
            if (!graph) {
                console.error('No architecture data found. Run `navgator scan` first.');
                process.exit(1);
            }
            const diagramOpts = {
                direction: options.direction,
                includeStyles: options.styles !== false,
                showLabels: options.labels !== false,
                maxNodes: parseInt(options.maxNodes, 10),
            };
            let diagram;
            if (options.focus) {
                // Resolve component by name, file path, or partial match
                const components = await loadAllComponents(config);
                const fileMap = await loadFileMap(config);
                const component = resolveComponent(options.focus, components, fileMap);
                if (!component) {
                    console.error(`Component "${options.focus}" not found.`);
                    const candidates = findCandidates(options.focus, components);
                    if (candidates.length > 0) {
                        console.log('Did you mean:');
                        for (const name of candidates) {
                            console.log(`  - ${name}`);
                        }
                    }
                    else {
                        console.log('Available components:');
                        for (const c of components.slice(0, 10)) {
                            console.log(`  - ${c.name}`);
                        }
                    }
                    process.exit(1);
                }
                diagram = generateComponentDiagram(graph, component.component_id, 2, diagramOpts);
            }
            else if (options.layer) {
                const validLayers = ['frontend', 'backend', 'database', 'queue', 'infra', 'external'];
                if (!validLayers.includes(options.layer)) {
                    console.error(`Invalid layer "${options.layer}". Valid layers: ${validLayers.join(', ')}`);
                    process.exit(1);
                }
                diagram = generateLayerDiagram(graph, options.layer, diagramOpts);
            }
            else if (options.summary) {
                diagram = generateSummaryDiagram(graph, { ...diagramOpts, maxNodes: 20 });
            }
            else {
                diagram = generateMermaidDiagram(graph, diagramOpts);
            }
            // Optionally wrap in markdown
            if (options.markdown) {
                const title = options.focus
                    ? `Architecture: ${options.focus}`
                    : options.layer
                        ? `${options.layer} Layer`
                        : 'Architecture Diagram';
                diagram = wrapInMarkdown(diagram, title);
            }
            // Output
            if (options.output) {
                await fs.promises.writeFile(options.output, diagram, 'utf-8');
                console.log(`Diagram saved to ${options.output}`);
            }
            else {
                console.log(diagram);
            }
        }
        catch (error) {
            console.error('Diagram generation failed:', error);
            process.exit(1);
        }
    });
}
//# sourceMappingURL=diagram.js.map