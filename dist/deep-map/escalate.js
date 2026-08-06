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
 * (`bridge`), direction/reachability faults (`violations`), and semantic
 * surface (`llm_density`). A fifth, `size`, was designed and then removed —
 * measurement showed a component always maps to exactly one file, so its
 * percentile was constant and its weight could never fire.
 *
 * `DEGREE_DERIVED_RULE_IDS` excludes rules for what they measure. A second,
 * runtime exclusion covers what a rule actually measured *here*: a rule firing
 * on more than half the components scored cannot rank them, so it is withheld
 * from the `violations` signal and named in the manifest. That case is not
 * hypothetical — `transitively-dead` fired on 425 of NavGator's own 451
 * project-authored components (of 521 total; the rest are external packages)
 * while carrying 0.30 of the weight vector, and the near-constant term it
 * contributed was indistinguishable from signal in the output.
 */
import { detectRuleDegeneracy, } from '../rules.js';
import { DEEP_MAP_LIMITS, DEGREE_DERIVED_RULE_IDS, ESCALATION_WEIGHTS, } from './types.js';
import { buildCommunityIndex, buildPagerankIndex } from './partition.js';
import { selectMappableComponents } from './filter.js';
/**
 * A floor, not a gate. Rank is what selects — the top `maxDeep` components by
 * score are escalated — and this only stops a graph with no meaningful spread
 * from escalating anything.
 *
 * An absolute threshold alone does not survive contact with real graphs. At the
 * 0.60 it started as, NavGator's own graph escalated nothing — the top score
 * sits around 0.54 — because percentile-based signals compress as node count
 * grows. A cutoff that never fires is a dead feature, and one tuned to this repo
 * would fire wrongly on the next.
 */
export const DEFAULT_ESCALATION_FLOOR = 0.4;
/** Three or more of a bounded signal saturates it. */
const SATURATION_COUNT = 3;
/** A one- or zero-edge node cannot meaningfully bridge anything. */
const MIN_EDGES_FOR_BRIDGE = 2;
/**
 * Percentile of each value within the set, in [0,1]. Ties share the lower rank
 * so equal inputs always score equally — otherwise repeat runs could reorder
 * equal components and change which one escalated.
 */
export function percentileIndex(values) {
    const entries = [...values.entries()];
    const sorted = [...entries].sort((a, b) => a[1] - b[1]);
    const n = sorted.length;
    const out = new Map();
    if (n === 0)
        return out;
    if (n === 1) {
        out.set(sorted[0][0], 1);
        return out;
    }
    // rank of the first occurrence of each distinct value
    const firstRank = new Map();
    sorted.forEach(([, v], i) => {
        if (!firstRank.has(v))
            firstRank.set(v, i);
    });
    for (const [id, v] of entries) {
        out.set(id, (firstRank.get(v) ?? 0) / (n - 1));
    }
    return out;
}
/** file path -> component_id, tolerating both the wrapped and legacy shapes. */
export function normalizeFileMap(raw) {
    if (!raw || typeof raw !== 'object')
        return {};
    const obj = raw;
    const files = obj['files'];
    if (files && typeof files === 'object')
        return files;
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
        if (typeof v === 'string')
            out[k] = v;
    }
    return out;
}
/**
 * Rule violations name a component by NAME, not by id. Resolving that join can
 * fail (a renamed component, a violation naming a file). Unresolvable
 * violations are counted and reported rather than dropped, so a broken join
 * shows up as a number instead of as a quietly lower score.
 */
function indexViolationsByComponentId(violations, components, excludedRuleIds = new Set()) {
    const idsByName = new Map();
    for (const c of components) {
        const list = idsByName.get(c.name);
        if (list)
            list.push(c.component_id);
        else
            idsByName.set(c.name, [c.component_id]);
    }
    const byId = new Map();
    const histogram = {};
    let unresolved = 0;
    for (const v of violations) {
        if (DEGREE_DERIVED_RULE_IDS.includes(v.rule_id))
            continue;
        if (!v.component) {
            unresolved++;
            continue;
        }
        const ids = idsByName.get(v.component);
        if (!ids || ids.length === 0) {
            unresolved++;
            continue;
        }
        // Counted in the histogram either way — a degenerate rule is disclosed, not
        // erased — but kept out of the per-component list that feeds the score.
        histogram[v.rule_id] = (histogram[v.rule_id] ?? 0) + 1;
        if (excludedRuleIds.has(v.rule_id))
            continue;
        for (const id of ids) {
            const list = byId.get(id);
            if (list)
                list.push(v.rule_id);
            else
                byId.set(id, [v.rule_id]);
        }
    }
    return { byId, unresolved, histogram };
}
/**
 * Which rules are too prevalent to rank by, measured against the components
 * actually scored. This is the runtime counterpart to `DEGREE_DERIVED_RULE_IDS`:
 * that list names rules excluded because of what they measure, this one excludes
 * rules because of what they *did* measure on this graph.
 *
 * The distinct-component count is what the share is taken over, so a rule that
 * emits several violations against one component cannot look prevalent.
 */
function measureDegeneracy(violations, internalNames, population) {
    const seen = new Map();
    for (const v of violations) {
        if (DEGREE_DERIVED_RULE_IDS.includes(v.rule_id))
            continue;
        if (!v.component || !internalNames.has(v.component))
            continue;
        const set = seen.get(v.rule_id);
        if (set)
            set.add(v.component);
        else
            seen.set(v.rule_id, new Set([v.component]));
    }
    const counts = {};
    for (const [ruleId, set] of seen)
        counts[ruleId] = set.size;
    return detectRuleDegeneracy(counts, population);
}
export function scoreEscalation(inputs, options = {}) {
    const threshold = options.threshold ?? DEFAULT_ESCALATION_FLOOR;
    const maxDeep = options.maxDeep ?? DEEP_MAP_LIMITS.maxDeep;
    const weights = options.weights ?? ESCALATION_WEIGHTS;
    // Same mappable set the partitioner uses. Scoring vendored third-party code
    // would spend the four deep slots describing someone else's package: two of
    // this repo's top-ten PageRank nodes are vendored `semver` modules, and four
    // of the top eight once external packages are set aside.
    const internal = selectMappableComponents(inputs.components, options).kept;
    const internalIds = new Set(internal.map((c) => c.component_id));
    const pagerank = buildPagerankIndex(inputs.metrics);
    const community = buildCommunityIndex(inputs.metrics);
    // Group key for the bridge signal. Communities when available, else the
    // coarse role.layer — the shape question survives a suppressed metrics run.
    const groupKey = new Map();
    const usingCommunities = internal.some((c) => community.has(c.component_id));
    for (const c of internal) {
        groupKey.set(c.component_id, usingCommunities ? `c${community.get(c.component_id) ?? -1}` : `l${c.role.layer}`);
    }
    const llmComponentIds = new Set(inputs.components.filter((c) => c.type === 'llm').map((c) => c.component_id));
    // Single pass over edges: edge counts, cross-group counts, LLM call counts.
    const totalEdges = new Map();
    const crossEdges = new Map();
    const llmCalls = new Map();
    for (const conn of inputs.connections) {
        const from = conn.from.component_id;
        const to = conn.to.component_id;
        // `totalEdges` counts INTERNAL edges only, matching the numerator. Counting
        // every edge here would put `uses-package` links to npm in the denominator
        // while the numerator can only ever count internal ones, so a component
        // with many external dependencies would have its bridge score mechanically
        // suppressed — making a signal that claims to be degree-independent
        // sensitive to external fan-out.
        if (internalIds.has(from)) {
            if (groupKey.has(to)) {
                totalEdges.set(from, (totalEdges.get(from) ?? 0) + 1);
                if (groupKey.get(to) !== groupKey.get(from)) {
                    crossEdges.set(from, (crossEdges.get(from) ?? 0) + 1);
                }
            }
            if (conn.connection_type === 'service-call' && llmComponentIds.has(to)) {
                llmCalls.set(from, (llmCalls.get(from) ?? 0) + 1);
            }
        }
        if (internalIds.has(to) && groupKey.has(from)) {
            totalEdges.set(to, (totalEdges.get(to) ?? 0) + 1);
            if (groupKey.get(from) !== groupKey.get(to)) {
                crossEdges.set(to, (crossEdges.get(to) ?? 0) + 1);
            }
        }
    }
    const fileCounts = new Map();
    for (const id of internalIds)
        fileCounts.set(id, 0);
    for (const componentId of Object.values(inputs.fileMap)) {
        if (fileCounts.has(componentId)) {
            fileCounts.set(componentId, (fileCounts.get(componentId) ?? 0) + 1);
        }
    }
    const pagerankForInternal = new Map();
    for (const id of internalIds)
        pagerankForInternal.set(id, pagerank.get(id) ?? 0);
    const pagerankPct = percentileIndex(pagerankForInternal);
    // Measure prevalence first, then score with the degenerate rules withheld.
    // Both passes are over the same violation list, so the histogram reported in
    // the manifest still describes everything that fired.
    const degeneracy = measureDegeneracy(inputs.violations, new Set(internal.map((c) => c.name)), internal.length);
    const degenerateRuleIds = degeneracy.degenerate.map((d) => d.rule_id);
    const { byId: violationsById, unresolved, histogram: violationHistogram, } = indexViolationsByComponentId(inputs.violations, inputs.components, new Set(degenerateRuleIds));
    const ranked = internal.map((c) => {
        const id = c.component_id;
        const edges = totalEdges.get(id) ?? 0;
        const cross = crossEdges.get(id) ?? 0;
        const structural = violationsById.get(id) ?? [];
        const calls = llmCalls.get(id) ?? 0;
        const files = fileCounts.get(id) ?? 0;
        // Dividing cross-edges by total edges is what makes this degree-independent:
        // a two-edge node whose edges both leave its cluster scores the same as a
        // forty-edge node whose edges all leave it.
        const bridge = edges >= MIN_EDGES_FOR_BRIDGE ? cross / edges : 0;
        const signals = {
            centrality: pagerankPct.get(id) ?? 0,
            bridge,
            violations: Math.min(1, structural.length / SATURATION_COUNT),
            llm_density: Math.min(1, calls / SATURATION_COUNT),
        };
        const score = signals.centrality * weights.centrality +
            signals.bridge * weights.bridge +
            signals.violations * weights.violations +
            signals.llm_density * weights.llm_density;
        const raw = {
            pagerank: pagerank.get(id) ?? 0,
            pagerank_percentile: signals.centrality,
            cross_community_edges: cross,
            total_edges: edges,
            structural_violations: structural,
            llm_calls: calls,
            file_count: files,
        };
        const reasons = [];
        if (signals.centrality > 0)
            reasons.push(`centrality ${(signals.centrality * 100).toFixed(0)}th percentile (pagerank ${raw.pagerank.toFixed(4)})`);
        if (signals.bridge > 0)
            reasons.push(`bridges ${cross} of ${edges} edges across ${usingCommunities ? 'communities' : 'layers'}`);
        if (structural.length > 0)
            reasons.push(`${structural.length} structural violation(s): ${structural.join(', ')}`);
        if (calls > 0)
            reasons.push(`${calls} LLM service-call edge(s)`);
        return { component_id: id, name: c.name, score, signals, raw, reasons };
    });
    ranked.sort((a, b) => b.score - a.score || (a.component_id < b.component_id ? -1 : 1));
    const escalated = ranked.filter((r) => r.score >= threshold).slice(0, maxDeep);
    return {
        threshold,
        weights,
        considered: internal.length,
        escalated,
        ranked,
        degree_derived_rules_excluded: DEGREE_DERIVED_RULE_IDS,
        unresolved_violations: unresolved,
        violation_rule_histogram: violationHistogram,
        degenerate_rules_excluded: degenerateRuleIds,
        rule_degeneracy: degeneracy,
    };
}
//# sourceMappingURL=escalate.js.map