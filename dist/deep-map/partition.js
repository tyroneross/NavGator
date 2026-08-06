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
 *   - **`role.layer`.** Seven coarse buckets; on this repo two of them hold 493
 *     of 507 components, so it partitions almost nothing. Kept as the fallback
 *     for graphs where Louvain is suppressed.
 *   - **Import-closure BFS from every node** (`extractSubgraph`). Produces
 *     overlapping neighbourhoods, so components get described repeatedly and
 *     cost scales with node count rather than cluster count.
 *   - **Strongly-connected components.** On a healthy import graph almost every
 *     SCC is a single node; it finds cycles, not clusters.
 *
 * Two measured properties of real graphs force the rest of this module, both
 * from NavGator itself (507 components, modularity 0.657):
 *
 *   - Communities are heavily skewed: 48 of them, ~35 singletons, six holding
 *     442 nodes. A packet per community would emit mostly-empty work, so
 *     communities under `minGroup` are bundled into one residual packet.
 *   - 72 of the 437 `type: 'component'` nodes are vendored third-party source.
 *     `selectMappableComponents` handles that; see `filter.ts`.
 *
 * Known limitation, stated because it bounds what the partition means:
 * `computeAndStoreMetrics` runs Louvain over the *full* graph including external
 * packages, so packet membership is the internal projection of a partition that
 * external hubs helped shape. It is the graph's clustering, not the internal
 * subgraph's optimal clustering.
 */
import { componentPaths, selectMappableComponents } from './filter.js';
import { DEEP_MAP_LIMITS, } from './types.js';
/** component_id -> pagerank, from metrics.json. Missing entries score 0. */
export function buildPagerankIndex(metrics) {
    const index = new Map();
    if (!metrics || metrics.suppressed)
        return index;
    for (const m of metrics.metrics)
        index.set(m.component_id, m.pagerank_score);
    return index;
}
/** component_id -> community_id. Empty when metrics were suppressed. */
export function buildCommunityIndex(metrics) {
    const index = new Map();
    if (!metrics || metrics.suppressed)
        return index;
    for (const m of metrics.metrics)
        index.set(m.component_id, m.community_id);
    return index;
}
function orderComponents(components, pagerank) {
    return [...components].sort((a, b) => {
        const pa = pagerank.get(a.component_id) ?? 0;
        const pb = pagerank.get(b.component_id) ?? 0;
        if (pb !== pa)
            return pb - pa;
        const sa = a.stable_id || a.component_id;
        const sb = b.stable_id || b.component_id;
        return sa < sb ? -1 : sa > sb ? 1 : 0;
    });
}
/**
 * Longest common directory prefix across a group's file paths. Returns `''`
 * when the group spans unrelated trees, which is itself informative.
 */
export function commonPathPrefix(paths) {
    if (paths.length === 0)
        return '';
    const split = paths.map((p) => p.split('/'));
    const first = split[0];
    let depth = first.length;
    for (const segs of split) {
        let i = 0;
        while (i < depth && i < segs.length && segs[i] === first[i])
            i++;
        depth = i;
    }
    // Drop a trailing filename: a prefix should name a directory.
    const prefix = first.slice(0, depth);
    if (prefix.length > 0 && paths.every((p) => p !== prefix.join('/')) && prefix.at(-1).includes('.')) {
        prefix.pop();
    }
    return prefix.join('/');
}
/** Undirected adjacency restricted to the given id set. */
function buildAdjacency(ids, connections) {
    const adj = new Map();
    for (const id of ids)
        adj.set(id, new Set());
    for (const conn of connections) {
        const from = conn.from.component_id;
        const to = conn.to.component_id;
        if (from === to)
            continue;
        if (ids.has(from) && ids.has(to)) {
            adj.get(from).add(to);
            adj.get(to).add(from);
        }
    }
    return adj;
}
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
export function splitConnected(members, connections, pagerank, maxNodesPerPacket) {
    const ordered = orderComponents(members, pagerank);
    if (ordered.length <= maxNodesPerPacket)
        return [ordered.map((c) => c.component_id)];
    const ids = new Set(ordered.map((c) => c.component_id));
    const adj = buildAdjacency(ids, connections);
    const rank = new Map();
    ordered.forEach((c, i) => rank.set(c.component_id, i));
    const visited = new Set();
    const parts = [];
    let current = [];
    const sortByRank = (a, b) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0);
    for (const seed of ordered) {
        if (visited.has(seed.component_id))
            continue;
        const queue = [seed.component_id];
        visited.add(seed.component_id);
        while (queue.length > 0) {
            const id = queue.shift();
            current.push(id);
            if (current.length >= maxNodesPerPacket) {
                parts.push(current);
                current = [];
            }
            const neighbours = [...(adj.get(id) ?? [])].filter((n) => !visited.has(n)).sort(sortByRank);
            for (const n of neighbours) {
                visited.add(n);
                queue.push(n);
            }
        }
    }
    if (current.length > 0)
        parts.push(current);
    return parts;
}
/**
 * Partition mappable components into packet-sized groups.
 *
 * Falls back from `community` to `layer` when metrics are suppressed (graphs
 * under 20 nodes, where Louvain over-fits). The fallback is recorded in
 * `reason` so it is never silent.
 */
export function partitionComponents(components, connections, metrics, options = {}) {
    const minGroup = options.minGroup ?? DEEP_MAP_LIMITS.minGroup;
    const maxNodesPerPacket = options.maxNodesPerPacket ?? DEEP_MAP_LIMITS.nodesPerPacket;
    const maxPackets = options.maxPackets ?? DEEP_MAP_LIMITS.maxPackets;
    const filtered = selectMappableComponents(components, options);
    const mappable = filtered.kept;
    const pagerank = buildPagerankIndex(metrics);
    const community = buildCommunityIndex(metrics);
    const usableCommunities = mappable.some((c) => community.has(c.component_id));
    const unit = usableCommunities ? 'community' : 'layer';
    const reason = usableCommunities
        ? 'Louvain communities from metrics.json (fixed seed, reproducible)'
        : metrics?.suppressed
            ? `metrics suppressed (${metrics.reason ?? 'graph too small'}) — partitioned by role.layer`
            : 'no metrics.json on disk — partitioned by role.layer';
    const buckets = new Map();
    for (const c of mappable) {
        const key = usableCommunities
            ? `community-${community.get(c.component_id) ?? -1}`
            : `layer-${c.role.layer}`;
        const list = buckets.get(key);
        if (list)
            list.push(c);
        else
            buckets.set(key, [c]);
    }
    // Communities below minGroup are not worth their own agent; fold them together.
    const residual = [];
    const kept = [];
    for (const [key, members] of buckets) {
        if (members.length < minGroup)
            residual.push(...members);
        else
            kept.push({ key, members });
    }
    // Largest first, label as tie-break — deterministic without depending on Map order.
    kept.sort((a, b) => b.members.length - a.members.length || (a.key < b.key ? -1 : 1));
    const byId = new Map(mappable.map((c) => [c.component_id, c]));
    const suspectIds = new Set(filtered.suspect_vendored);
    const makeGroup = (label, ids, residual, part) => ({
        label,
        unit,
        component_ids: ids,
        residual,
        ...(part ?? {}),
        path_prefix: commonPathPrefix(ids.flatMap((id) => componentPaths(byId.get(id)))),
        suspect_vendored: ids.filter((id) => suspectIds.has(id)).length,
    });
    const groups = [];
    for (const { key, members } of kept) {
        const parts = splitConnected(members, connections, pagerank, maxNodesPerPacket);
        parts.forEach((ids, i) => {
            groups.push(makeGroup(parts.length > 1 ? `${key}/part-${i + 1}` : key, ids, false, parts.length > 1 ? { part: i + 1, part_count: parts.length } : undefined));
        });
    }
    // The residual bag is not a cluster, so there is nothing to keep connected —
    // rank order is the honest ordering here, and its packet asks a different
    // question (see packets.ts).
    if (residual.length > 0) {
        const ordered = orderComponents(residual, pagerank).map((c) => c.component_id);
        const parts = [];
        for (let i = 0; i < ordered.length; i += maxNodesPerPacket) {
            parts.push(ordered.slice(i, i + maxNodesPerPacket));
        }
        parts.forEach((ids, i) => {
            groups.push(makeGroup(parts.length > 1 ? `residual/part-${i + 1}` : 'residual', ids, true, parts.length > 1 ? { part: i + 1, part_count: parts.length } : undefined));
        });
    }
    const truncated = Math.max(0, groups.length - maxPackets);
    return {
        unit,
        groups: groups.slice(0, maxPackets),
        considered: mappable.length,
        residual_components: residual.length,
        truncated,
        min_group: minGroup,
        max_nodes_per_packet: maxNodesPerPacket,
        reason,
        filter: {
            excluded_vendor: filtered.excluded_vendor,
            excluded_glob: filtered.excluded_glob,
            suspect_vendored: filtered.suspect_vendored.length,
            patterns: filtered.patterns,
        },
    };
}
//# sourceMappingURL=partition.js.map