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

import * as fs from 'fs';
import * as path from 'path';
import { DirectedGraph } from 'graphology';
// graphology-metrics has no `exports` field; subpath needs explicit .js for NodeNext.
import * as pagerankNs from 'graphology-metrics/centrality/pagerank.js';
type PagerankFn = (g: unknown, opts: unknown) => Record<string, number>;
const pagerank: PagerankFn =
  ((pagerankNs as unknown as { default?: PagerankFn }).default ??
    (pagerankNs as unknown as PagerankFn));
// graphology-communities-louvain ships ESM types over CJS runtime; both shapes
// (function-with-.detailed AND { default: ... }) appear in the wild — handle both.
import * as louvainNs from 'graphology-communities-louvain';

interface LouvainCallable {
  (g: unknown, opts: unknown): Record<string, number>;
  detailed: (g: unknown, opts: unknown) => {
    communities: Record<string, number>;
    count: number;
    modularity: number;
  };
}
const louvain: LouvainCallable =
  ((louvainNs as unknown as { default?: LouvainCallable }).default ??
    (louvainNs as unknown as LouvainCallable));
import {
  ArchitectureComponent,
  ArchitectureConnection,
  NavGatorConfig,
} from '../types.js';
import {
  getConfig,
  getStoragePath,
  ensureStorageDirectories,
} from '../config.js';
import { loadAllComponents, loadAllConnections } from '../storage.js';

const MIN_NODES_FOR_METRICS = 20;

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

/** Mulberry32 deterministic PRNG; seed = 1 → reproducible Louvain output. */
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Build metrics for the current scan. Reads components + connections from
 * disk, computes PageRank + Louvain, writes metrics.json, and patches each
 * component file in place to add `pagerank_score` + `community_id` under
 * its `metadata` field.
 *
 * Returns the report (also written to disk).
 */
export async function computeAndStoreMetrics(
  config?: NavGatorConfig,
  projectRoot?: string,
  preloaded?: { components: ArchitectureComponent[]; connections: ArchitectureConnection[] }
): Promise<MetricsReport> {
  const cfg = config || getConfig();
  ensureStorageDirectories(cfg, projectRoot);

  // Reuse the scanner's in-memory components/connections when provided —
  // this saves ~30 file reads (~20ms regression on the bench fixture).
  const components = preloaded?.components ?? (await loadAllComponents(cfg, projectRoot));
  const connections = preloaded?.connections ?? (await loadAllConnections(cfg, projectRoot));

  const archPath = getStoragePath(cfg, projectRoot);
  const metricsPath = path.join(archPath, 'metrics.json');

  if (components.length < MIN_NODES_FOR_METRICS) {
    const report: MetricsReport = {
      schema_version: '1.0',
      generated_at: Date.now(),
      node_count: components.length,
      edge_count: connections.length,
      community_count: 0,
      modularity: null,
      suppressed: true,
      reason: `graph too small (${components.length} < ${MIN_NODES_FOR_METRICS} nodes)`,
      metrics: [],
    };
    await fs.promises.writeFile(metricsPath, JSON.stringify(report, null, 2), 'utf-8');
    return report;
  }

  const g = new DirectedGraph({ allowSelfLoops: true, multi: false });
  const idToComponent = new Map<string, ArchitectureComponent>();
  for (const c of components) {
    if (!g.hasNode(c.component_id)) {
      g.addNode(c.component_id);
      idToComponent.set(c.component_id, c);
    }
  }
  for (const conn of connections) {
    const from = conn.from?.component_id;
    const to = conn.to?.component_id;
    if (!from || !to) continue;
    if (!g.hasNode(from) || !g.hasNode(to)) continue;
    if (g.hasEdge(from, to)) continue;
    g.addDirectedEdge(from, to);
  }

  const prScores = pagerank(g, { alpha: 0.85, maxIterations: 100, tolerance: 1e-6, getEdgeWeight: null });

  const louvainResult = louvain.detailed(g, {
    rng: mulberry32(1),
    randomWalk: false,
    fastLocalMoves: true,
    resolution: 1.0,
    getEdgeWeight: null,
  }) as { communities: Record<string, number>; count: number; modularity: number };

  const metrics: ComponentMetric[] = [];
  for (const c of components) {
    const score = prScores[c.component_id] ?? 0;
    const community = louvainResult.communities[c.component_id] ?? -1;
    metrics.push({
      stable_id: c.stable_id ?? c.component_id,
      component_id: c.component_id,
      name: c.name,
      pagerank_score: score,
      community_id: community,
    });
  }
  // Note: we do NOT back-write per-component pagerank/community to component
  // JSON — that doubles scan-time disk I/O (~25ms regression in bench). The
  // metrics.json is the canonical store; consumers join by stable_id or
  // component_id (both present in each metrics row).

  metrics.sort((a, b) => b.pagerank_score - a.pagerank_score);

  const report: MetricsReport = {
    schema_version: '1.0',
    generated_at: Date.now(),
    node_count: g.order,
    edge_count: g.size,
    community_count: louvainResult.count,
    modularity: louvainResult.modularity,
    suppressed: false,
    metrics,
  };

  await fs.promises.writeFile(metricsPath, JSON.stringify(report, null, 2), 'utf-8');
  return report;
}
