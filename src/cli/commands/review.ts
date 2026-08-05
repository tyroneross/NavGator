import { Command } from 'commander';
import { wrapInEnvelope } from '../../agent-output.js';
import { buildReviewReport, formatReviewReport } from '../../review-report.js';
import { checkDataAvailability } from './helpers.js';
import { EXIT_CODES } from '../exit-codes.js';

export function registerReviewCommand(program: Command): void {
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
          process.exitCode = EXIT_CODES.NO_DATA;
          return;
        }

        const report = await buildReviewReport({ component: options.component });

        if ('error' in report) {
          // buildReviewReport's only error case is "no architecture data"
          // (an unresolvable --component is silently ignored, not an
          // error) — NO_DATA, checked defensively in case it and
          // checkDataAvailability above go stale independently.
          console.error(report.error);
          process.exitCode = EXIT_CODES.NO_DATA;
          return;
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
      } catch (error) {
        console.error('Review failed:', error);
        process.exitCode = EXIT_CODES.OPERATIONAL;
      }
    });
}
