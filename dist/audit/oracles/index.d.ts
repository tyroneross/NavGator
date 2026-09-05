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
import { type OracleInput, type OracleOptions, type OracleResult } from './common.js';
export * from './common.js';
/**
 * Run every oracle, isolating failures: an oracle that throws becomes a
 * strength-'none' result with the error in `notes`. Never throws.
 */
export declare function runOracles(input: OracleInput, opts?: OracleOptions): Promise<OracleResult[]>;
/**
 * Census (Run 4 defect 5): invariants that can be counted exactly over the
 * whole population in milliseconds are never sampled.
 *   - unresolved endpoints: either component_id of a connection is absent from the graph
 *   - dedup collisions: duplicate (type, name, primary config) triples
 */
export declare function runCensus(components: ReadonlyArray<ArchitectureComponent>, connections: ReadonlyArray<ArchitectureConnection>, componentById?: Map<string, ArchitectureComponent>): AuditCensus;
//# sourceMappingURL=index.d.ts.map