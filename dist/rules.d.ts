/**
 * NavGator Architecture Rules
 * Built-in and custom rule checking for architectural gap detection
 */
import { ArchitectureComponent, ArchitectureConnection } from './types.js';
import { type EntryPointSource } from './entry-points.js';
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
 * BFS from entry points through the connection graph. Components unreachable
 * from any entry point are transitively dead.
 *
 * Roots come from `detectEntryPoints`, which reads the package manifest instead
 * of pattern-matching component names — see that module for why the previous
 * root set reported 94% of NavGator's own project-authored components as dead.
 *
 * Two classes are excluded from candidacy rather than from the traversal, so a
 * finding always names something the author could actually delete:
 *
 *   - **Declared dependencies.** A component detected only from a manifest is a
 *     dependency record. It is also a graph sink, so it is unreachable by
 *     construction.
 *   - **Vendored code.** A checked-in copy of someone else's package is
 *     unreachable whenever the copy is loaded by a mechanism the import graph
 *     does not carry, and reporting it tells the author nothing they can act on.
 */
export interface ReachabilityDiagnostics {
    /** How many roots each entry-point source contributed. */
    entry_points: Partial<Record<EntryPointSource, number>>;
    /** Manifests read. Empty here means every declared entry point was missed. */
    manifests: string[];
    /** Manifests that existed but could not be parsed. */
    manifest_errors: string[];
    /** Components reachable from the roots. */
    reachable: number;
    /** Components the rule could have judged. */
    considered: number;
    /**
     * Candidates dropped before judgement, by reason. `vendored` is the one worth
     * watching: `underPackageContainer` matches a `packages/<name>/` directory
     * against scanned external package names, so a first-party monorepo workspace
     * whose name collides with a dependency (`debug`, `chalk`, `semver`) is
     * excluded. That is a deliberate trade — the alternative reports every
     * vendored tree as dead — but it must be a visible one.
     */
    suppressed: {
        vendored: number;
        dependency_manifest: number;
    };
}
/**
 * Reachability diagnostics for the current graph, for surfaces that want to know
 * whether the rule's answer can be trusted.
 *
 * Every silent-degradation mode of this rule is a shrunken root set: the wrong
 * project root, no manifest found, a manifest that would not parse. Each one
 * reproduces the original 94% failure exactly, and each was invisible until this
 * existed — which is how a version of the fix that resolved manifests against
 * the wrong directory shipped and had to be caught by an audit.
 */
export declare function describeReachability(components: ArchitectureComponent[], connections: ArchitectureConnection[], projectRoot?: string): ReachabilityDiagnostics;
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