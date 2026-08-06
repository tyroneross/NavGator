import { Command } from 'commander';
import { loadAllComponents, loadAllConnections } from '../../storage.js';
import { getConfig } from '../../config.js';
import { AGENT_OUTPUT_LIMITS, boundAgentCollection, wrapInEnvelope } from '../../agent-output.js';
import {
  checkRules,
  countComponentsPerRule,
  describeReachability,
  detectRuleDegeneracy,
  getBuiltinRules,
  loadCustomRules,
  formatRulesOutput,
  type ReachabilityDiagnostics,
  type RuleDegeneracyReport,
  type RuleViolation,
} from '../../rules.js';
import { checkDataAvailability } from './helpers.js';
import { EXIT_CODES } from '../exit-codes.js';

/**
 * Prevalence check over the violations just produced. A rule that fires on most
 * of the codebase is reported as one misconfiguration, not as N findings — see
 * `detectRuleDegeneracy`.
 */
export function measureRuleDegeneracy(
  violations: RuleViolation[],
  componentCount: number
): RuleDegeneracyReport {
  return detectRuleDegeneracy(countComponentsPerRule(violations), componentCount);
}

/**
 * Warn when reachability analysis ran with a degraded root set.
 *
 * Every way this can go wrong looks identical in the output — a pile of
 * `transitively-dead` findings — so the only way to tell a real result from an
 * analysis pointed at the wrong directory is to say which inputs were found.
 */
export function formatReachabilityWarnings(d: ReachabilityDiagnostics): string[] {
  const lines: string[] = [];
  const roots = Object.values(d.entry_points).reduce((sum, n) => sum + (n ?? 0), 0);

  if (d.manifest_errors.length > 0) {
    lines.push(
      `UNREADABLE MANIFEST: ${d.manifest_errors.join(', ')}. ` +
        `Entry points declared there were not found, so reachability is understated.`
    );
  }
  if (d.manifests.length === 0 && d.considered > 0) {
    lines.push(
      `NO PACKAGE MANIFEST FOUND. Reachability used conventions only, so any ` +
        `entry point declared in package.json bin/main/exports/scripts was missed. ` +
        `If this project is an npm package, check the directory being analysed.`
    );
  }
  if (roots === 0 && d.considered > 0) {
    lines.push('NO ENTRY POINTS FOUND. Reachability could not run; no component was judged.');
  }
  if (d.suppressed.vendored > 0) {
    lines.push(
      `${d.suppressed.vendored} component(s) skipped as vendored third-party code. ` +
        `A first-party directory under packages/ whose name matches a dependency is ` +
        `skipped by the same test.`
    );
  }
  return lines;
}

export function buildRulesAgentData(
  violations: RuleViolation[],
  rulesChecked: number,
  severity?: string,
  degeneracy?: RuleDegeneracyReport,
  reachability?: ReachabilityDiagnostics
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
    // Present on every run so a consumer can branch on it without probing.
    // `degenerate: []` is the healthy answer, not a missing field.
    degeneracy: degeneracy ?? null,
    // Where the dead-code roots came from. A caller cannot tell a clean graph
    // from a graph analysed against the wrong directory without this.
    reachability: reachability ?? null,
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
          process.exitCode = EXIT_CODES.NO_DATA;
          return;
        }
        const config = getConfig();
        const components = await loadAllComponents(config);
        const connections = await loadAllConnections(config);

        const allRules = [...getBuiltinRules(), ...loadCustomRules()];
        const violations = checkRules(components, connections, allRules);
        const degeneracy = measureRuleDegeneracy(violations, components.length);
        const reachability = describeReachability(components, connections);

        if (options.agent) {
          const data = buildRulesAgentData(
            violations,
            allRules.length,
            options.severity,
            degeneracy,
            reachability
          );
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
            degeneracy,
            reachability,
          }, null, 2));
          return;
        }

        console.log(formatRulesOutput(violations, options.severity));
        for (const warning of degeneracy.warnings) {
          console.log(`\nDEGENERATE RULE: ${warning}`);
        }
        for (const line of formatReachabilityWarnings(reachability)) {
          console.log(`\n${line}`);
        }
      } catch (error) {
        console.error('Rules check failed:', error);
        process.exitCode = EXIT_CODES.OPERATIONAL;
      }
    });
}
