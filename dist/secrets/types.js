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
export {};
//# sourceMappingURL=types.js.map