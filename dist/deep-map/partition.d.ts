/**
 * Component isolation — split the deterministic graph into groups a single
 * cheap agent can hold at once.
 *
 * The isolation unit is the Louvain community: it is the graph's own answer to
 * what clusters together, it is already computed, and the fixed Mulberry32 seed
 * makes it reproducible. Alternatives considered and why they lost:
 *
 *   - **Directory prefix.** Stable across scans and needs no metrics, but it
 *     encodes the layout the author already chose. A mapping pass that mirrors
 *     the folder tree cannot tell you the folder tree is wrong.
 *   - **`role.layer`.** Seven coarse buckets, two of which hold all but a
 *     handful of this repo's components, so it partitions almost nothing. Kept as the fallback
 *     for graphs where Louvain is suppressed.
 *   - **Import-closure BFS from every node** (`extractSubgraph`). Produces
 *     overlapping neighbourhoods, so components get described repeatedly and
 *     cost scales with node count rather than cluster count.
 *   - **Strongly-connected components.** On a healthy import graph almost every
 *     SCC is a single node; it finds cycles, not clusters.
 *
 * Two measured properties of real graphs force the rest of this module. The
 * figures below are a point-in-time measurement of NavGator's own graph
 * (~507 components, modularity ~0.66) taken from `.navgator/`, which is
 * gitignored and shifts as the repo changes — they illustrate the shape of the
 * problem, they are not repository constants:
 *
 *   - Communities are heavily skewed: ~50 of them, most holding a single node,
 *     while six hold roughly 440. A packet per community would emit
 *     mostly-empty work, so communities under `minGroup` are bundled into one
 *     residual packet.
 *   - Around 70 of the internal `type: 'component'` nodes are vendored
 *     third-party source. `selectMappableComponents` handles that; see
 *     `filter.ts`.
 *
 * Known limitation, stated because it bounds what the partition means:
 * `computeAndStoreMetrics` runs Louvain over the *full* graph including external
 * packages, so packet membership is the internal projection of a partition that
 * external hubs helped shape. It is the graph's clustering, not the internal
 * subgraph's optimal clustering.
 */
import type { ArchitectureComponent, ArchitectureConnection } from '../types.js';
import type { MetricsReport } from '../metrics/pagerank-louvain.js';
import { type ComponentFilterOptions } from './filter.js';
import { type PartitionResult } from './types.js';
export interface PartitionOptions extends ComponentFilterOptions {
    minGroup?: number;
    maxNodesPerPacket?: number;
    maxPackets?: number;
}
/** component_id -> pagerank, from metrics.json. Missing entries score 0. */
export declare function buildPagerankIndex(metrics: MetricsReport | null): Map<string, number>;
/** component_id -> community_id. Empty when metrics were suppressed. */
export declare function buildCommunityIndex(metrics: MetricsReport | null): Map<string, number>;
/**
 * Longest common directory prefix across a group's file paths. Returns `''`
 * when the group spans unrelated trees, which is itself informative.
 */
export declare function commonPathPrefix(paths: string[]): string;
/**
 * Split an oversized group into parts that are still connected.
 *
 * Slicing the PageRank ordering would be simpler and wrong: part 1 would be the
 * community's top-60 nodes and part 2 the remainder, and the two parts would
 * share most of their edges — destroying the isolation the split exists to
 * preserve. On this repo that would have applied to the two largest communities
 * (108 and 91 internal nodes), roughly 45% of tier-1 coverage.
 *
 * Instead each part is grown by breadth-first search from the highest-PageRank
 * unvisited node, expanding neighbours in PageRank order. Deterministic given
 * the same graph and the same metrics.
 */
export declare function splitConnected(members: ArchitectureComponent[], connections: ArchitectureConnection[], pagerank: Map<string, number>, maxNodesPerPacket: number): string[][];
/**
 * Partition mappable components into packet-sized groups.
 *
 * Falls back from `community` to `layer` when metrics are suppressed (graphs
 * under 20 nodes, where Louvain over-fits). The fallback is recorded in
 * `reason` so it is never silent.
 */
export declare function partitionComponents(components: ArchitectureComponent[], connections: ArchitectureConnection[], metrics: MetricsReport | null, options?: PartitionOptions): PartitionResult;
//# sourceMappingURL=partition.d.ts.map