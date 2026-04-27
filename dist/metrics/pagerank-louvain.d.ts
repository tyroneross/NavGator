/**
 * PageRank + Louvain community detection over the architecture graph.
 *
 * Computes per-component metrics from the existing JSON component/connection
 * stores, writes a single `metrics.json` keyed by stable_id, and back-writes
 * `pagerank_score` + `community_id` into each component's metadata so any
 * existing consumer that loads a component sees the score.
 *
 * Reproducibility:
 *   - Fixed seed (Mulberry32 RNG) → identical Louvain output on identical input.
 *   - Suppressed for graphs <20 nodes (PageRank degenerate, Louvain over-fits).
 */
import { ArchitectureComponent, ArchitectureConnection, NavGatorConfig } from '../types.js';
export interface ComponentMetric {
    stable_id: string;
    component_id: string;
    name: string;
    pagerank_score: number;
    community_id: number;
}
export interface MetricsReport {
    schema_version: '1.0';
    generated_at: number;
    node_count: number;
    edge_count: number;
    community_count: number;
    modularity: number | null;
    suppressed: boolean;
    reason?: string;
    metrics: ComponentMetric[];
}
/**
 * Build metrics for the current scan. Reads components + connections from
 * disk, computes PageRank + Louvain, writes metrics.json, and patches each
 * component file in place to add `pagerank_score` + `community_id` under
 * its `metadata` field.
 *
 * Returns the report (also written to disk).
 */
export declare function computeAndStoreMetrics(config?: NavGatorConfig, projectRoot?: string, preloaded?: {
    components: ArchitectureComponent[];
    connections: ArchitectureConnection[];
}): Promise<MetricsReport>;
//# sourceMappingURL=pagerank-louvain.d.ts.map