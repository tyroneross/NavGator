/**
 * npm oracle — truth frame: root package.json `dependencies` ∪ `devDependencies`.
 *
 * Map side: every component derived from the ROOT package.json, whatever type
 * the scanner assigned it (npm / database / queue / service / llm / framework —
 * the type is a classification on top of the same manifest fact). Recall is
 * exact because the manifest enumerates truth (protocol step 10).
 */
import { type OracleInput, type OracleResult } from './common.js';
export declare function npmOracle(input: OracleInput): OracleResult;
//# sourceMappingURL=npm.d.ts.map