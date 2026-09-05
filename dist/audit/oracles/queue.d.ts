/**
 * queue oracle — truth frame: `new Queue('name')` / `new Worker('name')` /
 * `new Bull('name')` string literals found by an INDEPENDENT source walk (not
 * the scanner's file list). A queue declared only on its consumer side
 * (`new Worker`) is still a real queue.
 *
 * Strength is 'weak' by design: a string literal is the same evidence class
 * the scanner uses (packet §5.3 — string-literal inference is a 15–20%
 * precision problem for shipping tools), so this oracle re-derives rather
 * than corroborates. It still catches queues the scanner dropped or invented.
 *
 * Map side: `queue` components NOT sourced from package.json (the npm scanner
 * also types `bullmq` / `bull` as `queue`; those are packages, not queues).
 */
import { type OracleInput, type OracleResult } from './common.js';
export declare function queueLiterals(root: string): {
    names: Set<string>;
    files: number;
    unresolved: string[];
};
export declare function queueOracle(input: OracleInput): OracleResult;
//# sourceMappingURL=queue.d.ts.map