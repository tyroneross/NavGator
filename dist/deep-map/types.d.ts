/**
 * deep-map — tiered escalation mapping.
 *
 * Tier 0 is the deterministic scan and stays the sole authority on what exists.
 * Tiers 1-3 are LLM passes run by the CALLING agent, never by NavGator: this
 * engine emits work packets and validates what comes back. No LLM SDK, no model
 * call, no network. Findings live in their own store and are joined to the graph
 * only at read time, so deleting the deep-map directory leaves tier 0 intact.
 */
import type { ArchitectureLayer, CompactConnection, ComponentType } from '../types.js';
import type { RuleDegeneracyReport } from '../rules.js';
export declare const DEEP_MAP_SCHEMA_VERSION = "1.0";
/** Which pass produced a packet or finding. */
export type DeepMapTier = 1 | 2 | 3;
export declare const DEEP_MAP_LIMITS: {
    /** Max chars for any single finding's text. */
    readonly textLength: 600;
    /** Max evidence entries kept per finding. */
    readonly evidencePerFinding: 5;
    /** Max chars for one evidence string. */
    readonly evidenceLength: 200;
    /** Max findings accepted from one packet result. */
    readonly findingsPerPacket: 40;
    /** Max bytes read from one `*.result.json` file. */
    readonly resultBytes: number;
    /** Max components placed in one tier-1 packet. */
    readonly nodesPerPacket: 60;
    /** Max tier-1 packets emitted without an explicit raise. */
    readonly maxPackets: 12;
    /** Max tier-2 (deep) packets emitted. */
    readonly maxDeep: 4;
    /** Smallest community that earns its own packet; below this it goes residual. */
    readonly minGroup: 3;
};
/**
 * How the graph was split into isolated groups. `community` is the Louvain
 * partition (preferred — it is the graph's own answer to what clusters
 * together, and reproducible under the fixed seed). `layer` is the fallback for
 * graphs too small for metrics, where Louvain is suppressed.
 */
export type PartitionUnit = 'community' | 'layer';
export interface PartitionGroup {
    /** Stable, human-readable: `community-5/part-1`, `layer-backend`, `residual`. */
    label: string;
    unit: PartitionUnit;
    /** Component ids in deterministic order (PageRank desc, stable_id tie-break). */
    component_ids: string[];
    /** True when this group absorbed communities below `minGroup`. */
    residual: boolean;
    /** Set when an oversized group was split; 1-based. */
    part?: number;
    part_count?: number;
    /**
     * Longest common path prefix of the group's components. The cheapest way for
     * a caller to notice that a whole packet is about vendored or generated code
     * before paying for it — offline detection cannot decide that reliably, so
     * this surfaces the evidence instead of guessing.
     */
    path_prefix: string;
    /** Components in this group sitting under a container dir named for a scanned package. */
    suspect_vendored: number;
}
export interface PartitionResult {
    unit: PartitionUnit;
    groups: PartitionGroup[];
    /** Internal components considered (external packages are excluded). */
    considered: number;
    /** Components folded into the residual group. */
    residual_components: number;
    /** Groups dropped because `maxPackets` was reached. */
    truncated: number;
    min_group: number;
    max_nodes_per_packet: number;
    /** Why the unit was chosen — surfaced so a `layer` fallback is never silent. */
    reason: string;
    /** What the mappable-component filter removed, so exclusions are never silent. */
    filter: {
        excluded_vendor: number;
        excluded_glob: number;
        suspect_vendored: number;
        patterns: string[];
    };
}
/**
 * Rules whose check IS a degree threshold. They are excluded from the
 * `violations` signal because PageRank already carries degree; counting them
 * again would let one property supply most of the score while the published
 * weights claim otherwise.
 */
export declare const DEGREE_DERIVED_RULE_IDS: readonly string[];
/**
 * Normalized 0..1 contributions. Keys double as the published weight keys.
 *
 * There is no `size` signal. One was designed and carried a 0.15 weight until
 * measurement killed it: in NavGator's model an internal component IS a file,
 * so every component maps to exactly one path — 451 of 451 on this repo, and
 * the same 1:1 shape in every other scanned repo checked. A percentile over a
 * constant is zero for everyone, so that weight could never fire. Publishing a
 * weight that cannot fire is exactly the fiction the degree-exclusion rule
 * above exists to prevent, so it was removed rather than left in as decoration.
 */
export interface EscalationSignals {
    centrality: number;
    bridge: number;
    violations: number;
    llm_density: number;
}
export declare const ESCALATION_WEIGHTS: EscalationSignals;
/** The numbers behind each signal, so an escalation is falsifiable. */
export interface EscalationRaw {
    pagerank: number;
    pagerank_percentile: number;
    cross_community_edges: number;
    total_edges: number;
    structural_violations: string[];
    llm_calls: number;
    /** Files attributed to the component. Reported, not scored — see EscalationSignals. */
    file_count: number;
}
export interface EscalationScore {
    component_id: string;
    name: string;
    score: number;
    signals: EscalationSignals;
    raw: EscalationRaw;
    /** One line per contributing signal, each citing its number. */
    reasons: string[];
}
export interface EscalationResult {
    threshold: number;
    weights: EscalationSignals;
    considered: number;
    escalated: EscalationScore[];
    /** Scored but below threshold or past `maxDeep`; kept for the report. */
    ranked: EscalationScore[];
    degree_derived_rules_excluded: readonly string[];
    /** Violations whose component name matched no component, so nothing is dropped silently. */
    unresolved_violations: number;
    /**
     * How many components each surviving rule contributed a violation to.
     *
     * Without this the `violations` signal can quietly collapse to a single rule
     * and nobody sees it. That is not hypothetical: `transitively-dead` fired on
     * 425 of NavGator's own 451 project components (~94%) because its entry-point
     * detection had no notion of an npm package's `bin`/`main`/`exports`, so
     * almost everything read as unreachable. A signal that is nearly constant is
     * not measuring anything, and the histogram is what makes that visible in the
     * manifest instead of buried.
     *
     * Counted before degeneracy exclusion, so a rule withheld from the score
     * still appears here.
     */
    violation_rule_histogram: Record<string, number>;
    /**
     * Rules withheld from the `violations` signal this run because they fired on
     * more than `RULE_DEGENERACY_SHARE` of the components scored. The runtime
     * counterpart to `degree_derived_rules_excluded`: that list is fixed by what a
     * rule measures, this one by what it measured here.
     */
    degenerate_rules_excluded: string[];
    /** The prevalence measurement behind that exclusion, so it is falsifiable. */
    rule_degeneracy: RuleDegeneracyReport;
}
export interface DeepMapPacketComponent {
    component_id: string;
    stable_id?: string;
    name: string;
    type: ComponentType;
    layer: ArchitectureLayer;
    files: string[];
}
export interface DeepMapProvenance {
    project_path: string;
    /**
     * `unknown` is the fail-safe answer: it is what `resolveProvenance` returns
     * when the project registry could not be read, and callers must treat it
     * the same as `remote` for trust purposes — a read failure is never grounds
     * to suppress the untrusted-source warning.
     */
    origin: 'local' | 'remote' | 'unknown';
    origin_url?: string;
    /**
     * True when the scanned repo was fetched from a remote, or when provenance
     * could not be determined at all. Component names, file paths, and prompt
     * strings then originate with the remote author (or are of unverified
     * origin), so the packet prompt carries the untrusted-source warning
     * `scan-remote` uses.
     */
    untrusted: boolean;
}
export interface DeepMapPacket {
    schema_version: string;
    packet_id: string;
    run_id: string;
    tier: DeepMapTier;
    group_label: string;
    component_ids: string[];
    components: DeepMapPacketComponent[];
    edges: CompactConnection[];
    /** Ready to send. NavGator owns prompt construction so it stays deterministic. */
    prompt: string;
    response_schema: Record<string, unknown>;
    /** Serialized prompt chars / 4. An estimate, and labelled as one. */
    estimated_input_tokens: number;
    provenance: DeepMapProvenance;
}
export interface DeepMapPacketSummary {
    packet_id: string;
    tier: DeepMapTier;
    group_label: string;
    components: number;
    edges: number;
    estimated_input_tokens: number;
}
export type DeepMapFindingKind = 'purpose' | 'responsibility' | 'concern' | 'inefficiency' | 'risk' | 'cross-cutting';
export interface DeepMapFinding {
    finding_id: string;
    run_id: string;
    packet_id: string;
    tier: DeepMapTier;
    /** Must exist in tier 0. Enforced at ingest; this is the anti-hallucination join. */
    component_id: string;
    component_name: string;
    kind: DeepMapFindingKind;
    text: string;
    evidence: string[];
    confidence: number;
    /** Always `llm` today. Present so a future deterministic producer stays distinguishable. */
    source: 'llm';
    model?: string;
    ingested_at: number;
}
export type DeepMapRejectionReason = 'unknown_component' | 'unknown_packet' | 'malformed_json' | 'schema_violation' | 'missing_evidence' | 'oversized_result' | 'too_many_findings' | 'path_escape';
export interface DeepMapRejection {
    packet_id: string;
    reason: DeepMapRejectionReason;
    detail: string;
}
export interface DeepMapIngestReport {
    schema_version: string;
    run_id: string;
    ingested_at: number;
    packets_seen: number;
    packets_with_results: number;
    accepted: number;
    rejected: number;
    rejections: DeepMapRejection[];
    /** Measured, not estimated. */
    output_bytes: number;
}
export interface DeepMapGraphStats {
    components: number;
    internal_components: number;
    connections: number;
    communities: number;
    metrics_suppressed: boolean;
}
export interface DeepMapCaps {
    max_packets: number;
    max_deep: number;
    truncated: boolean;
    truncation_note?: string;
}
export interface DeepMapCost {
    packets: number;
    estimated_input_tokens: number;
}
export interface DeepMapManifest {
    schema_version: string;
    run_id: string;
    created_at: number;
    project_path: string;
    tiers_planned: DeepMapTier[];
    graph: DeepMapGraphStats;
    partition: {
        unit: PartitionUnit;
        groups: number;
        min_group: number;
        max_nodes_per_packet: number;
        residual_components: number;
        reason: string;
    };
    escalation: EscalationResult | null;
    caps: DeepMapCaps;
    packets: DeepMapPacketSummary[];
    cost: DeepMapCost;
    provenance: DeepMapProvenance;
}
export interface DeepMapReport {
    schema_version: string;
    run_id: string;
    project_path: string;
    graph: DeepMapGraphStats;
    tiers_planned: DeepMapTier[];
    cost: {
        packets_planned: number;
        packets_returned: number;
        estimated_input_tokens: number;
        measured_output_bytes: number;
        findings_accepted: number;
        findings_rejected: number;
    };
    escalation: EscalationScore[];
    findings_by_component: Array<{
        component_id: string;
        component_name: string;
        findings: DeepMapFinding[];
    }>;
    cross_cutting: DeepMapFinding[];
    rejections: DeepMapRejection[];
    provenance: DeepMapProvenance;
    /** Repeated in output so a consumer never mistakes a finding for a scanned fact. */
    note: string;
}
/** Carried into every report and every packet built from a remote clone. */
export declare const UNTRUSTED_SOURCE_NOTE: string;
/** Carried into every report regardless of origin. */
export declare const ATTRIBUTION_NOTE: string;
//# sourceMappingURL=types.d.ts.map