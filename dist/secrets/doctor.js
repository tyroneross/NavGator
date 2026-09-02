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
import { classifyCorpus } from './corpus.js';
/**
 * Runtime enumeration of `SecretClass`. The union type has no runtime
 * representation, so the coverage matrix and the class-scoped diagnostics
 * need this array to exist. Must be kept in exact sync with `types.ts` — a
 * class added there and not here silently drops out of the coverage matrix.
 */
export const ALL_SECRET_CLASSES = [
    'aws_key',
    'gcp_key',
    'azure_key',
    'github_token',
    'gitlab_token',
    'slack_token',
    'stripe_key',
    'sendgrid_key',
    'twilio_key',
    'cloudflare_token',
    'npm_token',
    'openai_key',
    'anthropic_key',
    'groq_key',
    'google_api_key',
    'postgres_uri',
    'mongodb_uri',
    'jdbc_uri',
    'redis_uri',
    'generic_uri_credential',
    'private_key',
    'jwt',
    'generic_assignment',
    'high_entropy',
    'unknown',
];
/**
 * Classes whose exposure has an immediate blast radius (cloud control plane,
 * source hosting, payment processing, or a database holding user data). A
 * `liveness_unknown` diagnostic only fires for these — an unverified
 * `high_entropy` string is noise; an unverified `aws_key` is a real question.
 * Enumerated verbatim from the task brief, not derived, so the set stays
 * exactly what was specified rather than drifting with unrelated edits here.
 */
export const HIGH_CONSEQUENCE_CLASSES = [
    'private_key',
    'aws_key',
    'gcp_key',
    'azure_key',
    'github_token',
    'stripe_key',
    'postgres_uri',
    'mongodb_uri',
];
/** `detector_degeneracy` fires when one detector accounts for more than this share of all findings. */
export const DETECTOR_DEGENERACY_SHARE = 0.3;
/** `detector_degeneracy` also fires on this absolute count regardless of share, for small-total corpora. */
export const DETECTOR_DEGENERACY_ABSOLUTE = 500;
const SEVERITY_RANK = { error: 3, warn: 2, info: 1 };
function severityWorse(a, b) {
    if (a === 'none')
        return b;
    return SEVERITY_RANK[b] > SEVERITY_RANK[a] ? b : a;
}
export function buildDoctorReport(input) {
    const { findings, engines, scannedPaths } = input;
    const availableEngines = engines.filter(e => e.available);
    // ---- coverageMatrix: every SecretClass -> available engine ids that declare it ----
    const coverageMatrix = {};
    for (const cls of ALL_SECRET_CLASSES) {
        coverageMatrix[cls] = availableEngines.filter(e => e.classes.includes(cls)).map(e => e.id);
    }
    // ---- specificityBreakdown / totalFindings ----
    const specificityBreakdown = {
        structured: 0,
        heuristic: 0,
        entropy: 0,
    };
    for (const f of findings) {
        specificityBreakdown[f.specificity] += 1;
    }
    const totalFindings = findings.length;
    const diagnostics = [];
    // ---- 1. engine_unavailable ----
    const availableClassUnion = new Set();
    for (const e of availableEngines)
        for (const c of e.classes)
            availableClassUnion.add(c);
    for (const engine of engines) {
        if (engine.available)
            continue;
        const lost = engine.classes.filter(c => !availableClassUnion.has(c));
        const reasonSuffix = engine.unavailableReason ? ` (${engine.unavailableReason})` : '';
        if (lost.length === 0) {
            diagnostics.push({
                kind: 'engine_unavailable',
                severity: 'info',
                summary: `Engine '${engine.id}' is unavailable${reasonSuffix}, but every class it declares is still covered by an available engine.`,
                remedy: `Install or configure '${engine.id}' for cross-checking redundancy; no unique class coverage is lost without it today.`,
                subjects: [engine.id],
            });
        }
        else {
            diagnostics.push({
                kind: 'engine_unavailable',
                severity: 'warn',
                summary: `Engine '${engine.id}' is unavailable${reasonSuffix}, losing all detection coverage for: ${lost.join(', ')}.`,
                remedy: `Install or configure '${engine.id}' to restore detection for ${lost.join(', ')}, or add another engine that declares those classes.`,
                subjects: [engine.id, ...lost],
                count: lost.length,
            });
        }
    }
    // ---- 2. corpus_blind_spot ----
    // Per (available engine, corpus) pair: available engines that cannot read a
    // corpus present in scannedPaths. Collapsed per pair with a path count, not
    // one diagnostic per path, per the module's collapsing philosophy.
    const blindSpotGroups = new Map();
    for (const engine of availableEngines) {
        for (const path of scannedPaths) {
            const corpus = classifyCorpus(path);
            if (engine.corpora.includes(corpus))
                continue;
            const key = `${engine.id}::${corpus}`;
            let group = blindSpotGroups.get(key);
            if (!group) {
                group = { engineId: engine.id, corpus, paths: new Set() };
                blindSpotGroups.set(key, group);
            }
            group.paths.add(path);
        }
    }
    for (const group of blindSpotGroups.values()) {
        const paths = Array.from(group.paths);
        diagnostics.push({
            kind: 'corpus_blind_spot',
            severity: 'warn',
            summary: `Engine '${group.engineId}' does not declare corpus '${group.corpus}', so it could never have read ${paths.length} scanned path(s) in that corpus.`,
            remedy: `Do not treat '${group.engineId}' as having checked ${group.corpus} paths; rely on an engine whose corpora include '${group.corpus}', or scope '${group.engineId}' out of that path.`,
            subjects: [group.engineId, group.corpus, ...paths],
            count: paths.length,
        });
    }
    // ---- 3. single_engine_class & 4. uncovered_class ----
    // 'unknown' is excluded from both: it is the sentinel for "no SecretClass
    // mapping exists" (handled by unmapped_class), not a real credential class
    // an engine is expected to declare — every engine would show as
    // permanently "uncovered" for it otherwise, which is noise, not signal.
    const singleEngineClasses = [];
    const uncoveredClasses = [];
    for (const cls of ALL_SECRET_CLASSES) {
        if (cls === 'unknown')
            continue;
        const coveringEngines = coverageMatrix[cls];
        if (coveringEngines.length === 0)
            uncoveredClasses.push(cls);
        else if (coveringEngines.length === 1)
            singleEngineClasses.push(cls);
    }
    if (singleEngineClasses.length > 0) {
        diagnostics.push({
            kind: 'single_engine_class',
            severity: 'info',
            summary: `${singleEngineClasses.length} class(es) have exactly one available engine covering them, so a miss on that engine is invisible: ${singleEngineClasses.join(', ')}.`,
            remedy: `Add a second engine that declares one of these classes to enable cross-checking, or accept the single-source risk explicitly.`,
            subjects: singleEngineClasses,
            count: singleEngineClasses.length,
        });
    }
    if (uncoveredClasses.length > 0) {
        diagnostics.push({
            kind: 'uncovered_class',
            severity: 'error',
            summary: `${uncoveredClasses.length} class(es) have no available engine covering them at all — a scan reports zero findings for these not because none exist, but because nothing can look: ${uncoveredClasses.join(', ')}.`,
            remedy: `Install, configure, or extend an engine to declare ${uncoveredClasses.join(', ')} before trusting a clean result for these classes.`,
            subjects: uncoveredClasses,
            count: uncoveredClasses.length,
        });
    }
    // ---- 5. engine_disagreement ----
    // Collapsed to ONE diagnostic per (class, missing-engine) pair with a
    // count, per the frozen contract's explicit instruction.
    const disagreementCounts = new Map();
    for (const finding of findings) {
        const locationCorpora = new Set(finding.locations.map(l => l.corpus));
        const capableEngines = availableEngines.filter(e => e.classes.includes(finding.secretClass) && e.corpora.some(c => locationCorpora.has(c)));
        const foundBySet = new Set(finding.foundBy ?? [finding.engine]);
        const missing = capableEngines.filter(e => !foundBySet.has(e.id));
        for (const engine of missing) {
            const key = `${finding.secretClass}::${engine.id}`;
            const existing = disagreementCounts.get(key);
            if (existing)
                existing.count += 1;
            else
                disagreementCounts.set(key, { secretClass: finding.secretClass, engineId: engine.id, count: 1 });
        }
    }
    // Stable order: iterate classes in canonical order, then engine id.
    const disagreementEntries = Array.from(disagreementCounts.values()).sort((a, b) => {
        const classDiff = ALL_SECRET_CLASSES.indexOf(a.secretClass) - ALL_SECRET_CLASSES.indexOf(b.secretClass);
        return classDiff !== 0 ? classDiff : a.engineId.localeCompare(b.engineId);
    });
    for (const entry of disagreementEntries) {
        diagnostics.push({
            kind: 'engine_disagreement',
            severity: 'warn',
            summary: `${entry.count} finding(s) of class '${entry.secretClass}' were not reported by '${entry.engineId}', though it is available, declares that class, and can read the corpus — the other engine(s) that found them may be wrong, or '${entry.engineId}' is missing them.`,
            remedy: `Investigate why '${entry.engineId}' missed ${entry.count} '${entry.secretClass}' finding(s) it should have been capable of detecting; check its detector rules or run it directly against one example.`,
            subjects: [entry.secretClass, entry.engineId],
            count: entry.count,
        });
    }
    // ---- 6. detector_degeneracy ----
    const detectorCounts = new Map();
    for (const f of findings) {
        const key = `${f.engine}::${f.engineDetector}`;
        const existing = detectorCounts.get(key);
        if (existing)
            existing.count += 1;
        else
            detectorCounts.set(key, { engine: f.engine, engineDetector: f.engineDetector, count: 1 });
    }
    const degenerateEntries = Array.from(detectorCounts.values())
        .filter(d => {
        const share = totalFindings > 0 ? d.count / totalFindings : 0;
        return share > DETECTOR_DEGENERACY_SHARE || d.count > DETECTOR_DEGENERACY_ABSOLUTE;
    })
        .sort((a, b) => b.count - a.count || a.engineDetector.localeCompare(b.engineDetector));
    for (const d of degenerateEntries) {
        const share = totalFindings > 0 ? d.count / totalFindings : 0;
        diagnostics.push({
            kind: 'detector_degeneracy',
            severity: 'warn',
            summary: `Detector '${d.engineDetector}' (engine '${d.engine}') produced ${d.count} of ${totalFindings} findings (${Math.floor(share * 100)}%) — an implausible share for one detector to be signal rather than noise.`,
            remedy: `Exclude '${d.engineDetector}' or downgrade its specificity (e.g. to 'entropy') so it stops dominating the finding count; review a sample before excluding entirely in case it is genuinely finding that many real secrets.`,
            subjects: [d.engine, d.engineDetector],
            count: d.count,
        });
    }
    // ---- 7. unmapped_class ----
    const unmappedByDetector = new Map();
    let unmappedTotal = 0;
    for (const f of findings) {
        if (f.secretClass !== 'unknown')
            continue;
        unmappedTotal += 1;
        unmappedByDetector.set(f.engineDetector, (unmappedByDetector.get(f.engineDetector) ?? 0) + 1);
    }
    if (unmappedTotal > 0) {
        const topOffenders = Array.from(unmappedByDetector.entries())
            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
            .slice(0, 5);
        diagnostics.push({
            kind: 'unmapped_class',
            severity: 'info',
            summary: `${unmappedTotal} finding(s) map to no known SecretClass. Top detectors: ${topOffenders
                .map(([det, count]) => `${det} (${count})`)
                .join(', ')}.`,
            remedy: `Add a SecretClass mapping for these detectors in the relevant engine adapter, or confirm they are entropy noise and leave them classified 'unknown'.`,
            subjects: topOffenders.map(([det]) => det),
            count: unmappedTotal,
        });
    }
    // ---- 8. disposition_debt ----
    const pending = findings.filter(f => f.disposition === 'pending');
    if (pending.length > 0) {
        const scaleNote = pending.length > 50
            ? 'This volume is too large to triage one at a time — prioritize by liveness and class before reviewing individually.'
            : 'Review each and set a disposition (rotated, ignored, or false_positive).';
        diagnostics.push({
            kind: 'disposition_debt',
            severity: 'warn',
            summary: `${pending.length} finding(s) still have disposition 'pending' — nobody has decided what to do about them.`,
            remedy: scaleNote,
            subjects: Array.from(new Set(pending.map(f => f.secretClass))),
            count: pending.length,
        });
    }
    // ---- 9. liveness_unknown ----
    const highConsequenceSet = new Set(HIGH_CONSEQUENCE_CLASSES);
    const unverifiedHighConsequence = findings.filter(f => f.liveness === 'unverified' && highConsequenceSet.has(f.secretClass));
    if (unverifiedHighConsequence.length > 0) {
        const affectedClasses = Array.from(new Set(unverifiedHighConsequence.map(f => f.secretClass)));
        diagnostics.push({
            kind: 'liveness_unknown',
            severity: 'warn',
            summary: `${unverifiedHighConsequence.length} high-consequence finding(s) (${affectedClasses.join(', ')}) have never had liveness checked — detection proves the string is shaped like a credential, not that it still works.`,
            remedy: `Run each against its provider's verification endpoint before deciding rotation priority (e.g. AWS STS GetCallerIdentity for aws_key, GitHub token introspection for github_token, a read-only connection attempt for postgres_uri/mongodb_uri) rather than assuming shape implies validity.`,
            subjects: affectedClasses,
            count: unverifiedHighConsequence.length,
        });
    }
    // ---- final sort: severity desc, then kind asc, stable otherwise ----
    diagnostics.sort((a, b) => {
        const sevDiff = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
        return sevDiff !== 0 ? sevDiff : a.kind.localeCompare(b.kind);
    });
    let worstSeverity = 'none';
    for (const d of diagnostics)
        worstSeverity = severityWorse(worstSeverity, d.severity);
    return {
        diagnostics,
        coverageMatrix,
        engines,
        specificityBreakdown,
        totalFindings,
        worstSeverity,
    };
}
//# sourceMappingURL=doctor.js.map