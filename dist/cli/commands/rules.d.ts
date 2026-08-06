import { Command } from 'commander';
import { type ReachabilityDiagnostics, type RuleDegeneracyReport, type RuleViolation } from '../../rules.js';
/**
 * Prevalence check over the violations just produced. A rule that fires on most
 * of the codebase is reported as one misconfiguration, not as N findings — see
 * `detectRuleDegeneracy`.
 */
export declare function measureRuleDegeneracy(violations: RuleViolation[], componentCount: number): RuleDegeneracyReport;
/**
 * Warn when reachability analysis ran with a degraded root set.
 *
 * Every way this can go wrong looks identical in the output — a pile of
 * `transitively-dead` findings — so the only way to tell a real result from an
 * analysis pointed at the wrong directory is to say which inputs were found.
 */
export declare function formatReachabilityWarnings(d: ReachabilityDiagnostics): string[];
export declare function buildRulesAgentData(violations: RuleViolation[], rulesChecked: number, severity?: string, degeneracy?: RuleDegeneracyReport, reachability?: ReachabilityDiagnostics): {
    violations: RuleViolation[];
    summary: {
        total: number;
        selected: number;
        returned: number;
        truncated: boolean;
        errors: number;
        warnings: number;
        info: number;
    };
    rules_checked: number;
    degeneracy: RuleDegeneracyReport | null;
    reachability: ReachabilityDiagnostics | null;
    truncation: {
        violations: import("../../types.js").AgentCollectionWindow;
    };
};
export declare function registerRulesCommand(program: Command): void;
//# sourceMappingURL=rules.d.ts.map