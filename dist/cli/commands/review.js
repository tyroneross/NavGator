import { wrapInEnvelope } from '../../agent-output.js';
import { buildReviewReport, formatReviewReport } from '../../review-report.js';
import { checkDataAvailability } from './helpers.js';
export function registerReviewCommand(program) {
    program
        .command('review')
        .description('Architectural integrity review: rule violations, runtime topology, LLM use cases')
        .option('--component <name>', 'Focus the review on one component\'s impact')
        .option('--json', 'Output as JSON')
        .option('--agent', 'Output wrapped in agent envelope (implies --json)')
        .action(async (options) => {
        try {
            const dataWarning = checkDataAvailability();
            if (dataWarning) {
                console.error(dataWarning);
                process.exit(1);
            }
            const report = await buildReviewReport({ component: options.component });
            if ('error' in report) {
                console.error(report.error);
                process.exit(1);
            }
            if (options.agent) {
                console.log(wrapInEnvelope('review', report));
                return;
            }
            if (options.json) {
                console.log(JSON.stringify(report, null, 2));
                return;
            }
            console.log(formatReviewReport(report));
        }
        catch (error) {
            console.error('Review failed:', error);
            process.exit(1);
        }
    });
}
//# sourceMappingURL=review.js.map