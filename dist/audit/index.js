/**
 * NavGator audit orchestrator — Run 2 / D4
 *
 * Picks a sampling plan (AQL / SPRT / Cochran), stratifies the population,
 * runs the six verifiers in parallel, aggregates into a single AuditReport.
 *
 * Hooked from scanner.ts after Phase 4 storage write, before Phase 5 timeline.
 * Must NOT cause the scan to fail — only updates EWMA and sets `drift_breach`
 * on the timeline entry, which the next scan reads to auto-promote.
 */
import { loadHashes } from '../storage.js';
import { chooseAQLPlan, cochranSize, selectAuditSample, sprtNext, Z, } from './sampler.js';
import { newEwmaState, updateEwma, } from './spc.js';
import { verifyDedupCollision, verifyHallucinatedComponent, verifyHallucinatedEdge, verifyMissedEdge, verifyStaleReference, verifyWrongEndpoint, } from './verifiers.js';
// ============================================================================
// STRATA KEYS
// ============================================================================
const PACKAGE_TYPES = new Set([
    'npm',
    'pip',
    'spm',
    'cargo',
    'go',
    'gem',
    'composer',
]);
const INFRA_TYPES = new Set([
    'infra',
    'database',
    'queue',
    'cron',
    'config',
]);
function componentStratum(c) {
    if (PACKAGE_TYPES.has(c.type))
        return 'package';
    if (INFRA_TYPES.has(c.type))
        return 'infra';
    if (c.type === 'llm')
        return 'connection-llm';
    if (c.type === 'service')
        return 'connection-services';
    return '__other';
}
function connectionStratum(c) {
    const t = c.connection_type;
    if (t === 'imports' || t === 'uses-package')
        return 'connection-imports';
    if (t === 'service-call')
        return 'connection-services';
    if (t === 'schema-relation' || t === 'api-calls-db' || t === 'field-reference')
        return 'connection-prisma';
    if (t === 'prompt-location' || t === 'prompt-usage')
        return 'connection-llm';
    return '__other';
}
// ============================================================================
// PLAN SELECTION
// ============================================================================
function pickPlan(opts, lotSize) {
    // Caller forced a plan
    if (opts.plan) {
        if (opts.plan === 'AQL') {
            const p = chooseAQLPlan(lotSize);
            return { plan: 'AQL', n: p.n, c: p.c };
        }
        if (opts.plan === 'Cochran') {
            const n = cochranSize(0.05, 0.05, Z.Z_95, lotSize);
            return { plan: 'Cochran', n, c: 0 };
        }
        // SPRT — initial batch sized like AQL; SPRT verdict computed on observations
        const p = chooseAQLPlan(lotSize);
        return { plan: 'SPRT', n: p.n, c: p.c };
    }
    // Auto: forceCochran (prior breach) > SPRT (≥3 audits in history) > AQL.
    if (opts.forceCochran) {
        const n = cochranSize(0.05, 0.05, Z.Z_95, lotSize);
        return { plan: 'Cochran', n, c: 0 };
    }
    if ((opts.priorAuditCount ?? 0) >= 3) {
        const p = chooseAQLPlan(lotSize);
        return { plan: 'SPRT', n: p.n, c: p.c };
    }
    const p = chooseAQLPlan(lotSize);
    return { plan: 'AQL', n: p.n, c: p.c };
}
// ============================================================================
// ORCHESTRATOR
// ============================================================================
export async function runAudit(scanResult, config, projectRoot, opts = {}) {
    if (opts.skip)
        return null;
    const { components, connections } = scanResult;
    // Lot size = total facts (components + connections). Used to pick the plan.
    const lotSize = components.length + connections.length;
    if (lotSize === 0) {
        // Empty scan — emit a minimal report so downstream tooling sees the slot.
        return {
            plan: 'AQL',
            n: 0,
            c: 0,
            sampled: 0,
            defects: 0,
            defect_rate: 0,
            by_class: {},
            by_stratum: {},
            llm_skipped: !opts.isMcpMode,
            verdict: 'accept',
            timestamp: Date.now(),
        };
    }
    const { plan, n: planN, c: planC } = pickPlan(opts, lotSize);
    // Stratified sample across components + connections (treated as one population).
    const componentSamples = selectAuditSample(components, Math.ceil(planN * 0.5), componentStratum, undefined, opts.rand);
    const connectionSamples = selectAuditSample(connections, Math.floor(planN * 0.5), connectionStratum, undefined, opts.rand);
    // Build verifier context.
    const componentById = new Map();
    for (const c of components)
        componentById.set(c.component_id, c);
    const hashes = await loadHashes(config, projectRoot);
    const ctx = {
        projectRoot,
        hashes,
        componentById,
        isMcpMode: !!opts.isMcpMode,
    };
    // Sample of files for stale-ref + missed-edge verifiers.
    const allFiles = hashes ? Object.keys(hashes.files) : [];
    const fileSampleCount = Math.min(Math.max(5, Math.floor(planN * 0.2)), allFiles.length);
    const fileSamples = allFiles.length > 0
        ? selectAuditSample(allFiles, fileSampleCount, () => '__files', undefined, opts.rand).samples
        : [];
    // Run all verifiers in parallel.
    const [v1, v2, v3, v4, v6] = await Promise.all([
        verifyHallucinatedComponent(componentSamples.samples, ctx),
        Promise.resolve(verifyHallucinatedEdge(connectionSamples.samples, ctx)),
        verifyWrongEndpoint(connectionSamples.samples, ctx),
        verifyStaleReference(fileSamples, ctx),
        Promise.resolve(verifyMissedEdge(fileSamples, connections, ctx)),
    ]);
    const v5 = verifyDedupCollision(components); // graph-wide invariant, always
    const verifiers = [v1, v2, v3, v4, v5, v6];
    // Aggregate by class.
    const by_class = {};
    for (const v of verifiers) {
        by_class[v.class] = { sampled: v.sampledCount, defects: v.defectCount };
    }
    // Aggregate by stratum (components + connections).
    const stratumAgg = {};
    const compEvidenceById = new Map();
    for (const e of v1.samples)
        compEvidenceById.set(e.id, e);
    for (const c of componentSamples.samples) {
        const s = componentStratum(c);
        if (!stratumAgg[s])
            stratumAgg[s] = { sampled: 0, defects: 0 };
        stratumAgg[s].sampled++;
        if (compEvidenceById.get(c.component_id)?.ok === false)
            stratumAgg[s].defects++;
    }
    const connEvidenceById = new Map();
    for (const e of v2.samples)
        connEvidenceById.set(e.id, e);
    // Merge v3 evidence on top — a connection failing either is one defect for stratum.
    const connDefectIds = new Set();
    for (const e of v2.samples)
        if (!e.ok)
            connDefectIds.add(e.id);
    for (const e of v3.samples)
        if (!e.ok)
            connDefectIds.add(e.id);
    for (const c of connectionSamples.samples) {
        const s = connectionStratum(c);
        if (!stratumAgg[s])
            stratumAgg[s] = { sampled: 0, defects: 0 };
        stratumAgg[s].sampled++;
        if (connDefectIds.has(c.connection_id))
            stratumAgg[s].defects++;
    }
    const by_stratum = {};
    for (const [k, v] of Object.entries(stratumAgg)) {
        by_stratum[k] = {
            sampled: v.sampled,
            defects: v.defects,
            defect_rate: v.sampled > 0 ? v.defects / v.sampled : 0,
        };
    }
    // Total sampled count (sum of distinct facts inspected — DEDUP_COLLISION
    // scans the whole population so we exclude its sampledCount from the totals
    // to avoid double-counting; we DO count its defects).
    const sampled = v1.sampledCount + v2.sampledCount + v3.sampledCount + v4.sampledCount + v6.sampledCount;
    const defects = v1.defectCount + v2.defectCount + v3.defectCount + v4.defectCount + v5.defectCount + v6.defectCount;
    const llm_skipped = !!v6.llm_skipped;
    // Compute verdict.
    let verdict;
    if (plan === 'SPRT') {
        // Build observation sequence from per-fact ok/defect across deterministic verifiers.
        const obs = [];
        for (const e of v1.samples)
            obs.push(e.ok ? 0 : 1);
        for (const e of v2.samples)
            obs.push(e.ok ? 0 : 1);
        for (const e of v3.samples)
            obs.push(e.ok ? 0 : 1);
        for (const e of v4.samples)
            obs.push(e.ok ? 0 : 1);
        const step = sprtNext(obs, 0.01, 0.05, 0.05, 0.05);
        verdict = step.verdict;
    }
    else {
        // AQL / Cochran: compare defects to acceptance number.
        // Cochran has c=0 (any defect → reject); AQL has plan-specific c.
        verdict = defects <= planC ? 'accept' : 'reject';
    }
    // Collect defect evidence (cap at 20).
    const defect_evidence = [];
    for (const v of verifiers) {
        for (const e of v.samples) {
            if (!e.ok && defect_evidence.length < 20)
                defect_evidence.push(e);
        }
        if (defect_evidence.length >= 20)
            break;
    }
    return {
        plan,
        n: planN,
        c: planC,
        sampled,
        defects,
        defect_rate: sampled > 0 ? defects / sampled : 0,
        by_class,
        by_stratum,
        llm_skipped,
        verdict,
        timestamp: Date.now(),
        ...(defect_evidence.length > 0 ? { defect_evidence } : {}),
    };
}
// ============================================================================
// EWMA UPDATE (called after runAudit returns; mutates and returns new state map)
// ============================================================================
export function updateEwmaForAudit(prior, report) {
    const next = { ...(prior ?? {}) };
    let anyBreach = false;
    for (const [stratum, stats] of Object.entries(report.by_stratum)) {
        const prev = next[stratum] ?? newEwmaState();
        const result = updateEwma(prev, stats.defect_rate);
        next[stratum] = result.state;
        if (result.breach)
            anyBreach = true;
    }
    return { ewma: next, anyBreach };
}
//# sourceMappingURL=index.js.map