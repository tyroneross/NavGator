/**
 * Secret-detection contract for NavGator.
 *
 * BOUNDARY — read this before adding a field.
 * NavGator detects and locates credentials. It never stores their VALUES.
 * A finding carries a class, a 12-character preview, a truncated SHA-256, and a
 * location. Secrets Vault (`vault audit-transcripts`) remains the system of
 * record for values and for the rotation workflow. This mirrors the existing
 * posture in `scanners/infrastructure/env-scanner.ts` ("credentials are never
 * included") and avoids standing up a second encrypted store.
 *
 * Adding a `value: string` field to SecretFinding would break that boundary.
 * If a caller needs the value in order to rotate, it goes to the vault.
 *
 * EXECUTION TIERS — which layer decides what, and who runs the model.
 *
 * NavGator has no LLM SDK in its dependency tree and never will (see the
 * deep-map section of CLAUDE.md). So the model tiers below are NOT in-process
 * calls. NavGator emits a work packet; the CALLING AGENT runs the model and
 * feeds the result back. deep-map is the precedent this follows exactly.
 *
 *   1. DETERMINISTIC CORE (tier 0, no model). Engine adapters, normalisation,
 *      the coverage matrix, and every ScanDiagnostic are produced by code. Same
 *      input, same output, every time. This layer alone sets the exit code, and
 *      it must remain runnable and testable with no model available at all.
 *
 *   2. NARRATION PACKET (light tier — Haiku / Luna). NavGator writes a packet
 *      asking for human-readable `summary`/`remedy` prose, and for a proposed
 *      SecretClass for any detector that has no mapping. Bounded, rule-
 *      expressible work. The host runs it and ingests the result.
 *
 *   3. REVIEW PACKET (Sonnet / Terra, escalating to Opus / Sol). Asks whether a
 *      diagnostic is a real gap or a false positive, and whether a finding
 *      warrants rotation. Advisory only.
 *
 * THE INVARIANT: an ingested model result may ADD prose and MAY PROPOSE a
 * mapping for human review. It may not remove a diagnostic, downgrade a
 * severity, or turn a non-zero exit into a zero one. A gate a model can talk
 * its way past is not a gate. Ingest validates and rejects out-of-contract
 * results rather than trusting them, exactly as deep-map's ingest does.
 *
 * STORAGE: findings live under `.navgator/secrets/`, never in the component
 * graph — same rule as deep-map findings. Deleting that directory must leave
 * every other NavGator command working.
 *
 * INVOCATION — situational, never ambient. Not a cron sweep. It runs when the
 * exposure actually changes: before pushing a repo, before exporting
 * transcript-derived data, after installing or removing an engine, or on
 * explicit request. Continuous scanning of a 14 GB corpus buys nothing and
 * trains the operator to ignore the output.
 */
/**
 * A credential class, normalised across engines.
 *
 * Engines disagree on naming — TruffleHog says `GitHubOauth2`, Secrets Vault
 * says `github_oauth`, build-loop's scanner says "GitHub token". The doctor's
 * coverage matrix is only meaningful if all three collapse to one key, so every
 * adapter MUST map into this union and MUST NOT invent members. An engine class
 * with no mapping becomes `unknown` and is surfaced by the `unmapped_class`
 * diagnostic rather than silently dropped — a class nobody maps is a coverage
 * gap, and the point of this file is to make gaps visible.
 */
export type SecretClass = 'aws_key' | 'gcp_key' | 'azure_key' | 'github_token' | 'gitlab_token' | 'slack_token' | 'stripe_key' | 'sendgrid_key' | 'twilio_key' | 'cloudflare_token' | 'npm_token' | 'openai_key' | 'anthropic_key' | 'groq_key' | 'google_api_key' | 'postgres_uri' | 'mongodb_uri' | 'jdbc_uri' | 'redis_uri' | 'generic_uri_credential' | 'private_key' | 'jwt' | 'generic_assignment' | 'high_entropy' | 'unknown';
/**
 * How much structure a detector actually validated.
 *
 * This is the single most useful field for triage and the reason today's scan
 * produced 12,601 hits of which only 209 were worth reading. A `structured`
 * detector knows a vendor's format; `heuristic` matched a shape like
 * `KEY=value`; `entropy` only measured randomness and will fire on every UUID,
 * git SHA, and base64 blob in a coding corpus.
 */
export type DetectorSpecificity = 'structured' | 'heuristic' | 'entropy';
/** Whether anyone has established that the credential still works. */
export type LivenessState = 'unverified' | 'live' | 'dead' | 'unverifiable';
/** What the operator decided to do about it. */
export type Disposition = 'pending' | 'rotated' | 'ignored' | 'false_positive';
export interface SecretLocation {
    /** Absolute path of the file the finding was seen in. */
    file: string;
    /** 1-indexed line, when the engine reports one. */
    line?: number;
    /**
     * Which corpus this path belongs to. Drives the doctor's blind-spot check:
     * Secrets Vault only reads `claude_transcripts`, so a finding in
     * `codex_transcripts` proves that engine could never have seen it.
     */
    corpus: 'claude_transcripts' | 'codex_transcripts' | 'repo' | 'other';
}
export interface SecretFinding {
    /** Stable identity: sha256(normalised secret), first 12 hex chars. */
    hash: string;
    /** First 12 characters of the matched text. Never the whole value. */
    preview: string;
    secretClass: SecretClass;
    specificity: DetectorSpecificity;
    /** Adapter id that produced this: 'native' | 'trufflehog' | 'vault'. */
    engine: string;
    /** The engine's own detector name, kept verbatim for diagnostics. */
    engineDetector: string;
    locations: SecretLocation[];
    occurrences: number;
    firstSeen?: string;
    lastSeen?: string;
    liveness: LivenessState;
    disposition: Disposition;
}
/** What an engine claims it can find, declared up front rather than inferred. */
export interface EngineCapability {
    id: string;
    available: boolean;
    /** Why it is unavailable — binary missing, CLI not on PATH, etc. */
    unavailableReason?: string;
    version?: string;
    /** Classes this engine can detect at all. */
    classes: SecretClass[];
    /** Corpora this engine is able to read. */
    corpora: SecretLocation['corpus'][];
    /** True when the engine can confirm a credential is live, not just shaped like one. */
    canVerifyLiveness: boolean;
}
export interface SecretScanResult {
    findings: SecretFinding[];
    engines: EngineCapability[];
    scannedPaths: string[];
    filesScanned: number;
    durationMs: number;
}
/**
 * One thing wrong with the SCAN, as distinct from one thing wrong with the code.
 *
 * `navgator secrets scan` answers "what credentials are exposed".
 * `navgator secrets doctor` answers "how much should I trust that answer".
 * Findings belong to the first; diagnostics belong here.
 */
export type DiagnosticKind = 'engine_unavailable' | 'corpus_blind_spot' | 'single_engine_class' | 'uncovered_class' | 'engine_disagreement' | 'detector_degeneracy' | 'unmapped_class' | 'disposition_debt' | 'liveness_unknown';
export type DiagnosticSeverity = 'info' | 'warn' | 'error';
export interface ScanDiagnostic {
    kind: DiagnosticKind;
    severity: DiagnosticSeverity;
    /** One sentence naming what is wrong and for whom. */
    summary: string;
    /**
     * The concrete improvement. Every diagnostic must carry one — a diagnostic a
     * reader cannot act on is noise, and this field is the relevance filter.
     */
    remedy: string;
    /** Affected classes, engines, or paths. Never secret values. */
    subjects: string[];
    /** Count of findings or items implicated, when countable. */
    count?: number;
}
export interface SecretDoctorReport {
    diagnostics: ScanDiagnostic[];
    /** class -> engine ids that can detect it. Empty array means uncovered. */
    coverageMatrix: Record<string, string[]>;
    engines: EngineCapability[];
    /** Findings by specificity — the triage denominator. */
    specificityBreakdown: Record<DetectorSpecificity, number>;
    totalFindings: number;
    /** Highest severity present, for exit-code selection. */
    worstSeverity: DiagnosticSeverity | 'none';
}
/** Every engine adapter implements exactly this. */
export interface SecretEngine {
    readonly id: string;
    capability(): Promise<EngineCapability>;
    scan(paths: string[]): Promise<SecretFinding[]>;
}
//# sourceMappingURL=types.d.ts.map