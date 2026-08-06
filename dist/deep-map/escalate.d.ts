/**
 * Tier-2 escalation scoring — which components earn a deep, expensive pass.
 *
 * Every input is tier 0, so the score is free to compute, identical on repeat
 * runs, and explainable from numbers rather than from a model's say-so.
 *
 * The design constraint that shapes this file: **degree is counted once.**
 * PageRank is a degree-family centrality, and four builtin rules
 * (`hotspot-module`, `high-fan-out`, `shallow-module`,
 * `single-point-of-failure`) are thresholded degree. Scoring PageRank plus raw
 * fan-in/fan-out plus an unfiltered violation count would be three
 * measurements of one property wearing three weights. So raw degree is not a
 * signal, and `DEGREE_DERIVED_RULE_IDS` is subtracted from the violation count.
 *
 * What remains measures four different things: magnitude (`centrality`), shape
 * (`bridge`), direction/reachability faults (`violations`), semantic surface
 * (`llm_density`), and mass (`size`).
 */
import type { ArchitectureComponent, ArchitectureConnection } from '../types.js';
import type { MetricsReport } from '../metrics/pagerank-louvain.js';
import type { RuleViolation } from '../rules.js';
import { type EscalationResult, type EscalationSignals } from './types.js';
import { type ComponentFilterOptions } from './filter.js';
export interface EscalationOptions extends ComponentFilterOptions {
    threshold?: number;
    maxDeep?: number;
    weights?: EscalationSignals;
}
/**
 * A floor, not a gate. Rank is what selects — the top `maxDeep` components by
 * score are escalated — and this only stops a graph with no meaningful spread
 * from escalating anything.
 *
 * An absolute threshold alone does not survive contact with real graphs. At the
 * 0.60 it started as, NavGator's own 437-component graph escalated nothing: the
 * top score was 0.534, because percentile-based signals compress as node count
 * grows. A cutoff that never fires is a dead feature, and one tuned to this repo
 * would fire wrongly on the next.
 */
export declare const DEFAULT_ESCALATION_FLOOR = 0.4;
/**
 * Percentile of each value within the set, in [0,1]. Ties share the lower rank
 * so equal inputs always score equally — otherwise repeat runs could reorder
 * equal components and change which one escalated.
 */
export declare function percentileIndex(values: Map<string, number>): Map<string, number>;
/** file path -> component_id, tolerating both the wrapped and legacy shapes. */
export declare function normalizeFileMap(raw: unknown): Record<string, string>;
export interface EscalationInputs {
    components: ArchitectureComponent[];
    connections: ArchitectureConnection[];
    metrics: MetricsReport | null;
    violations: RuleViolation[];
    fileMap: Record<string, string>;
}
export declare function scoreEscalation(inputs: EscalationInputs, options?: EscalationOptions): EscalationResult;
//# sourceMappingURL=escalate.d.ts.map