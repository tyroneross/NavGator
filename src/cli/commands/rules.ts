import { Command } from 'commander';
import { loadAllComponents, loadAllConnections } from '../../storage.js';
import { getConfig } from '../../config.js';
import { AGENT_OUTPUT_LIMITS, boundAgentCollection, wrapInEnvelope } from '../../agent-output.js';
import {
  checkRules,
  getBuiltinRules,
  loadCustomRules,
  formatRulesOutput,
  type RuleViolation,
} from '../../rules.js';
import { checkDataAvailability } from './helpers.js';

export function buildRulesAgentData(
  violations: RuleViolation[],
  rulesChecked: number,
  severity?: string
) {
  const severityRank = { error: 0, warning: 1, info: 2 } as const;
  const selected = (severity
    ? violations.filter(v => v.severity === severity)
    : [...violations]
  ).sort((a, b) =>
    severityRank[a.severity] - severityRank[b.severity] ||
    a.rule_id.localeCompare(b.rule_id) ||
    (a.component ?? '').localeCompare(b.component ?? '') ||
    a.message.localeCompare(b.message)
  );
  const bounded = boundAgentCollection(selected, AGENT_OUTPUT_LIMITS.commandItems);
  return {
    violations: bounded.items,
    summary: {
      total: violations.length,
      selected: selected.length,
      returned: bounded.truncation.returned,
      truncated: bounded.truncation.truncated,
      errors: violations.filter(v => v.severity === 'error').length,
      warnings: violations.filter(v => v.severity === 'warning').length,
      info: violations.filter(v => v.severity === 'info').length,
    },
    rules_checked: rulesChecked,
    truncation: {
      violations: bounded.truncation,
    },
  };
}

export function registerRulesCommand(program: Command): void {
  program
    .command('rules')
    .description('Check architecture rules and show violations')
    .option('--severity <level>', 'Filter by severity: error, warning, info')
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

        const allRules = [...getBuiltinRules(), ...loadCustomRules()];
        const violations = checkRules(components, connections, allRules);

        if (options.agent) {
          const data = buildRulesAgentData(violations, allRules.length, options.severity);
          console.log(wrapInEnvelope('rules', data));
          return;
        }

        if (options.json) {
          console.log(JSON.stringify({
            violations: options.severity
              ? violations.filter(v => v.severity === options.severity)
              : violations,
            summary: {
              total: violations.length,
              errors: violations.filter(v => v.severity === 'error').length,
              warnings: violations.filter(v => v.severity === 'warning').length,
              info: violations.filter(v => v.severity === 'info').length,
            },
          }, null, 2));
          return;
        }

        console.log(formatRulesOutput(violations, options.severity));
      } catch (error) {
        console.error('Rules check failed:', error);
        process.exit(1);
      }
    });
}
