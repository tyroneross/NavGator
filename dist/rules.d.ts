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
 * Get all built-in architecture rules.
 *
 * `projectRoot` is used by reachability analysis to read the package manifests
 * that declare a project's entry points. It defaults to `process.cwd()`, the
 * same default `loadCustomRules` uses.
 */
export declare function getBuiltinRules(projectRoot?: string): ArchitectureRule[];
/**
 * A rule firing on more than this share of the components it could apply to is
 * treated as degenerate. The bound is a discrimination argument, not a taste
 * one: a flag present on most of the population cannot separate that population,
 * so ranking by it ranks by noise. `transitively-dead` sat at 0.94 on
 * NavGator's own graph and nothing in the output said so.
 */
export declare const RULE_DEGENERACY_SHARE = 0.5;
/** Minimum population before the share is meaningful — 3 of 4 is not a signal. */
export declare const RULE_DEGENERACY_MIN_POPULATION = 20;
export interface DegenerateRule {
    rule_id: string;
    /** Components this rule flagged. */
    components: number;
    /** components / population. */
    share_of_components: number;
    /** This rule's violations / all violations counted. */
    share_of_violations: number;
}
export interface RuleDegeneracyReport {
    population: number;
    total_violations: number;
    threshold: number;
    degenerate: DegenerateRule[];
    /** One line per degenerate rule, ready to print. */
    warnings: string[];
}
/**
 * Find rules so prevalent they cannot discriminate.
 *
 * `counts` maps rule_id to the number of distinct components that rule flagged;
 * `population` is how many components the rules ran against. The histogram this
 * consumes already exists in the deep-map manifest — this is what makes it
 * assert something instead of merely being available for inspection.
 */
export declare function detectRuleDegeneracy(counts: Record<string, number>, population: number, threshold?: number): RuleDegeneracyReport;
/**
 * Count distinct components per rule from a violation list, the shape
 * `detectRuleDegeneracy` expects.
 */
export declare function countComponentsPerRule(violations: RuleViolation[]): Record<string, number>;
/**
 * Load custom rules from .navgator/architecture/rules.json
 */
export declare function loadCustomRules(projectRoot?: string): ArchitectureRule[];
/**
 * Check all rules (builtin + custom) against architecture
 */
export declare function checkRules(components: ArchitectureComponent[], connections: ArchitectureConnection[], rules?: ArchitectureRule[], projectRoot?: string): RuleViolation[];
/**
 * Format rule violations for human-readable CLI output
 */
export declare function formatRulesOutput(violations: RuleViolation[], filterSeverity?: string): string;
//# sourceMappingURL=rules.d.ts.map