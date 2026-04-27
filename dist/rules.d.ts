/**
 * NavGator Architecture Rules
 * Built-in and custom rule checking for architectural gap detection
 */
import { ArchitectureComponent, ArchitectureConnection } from './types.js';
export interface ArchitectureRule {
    id: string;
    name: string;
    description: string;
    severity: 'error' | 'warning' | 'info';
    check: (components: ArchitectureComponent[], connections: ArchitectureConnection[]) => RuleViolation[];
}
export interface RuleViolation {
    rule_id: string;
    severity: 'error' | 'warning' | 'info';
    component?: string;
    message: string;
    suggestion?: string;
}
/**
 * Get all built-in architecture rules
 */
export declare function getBuiltinRules(): ArchitectureRule[];
/**
 * Load custom rules from .navgator/architecture/rules.json
 */
export declare function loadCustomRules(projectRoot?: string): ArchitectureRule[];
/**
 * Check all rules (builtin + custom) against architecture
 */
export declare function checkRules(components: ArchitectureComponent[], connections: ArchitectureConnection[], rules?: ArchitectureRule[]): RuleViolation[];
/**
 * Format rule violations for human-readable CLI output
 */
export declare function formatRulesOutput(violations: RuleViolation[], filterSeverity?: string): string;
//# sourceMappingURL=rules.d.ts.map