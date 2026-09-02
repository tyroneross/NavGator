/**
 * Scan-quality diagnostic engine for NavGator's secrets capability.
 *
 * `navgator secrets scan` answers "what credentials are exposed."
 * `navgator secrets doctor` answers "how much should I trust that answer."
 * This module grades the SCAN — it never re-derives findings, never touches
 * the filesystem, and never calls a model. Same input, same output, always.
 *
 * DETERMINISM CONTRACT: `buildDoctorReport` is a pure function of its input.
 * No `Date.now()`, no `Math.random()`, no environment reads, no network. Every
 * ordering decision (map iteration, class enumeration, diagnostic sort) is
 * pinned to a fixed order so two calls on identical input produce
 * byte-identical output — see the `types.ts` header, tier 1 (DETERMINISTIC
 * CORE): this layer alone sets the exit code and must stay reproducible with
 * no model available at all.
 *
 * COLLAPSING PHILOSOPHY: following `detectRuleDegeneracy` in `../rules.ts`
 * ("a rule that fires on most of the codebase is reported as one
 * misconfiguration, not as N findings"), every diagnostic here collapses a
 * systemic problem into one actionable statement. `single_engine_class` and
 * `uncovered_class` each emit ONE diagnostic naming every affected class
 * (not one per class); `engine_disagreement` collapses per (class,
 * missing-engine) pair with a count (per the frozen contract's explicit
 * instruction); `unmapped_class`, `disposition_debt`, and `liveness_unknown`
 * each emit ONE diagnostic for the whole report. `engine_unavailable`,
 * `corpus_blind_spot`, and `detector_degeneracy` are inherently per-subject
 * (per engine; per engine+corpus; per detector) because each names a
 * distinct, independently actionable remedy — collapsing those would hide
 * which engine or detector to fix.
 */
import type { EngineCapability, SecretClass, SecretDoctorReport, SecretFinding } from './types.js';
/**
 * Runtime enumeration of `SecretClass`. The union type has no runtime
 * representation, so the coverage matrix and the class-scoped diagnostics
 * need this array to exist. Must be kept in exact sync with `types.ts` — a
 * class added there and not here silently drops out of the coverage matrix.
 */
export declare const ALL_SECRET_CLASSES: SecretClass[];
/**
 * Classes whose exposure has an immediate blast radius (cloud control plane,
 * source hosting, payment processing, or a database holding user data). A
 * `liveness_unknown` diagnostic only fires for these — an unverified
 * `high_entropy` string is noise; an unverified `aws_key` is a real question.
 * Enumerated verbatim from the task brief, not derived, so the set stays
 * exactly what was specified rather than drifting with unrelated edits here.
 */
export declare const HIGH_CONSEQUENCE_CLASSES: SecretClass[];
/** `detector_degeneracy` fires when one detector accounts for more than this share of all findings. */
export declare const DETECTOR_DEGENERACY_SHARE = 0.3;
/** `detector_degeneracy` also fires on this absolute count regardless of share, for small-total corpora. */
export declare const DETECTOR_DEGENERACY_ABSOLUTE = 500;
export interface DoctorInput {
    findings: Array<SecretFinding & {
        foundBy?: string[];
    }>;
    engines: EngineCapability[];
    scannedPaths: string[];
}
export declare function buildDoctorReport(input: DoctorInput): SecretDoctorReport;
//# sourceMappingURL=doctor.d.ts.map