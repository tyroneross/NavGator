/**
 * Adapter over the `trufflehog` binary (https://github.com/trufflesecurity/trufflehog).
 *
 * Detected at /opt/homebrew/bin/trufflehog first, then `trufflehog` on PATH.
 * Never auto-installed: if neither resolves, capability() reports
 * available:false and scan() returns [] rather than throwing.
 *
 * TruffleHog ships hundreds of detectors. Only a fixed set map to a
 * `SecretClass` here; everything else — the long tail of generic-entropy
 * detectors (Refiner, Box, TLy, Fmfw, RailwayApp, Aiven, Sirv, Qase, Wit,
 * UnifyID, Juro, Imagga, and more) that fire on any UUID, git SHA, or base64
 * blob in a coding corpus — is classified `unknown` / `entropy` and preserved
 * verbatim via `engineDetector`, never silently dropped. That preserved name
 * is what lets the doctor report an `unmapped_class` diagnostic instead of
 * quietly losing the signal.
 */
import type { DetectorSpecificity, EngineCapability, SecretClass, SecretEngine, SecretFinding } from '../types.js';
/**
 * Pure mapping from a TruffleHog `DetectorName` to our SecretClass +
 * specificity. Exported (and used by `scan()` above) so the "unmapped
 * detector -> unknown/entropy, never dropped" behavior is directly testable
 * without shelling out to the trufflehog binary.
 */
export declare function mapDetectorName(detectorName: string): {
    secretClass: SecretClass;
    specificity: DetectorSpecificity;
};
export interface TruffleHogEngineOptions {
    /** Test-injection override for the binary path. */
    binaryPath?: string;
}
export declare class TruffleHogEngine implements SecretEngine {
    private readonly opts;
    readonly id = "trufflehog";
    private resolved;
    constructor(opts?: TruffleHogEngineOptions);
    private resolveBinary;
    capability(): Promise<EngineCapability>;
    scan(paths: string[]): Promise<SecretFinding[]>;
}
//# sourceMappingURL=trufflehog.d.ts.map