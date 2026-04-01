import { Command } from 'commander';
import { loadAllComponents, loadAllConnections, loadFileMap } from '../../storage.js';
import { getConfig } from '../../config.js';
import { wrapInEnvelope } from '../../agent-output.js';
import { computeCoverage, formatCoverageOutput } from '../../coverage.js';
import { checkDataAvailability } from './helpers.js';

export function registerCoverageCommand(program: Command): void {
  program
    .command('coverage')
    .description('Show architecture tracking coverage and identify gaps')
    .option('--gaps-only', 'Show only gaps')
    .option('--fields', 'Run DB field usage analysis (scans codebase for Prisma field references)')
    .option('--typespec', 'Run TypeSpec validation (compare Prisma types vs TS interfaces)')
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
        const fileMap = await loadFileMap(config);
        const projectRoot = process.cwd();

        const report = await computeCoverage(components, connections, projectRoot, fileMap);

        // --fields: run field usage analysis on-demand
        if (options.fields) {
          const { scanFieldUsage, canAnalyzeFieldUsage, formatFieldUsageReport } = await import('../../scanners/infrastructure/field-usage-analyzer.js');
          if (!canAnalyzeFieldUsage(projectRoot)) {
            console.log('No Prisma schema found — field usage analysis skipped.');
          } else {
            const result = await scanFieldUsage(projectRoot) as { report?: import('../../scanners/infrastructure/field-usage-analyzer.js').FieldUsageReport };
            if (result.report) {
              if (options.agent) {
                console.log(wrapInEnvelope('coverage-fields', result.report));
                return;
              }
              if (options.json) {
                console.log(JSON.stringify(result.report, null, 2));
                return;
              }
              console.log(formatFieldUsageReport(result.report));
            } else {
              console.log('Field usage analysis produced no results.');
            }
            return;
          }
        }

        // --typespec: run TypeSpec validation on-demand
        if (options.typespec) {
          const { scanTypeSpecValidation, canValidateTypeSpec, formatTypeSpecReport } = await import('../../scanners/infrastructure/typespec-validator.js');
          if (!canValidateTypeSpec(projectRoot)) {
            console.log('No Prisma schema found — TypeSpec validation skipped.');
          } else {
            const result = await scanTypeSpecValidation(projectRoot) as { report?: import('../../scanners/infrastructure/typespec-validator.js').TypeSpecReport; warnings: unknown[] };
            if (result.report) {
              if (options.agent) {
                console.log(wrapInEnvelope('coverage-typespec', result.report));
                return;
              }
              if (options.json) {
                console.log(JSON.stringify(result.report, null, 2));
                return;
              }
              console.log(formatTypeSpecReport(result.report));
            } else {
              console.log('TypeSpec validation produced no results.');
            }
            return;
          }
        }

        if (options.agent) {
          console.log(wrapInEnvelope('coverage', report));
          return;
        }

        if (options.json) {
          console.log(JSON.stringify(report, null, 2));
          return;
        }

        console.log(formatCoverageOutput(report, !!options.gapsOnly));
      } catch (error) {
        console.error('Coverage check failed:', error);
        process.exit(1);
      }
    });
}
