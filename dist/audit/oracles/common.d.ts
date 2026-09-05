/**
 * Shared oracle helpers (Run 4). Kept separate from index.ts so each oracle
 * module can import them without a circular import through the registry.
 */
import type { ArchitectureComponent, ArchitectureConnection, AuditOracleResult, NavHashes } from '../../types.js';
export type OracleResult = AuditOracleResult;
export interface OracleInput {
    projectRoot: string;
    components: ReadonlyArray<ArchitectureComponent>;
    connections: ReadonlyArray<ArchitectureConnection>;
    componentById: Map<string, ArchitectureComponent>;
    hashes?: NavHashes | null;
}
export interface OracleOptions {
    /** Run the SCIP imports oracle (spawns scip-typescript; 1–120 s). */
    scip?: boolean;
    /** Restrict to these oracle ids. */
    only?: string[];
    /** Allow importing `@prisma/internals` from the TARGET repo's node_modules (code execution from an audited repo). Default false → regex oracle marked weak. */
    trustTargetDeps?: boolean;
    /** scip-typescript timeout in ms (default 120000). */
    scipTimeoutMs?: number;
}
/**
 * Build an OracleResult from two name sets. Precision = tp / map_count,
 * recall = tp / truth_count, both with 95% intervals (Wilson; Clopper-Pearson
 * at 0 or n — protocol step 9).
 */
export declare function setDiffOracle(oracle: string, stratum: string, strength: OracleResult['oracle_strength'], truth: ReadonlySet<string>, map: ReadonlySet<string>, notes?: string[], extraFp?: string[]): OracleResult;
/** Result for an oracle whose truth source is absent or unreadable. */
export declare function noOracle(oracle: string, stratum: string, note: string): OracleResult;
export declare function readJsonSafe<T>(absPath: string): T | null;
/** Independent source walk (does not reuse the scanner's file list). Bounded at `max` files. */
export declare function walkSourceFiles(root: string, max?: number): string[];
/** True when the component was derived from the ROOT package manifest. */
export declare function isRootPackageDerived(c: ArchitectureComponent): boolean;
//# sourceMappingURL=common.d.ts.map