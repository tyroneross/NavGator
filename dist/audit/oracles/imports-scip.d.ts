/**
 * imports-scip oracle — truth frame: compiler-resolved cross-file references
 * from scip-typescript (what tsserver sees, not what a regex guesses).
 *
 * This is a SAMPLED truth frame: scip-typescript indexes the documents the
 * tsconfig reaches, so recall is a bound that tightens with `frame_coverage`
 * (documents indexed / TS files in the stored file list). Report both
 * (protocol step 10; ISSTA 2024 Theorem 3.3, packet source [8]).
 *
 * Join key: unordered file pair? No — directed `from → to` file pair. A map
 * `imports` edge from file A to component X counts as a true positive when
 * SCIP records a reference from A to X's defining file. Map edges whose source
 * file is outside the indexed set are out-of-frame and excluded from the
 * precision denominator (counted in notes).
 *
 * Off by default: spawning the indexer costs 1–120 s. Enabled by
 * `navgator scan --scip` or `navgator audit-report --scip`; timeout via
 * `--scip-timeout <ms>` or NAVGATOR_SCIP_TIMEOUT_MS (default 120000).
 */
import { type OracleInput, type OracleResult } from './common.js';
export declare function importsScipOracle(input: OracleInput, opts: {
    enabled: boolean;
    timeoutMs?: number;
}): Promise<OracleResult>;
//# sourceMappingURL=imports-scip.d.ts.map