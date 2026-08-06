import { Command } from 'commander';
import { type RuleDegeneracyReport, type RuleViolation } from '../../rules.js';
/**
 * Prevalence check over the violations just produced. A rule that fires on most
 * of the codebase is reported as one misconfiguration, not as N findings — see
 * `detectRuleDegeneracy`.
 */
export declare function measureRuleDegeneracy(violations: RuleViolation[], componentCount: number): RuleDegeneracyReport;
export declare function buildRulesAgentData(violations: RuleViolation[], rulesChecked: number, severity?: string, degeneracy?: RuleDegeneracyReport): {
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
    truncation: {
        violations: import("../../types.js").AgentCollectionWindow;
    };
};
export declare function registerRulesCommand(program: Command): void;
//# sourceMappingURL=rules.d.ts.map