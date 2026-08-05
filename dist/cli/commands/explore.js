import { wrapInEnvelope } from '../../agent-output.js';
import { buildExploreReport, formatExploreReport } from '../../explore-report.js';
import { checkDataAvailability } from './helpers.js';
import { EXIT_CODES } from '../exit-codes.js';
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
                process.exitCode = EXIT_CODES.NO_DATA;
                return;
            }
            const depth = parseInt(options.depth, 10);
            const report = await buildExploreReport(component, {
                depth: Number.isFinite(depth) ? depth : 2,
            });
            if ('error' in report) {
                console.error(report.error);
                // buildExploreReport's own error shape distinguishes "no
                // architecture data" (already handled above via
                // checkDataAvailability, but defensively re-checked here in case
                // the two go stale independently) from "component not found".
                process.exitCode = report.error.startsWith('No architecture data')
                    ? EXIT_CODES.NO_DATA
                    : EXIT_CODES.NOT_FOUND;
                return;
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
            process.exitCode = EXIT_CODES.OPERATIONAL;
        }
    });
}
//# sourceMappingURL=explore.js.map