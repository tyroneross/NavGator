/**
 * Scan orchestrator: runs every available SecretEngine over `paths`, merges
 * findings that are the same underlying secret (same `hash`) across engines,
 * and returns a deterministic SecretScanResult.
 *
 * Engine disagreement — which engines found a given secret and which didn't —
 * is the doctor's core cross-check signal, so merged findings carry a
 * `foundBy: string[]` field. The frozen SecretFinding contract in `types.ts`
 * does not have this field (and must not be edited to add it), so it is
 * exported here as a local extension, `MergedSecretFinding`.
 */
import type { SecretFinding, SecretScanResult } from './types.js';
/** A SecretFinding plus which engine id(s) independently produced it. */
export interface MergedSecretFinding extends SecretFinding {
    foundBy: string[];
}
export interface RunSecretScanOptions {
    /** Engine ids to run. Defaults to all registered engines. Unknown ids are
     * silently ignored (not an error) rather than failing the whole scan. */
    engines?: string[];
}
/** One engine's raw findings, ready to fold into the merge. */
export interface EngineFindingBatch {
    engineId: string;
    findings: SecretFinding[];
}
/**
 * Merges findings that are the same underlying secret (same `hash`) across
 * engines into one `MergedSecretFinding` each: locations are unioned,
 * occurrences summed, specificity kept at the more confident of the two, and
 * `foundBy` records every engine that independently produced the hash.
 * Output is sorted by (secretClass, hash) — and each finding's `locations`/
 * `foundBy` are sorted too — so identical input is byte-identical on repeat
 * calls. Pure and synchronous: exported separately from `runSecretScan` so it
 * is testable without any engine actually running.
 */
export declare function mergeFindings(batches: EngineFindingBatch[]): MergedSecretFinding[];
export declare function runSecretScan(paths: string[], opts?: RunSecretScanOptions): Promise<SecretScanResult>;
//# sourceMappingURL=scan.d.ts.map