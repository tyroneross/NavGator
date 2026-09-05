/**
 * NavGator audit oracles — Run 4 (2026-09-05).
 *
 * An oracle compares the STORED map against a source of truth the scanner
 * never read (protocol step 10, research packet §2.5(b)). Where the oracle
 * enumerates truth completely (package.json, prisma models, vercel crons,
 * queue literals) recall is exact; for TS imports the SCIP index is a sampled
 * frame and `frame_coverage` is reported next to recall, because recall
 * against an under-approximating baseline is a bound, not a measurement
 * (ISSTA 2024 Theorem 3.3, packet source [8]).
 *
 * Oracles read ONLY manifest files in the target repo and the stored graph.
 * They never import scanner internals.
 */

import type { ArchitectureComponent, ArchitectureConnection, AuditCensus } from '../../types.js';
import { proportionInterval } from '../sampler.js';
import { noOracle, type OracleInput, type OracleOptions, type OracleResult } from './common.js';
import { npmOracle } from './npm.js';
import { prismaOracle } from './prisma.js';
import { cronOracle } from './cron.js';
import { queueOracle } from './queue.js';
import { importsScipOracle } from './imports-scip.js';

export * from './common.js';

/**
 * Run every oracle, isolating failures: an oracle that throws becomes a
 * strength-'none' result with the error in `notes`. Never throws.
 */
export async function runOracles(input: OracleInput, opts: OracleOptions = {}): Promise<OracleResult[]> {
  const jobs: Array<[string, () => Promise<OracleResult>]> = [
    ['npm', () => Promise.resolve(npmOracle(input))],
    ['prisma', () => prismaOracle(input, { trustTargetDeps: !!opts.trustTargetDeps })],
    ['cron', () => Promise.resolve(cronOracle(input))],
    ['queue', () => Promise.resolve(queueOracle(input))],
    ['imports-scip', () => importsScipOracle(input, { enabled: !!opts.scip, timeoutMs: opts.scipTimeoutMs })],
  ];
  const results: OracleResult[] = [];
  for (const [id, job] of jobs) {
    if (opts.only && !opts.only.includes(id)) continue;
    try {
      results.push(await job());
    } catch (err) {
      results.push(noOracle(id, id, `oracle error: ${(err as Error).message}`));
    }
  }
  return results;
}

/**
 * Census (Run 4 defect 5): invariants that can be counted exactly over the
 * whole population in milliseconds are never sampled.
 *   - unresolved endpoints: either component_id of a connection is absent from the graph
 *   - dedup collisions: duplicate (type, name, primary config) triples
 */
export function runCensus(
  components: ReadonlyArray<ArchitectureComponent>,
  connections: ReadonlyArray<ArchitectureConnection>,
  componentById?: Map<string, ArchitectureComponent>
): AuditCensus {
  const byId = componentById ?? new Map(components.map((c) => [c.component_id, c] as const));
  const by_type: Record<string, { bad: number; total: number }> = {};
  const by_top_dir: Record<string, { bad: number; total: number }> = {};
  let bad = 0;
  for (const conn of connections) {
    const ok = byId.has(conn.from?.component_id ?? '') && byId.has(conn.to?.component_id ?? '');
    const t = conn.connection_type ?? 'other';
    const file = conn.code_reference?.file ?? conn.from?.location?.file ?? '';
    const top = file ? file.replace(/^\.\//, '').split('/')[0] || '.' : '__no-file';
    by_type[t] ??= { bad: 0, total: 0 };
    by_top_dir[top] ??= { bad: 0, total: 0 };
    by_type[t].total++;
    by_top_dir[top].total++;
    if (!ok) {
      bad++;
      by_type[t].bad++;
      by_top_dir[top].bad++;
    }
  }
  // Keep by_top_dir bounded: top 15 dirs by bad count, then by total.
  const dirEntries = Object.entries(by_top_dir)
    .sort((a, b) => b[1].bad - a[1].bad || b[1].total - a[1].total)
    .slice(0, 15);
  const total = connections.length;

  const seen = new Set<string>();
  let dedup = 0;
  for (const c of components) {
    const key = `${c.type}|${c.name}|${c.source?.config_files?.[0] ?? '__none'}`;
    if (seen.has(key)) dedup++;
    else seen.add(key);
  }

  return {
    unresolved_endpoints: {
      bad,
      total,
      rate: total > 0 ? bad / total : 0,
      ...(total > 0 ? { ci: proportionInterval(bad, total) } : {}),
      by_type,
      by_top_dir: Object.fromEntries(dirEntries),
    },
    dedup_collisions: dedup,
  };
}
