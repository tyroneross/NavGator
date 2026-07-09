import { Command } from 'commander';
import { type RuleViolation } from '../../rules.js';
export declare function buildRulesAgentData(violations: RuleViolation[], rulesChecked: number, severity?: string): {
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
    truncation: {
        violations: import("../../types.js").AgentCollectionWindow;
    };
};
export declare function registerRulesCommand(program: Command): void;
//# sourceMappingURL=rules.d.ts.map