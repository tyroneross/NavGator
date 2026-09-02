/**
 * Adapter over Secrets Vault's own transcript audit
 * (`vault audit-transcripts --dry-run --json`).
 *
 * Verified against the live CLI today (`vault audit-transcripts --help`):
 *
 *   vault audit-transcripts [--days <n>] [--auto-create] [--store-values] [--dry-run] [--json]
 *
 * `--days <n>` looks back n days (default scans all history). Metadata-only
 * by default (kind, <=12-char preview, SHA-256 hash) — `--dry-run` additionally
 * guarantees nothing is written, matching NavGator's own never-store-values
 * rule.
 *
 * CONTRACT MISMATCH (documented, not silently worked around):
 *   `vault audit-transcripts` takes NO path argument. It always scans its own
 *   fixed corpus, `~/.claude/projects/*\/*.jsonl`, directly against the
 *   locally running vault daemon/app over HTTP. The frozen SecretEngine
 *   interface passes `paths: string[]` uniformly to every engine, but vault
 *   cannot be pointed at an arbitrary directory — there is no way to scope it
 *   to a test fixture. This adapter therefore only invokes the real CLI when
 *   the caller's `paths` actually include (or are) `~/.claude/projects`; for
 *   any other input it returns `[]` without shelling out, so a scan over a
 *   temp fixture directory can never accidentally read the user's real
 *   transcripts.
 *
 *   A second gap: `vault audit-transcripts --json`'s `TranscriptFinding`
 *   carries `projectDir` (the encoded directory under `~/.claude/projects/`)
 *   and NOT the individual `.jsonl` file or line number a secret appeared on.
 *   `SecretLocation.file` is therefore set to the project's transcript
 *   directory, not a single file — coarser than what native/trufflehog can
 *   report. `SecretLocation.line` is omitted (left undefined) for every vault
 *   finding for the same reason.
 *
 * Also verified today: `vault audit-transcripts` requires the vault
 * daemon/app to be running and unlocked (it makes an HTTP call). If it is
 * not, the process fails — treated here as `available:false` for scan(),
 * and scan() itself falls back to `[]` on any invocation error rather than
 * throwing.
 */
import type { EngineCapability, SecretEngine, SecretFinding } from '../types.js';
export interface VaultEngineOptions {
    /** Test-injection override for the binary path. */
    binaryPath?: string;
    /** `--days` lookback window. Omits the flag (scans all history) if unset. */
    days?: number;
}
export declare class VaultEngine implements SecretEngine {
    private readonly opts;
    readonly id = "vault";
    constructor(opts?: VaultEngineOptions);
    private resolveBinary;
    capability(): Promise<EngineCapability>;
    scan(paths: string[]): Promise<SecretFinding[]>;
}
//# sourceMappingURL=vault.d.ts.map