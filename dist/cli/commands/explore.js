import { wrapInEnvelope } from '../../agent-output.js';
import { buildExploreReport, formatExploreReport } from '../../explore-report.js';
import { checkDataAvailability } from './helpers.js';
export function registerExploreCommand(program) {
    program
        .command('explore <component>')
        .description('Investigate a component: runtime identity, impact, connections, data flow')
        .option('--depth <n>', 'Maximum data-flow trace depth', '2')
        .option('--json', 'Output as JSON')
        .option('--agent', 'Output wrapped in agent envelope (implies --json)')
        .action(async (component, options) => {
        try {
            const dataWarning = checkDataAvailability();
            if (dataWarning) {
                console.error(dataWarning);
                process.exit(1);
            }
            const depth = parseInt(options.depth, 10);
            const report = await buildExploreReport(component, {
                depth: Number.isFinite(depth) ? depth : 2,
            });
            if ('error' in report) {
                console.error(report.error);
                process.exit(1);
            }
            if (options.agent) {
                console.log(wrapInEnvelope('explore', report));
                return;
            }
            if (options.json) {
                console.log(JSON.stringify(report, null, 2));
                return;
            }
            console.log(formatExploreReport(report));
        }
        catch (error) {
            console.error('Explore failed:', error);
            process.exit(1);
        }
    });
}
//# sourceMappingURL=explore.js.map