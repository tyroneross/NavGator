/**
 * NavGator audit self-test — Run 4 (2026-09-05).
 *
 * "A gate is not evidence until it has failed on a planted defect." This
 * module clones the stored graph IN MEMORY, plants K known defects per class,
 * runs the real audit at the stated plan with the planted facts guaranteed to
 * be inspected, and reports per-class recall of the instrument.
 *
 * What it measures: verifier sensitivity — given that a defective fact is
 * inspected, does the verifier flag it? Sampling power (the chance a random
 * sample reaches a given defect) is a separate number reported alongside as
 * `sampling_power`, computed from the plan, not from the plant. Research
 * packet §2.5(c): a seeded-defect check "measures recall on changes ... it
 * does not estimate recall on the standing map."
 *
 * Nothing is written to disk. MISSED_EDGE is LLM-only and reported not-testable.
 */
import * as fs from 'fs';
import * as path from 'path';
import { runAudit } from './index.js';
import { cochranSize, producersRisk, Z } from './sampler.js';
const PREFIX = '__navgator_selftest_';
function clone(o) {
    return JSON.parse(JSON.stringify(o));
}
/** Pick a real, existing source file to anchor planted facts to. */
function pickExistingFile(root, hashes, connections) {
    const candidates = [];
    if (hashes?.files)
        candidates.push(...Object.keys(hashes.files));
    for (const c of connections)
        if (c.code_reference?.file)
            candidates.push(c.code_reference.file);
    candidates.push('package.json');
    for (const rel of candidates) {
        try {
            if (fs.statSync(path.join(root, rel)).isFile())
                return rel;
        }
        catch {
            /* try next */
        }
    }
    return null;
}
export async function runSelfTest(graph, opts) {
    const K = opts.K ?? 10;
    const threshold = opts.threshold ?? 0.9;
    const plan = opts.plan ?? 'AQL';
    const notes = [];
    const components = graph.components.map((c) => clone(c));
    const connections = graph.connections.map((c) => clone(c));
    const now = Date.now();
    const anchorFile = pickExistingFile(opts.projectRoot, opts.hashes, connections);
    const anchorComp = components[0];
    if (!anchorComp) {
        notes.push('graph has no components; nothing to plant');
    }
    const planted = {
        HALLUCINATED_COMPONENT: [],
        HALLUCINATED_EDGE: [],
        WRONG_ENDPOINT: [],
        STALE_REFERENCE: [],
        DEDUP_COLLISION: [],
        MISSED_EDGE: [],
    };
    const forceComponents = [];
    const forceConnections = [];
    const forceFiles = [];
    // ---- HALLUCINATED_COMPONENT: config file that does not exist ----
    for (let i = 0; i < K; i++) {
        const id = `COMP${PREFIX}hc_${i}`;
        const comp = {
            component_id: id,
            name: `${PREFIX}hc_${i}`,
            type: 'config',
            role: { purpose: 'self-test plant', layer: 'infra', critical: false },
            source: { detection_method: 'manual', config_files: [`.navgator-selftest/missing-${i}.json`], confidence: 1 },
            connects_to: [],
            connected_from: [],
            status: 'active',
            tags: ['selftest'],
            timestamp: now,
            last_updated: now,
        };
        components.push(comp);
        forceComponents.push(comp);
        planted.HALLUCINATED_COMPONENT.push(id);
    }
    // ---- HALLUCINATED_EDGE: `to` endpoint not in the graph ----
    if (anchorComp && anchorFile) {
        for (let i = 0; i < K; i++) {
            const id = `CONN${PREFIX}he_${i}`;
            const conn = {
                connection_id: id,
                from: { component_id: anchorComp.component_id, location: { file: anchorFile, line: 1 } },
                to: { component_id: `COMP${PREFIX}missing_${i}` },
                connection_type: 'imports',
                code_reference: { file: anchorFile, symbol: 'selftest' },
                detected_from: 'selftest',
                confidence: 1,
                timestamp: now,
                last_verified: now,
            };
            connections.push(conn);
            forceConnections.push(conn);
            planted.HALLUCINATED_EDGE.push(id);
        }
    }
    else
        notes.push('HALLUCINATED_EDGE not planted: no anchor component/file');
    // ---- WRONG_ENDPOINT: target exists, but neither symbol nor target name is in the file ----
    if (anchorComp && anchorFile) {
        for (let i = 0; i < K; i++) {
            const targetId = `COMP${PREFIX}we_target_${i}`;
            const target = {
                component_id: targetId,
                name: `${PREFIX}absent_name_${i}`,
                type: 'service',
                role: { purpose: 'self-test plant', layer: 'external', critical: false },
                source: { detection_method: 'manual', config_files: [anchorFile], confidence: 1 },
                connects_to: [],
                connected_from: [],
                status: 'active',
                tags: ['selftest'],
                timestamp: now,
                last_updated: now,
            };
            components.push(target);
            const id = `CONN${PREFIX}we_${i}`;
            const conn = {
                connection_id: id,
                from: { component_id: anchorComp.component_id, location: { file: anchorFile, line: 1 } },
                to: { component_id: targetId },
                connection_type: 'service-call',
                code_reference: { file: anchorFile, symbol: `${PREFIX}absent_symbol_${i}` },
                detected_from: 'selftest',
                confidence: 1,
                timestamp: now,
                last_verified: now,
            };
            connections.push(conn);
            forceConnections.push(conn);
            planted.WRONG_ENDPOINT.push(id);
        }
    }
    else
        notes.push('WRONG_ENDPOINT not planted: no anchor component/file');
    // ---- STALE_REFERENCE: recorded hash altered for K existing files ----
    let hashes = opts.hashes ? clone(opts.hashes) : null;
    if (hashes?.files) {
        const existing = Object.keys(hashes.files).filter((rel) => {
            try {
                return fs.statSync(path.join(opts.projectRoot, rel)).isFile();
            }
            catch {
                return false;
            }
        });
        for (const rel of existing.slice(0, K)) {
            hashes.files[rel] = { ...hashes.files[rel], hash: `${PREFIX}${'0'.repeat(40)}` };
            forceFiles.push(rel);
            planted.STALE_REFERENCE.push(rel);
        }
        if (existing.length < K)
            notes.push(`STALE_REFERENCE: only ${existing.length} recorded files exist on disk (wanted ${K})`);
    }
    else {
        hashes = null;
        notes.push('STALE_REFERENCE not planted: no hashes.json');
    }
    // ---- DEDUP_COLLISION: duplicate (type, name, primary config) triples ----
    const originals = graph.components.slice(0, K);
    for (let i = 0; i < originals.length; i++) {
        const src = originals[i];
        const id = `COMP${PREFIX}dup_${i}`;
        const dup = { ...clone(src), component_id: id, stable_id: undefined };
        components.push(dup);
        planted.DEDUP_COLLISION.push(id);
    }
    // ---- Run the real audit with the planted facts forced into the inspection set ----
    const auditOpts = {
        plan,
        hashes,
        rand: opts.rand,
        isMcpMode: opts.isMcpMode,
        oracles: false,
        evidenceCap: Number.MAX_SAFE_INTEGER,
        forceInclude: { components: forceComponents, connections: forceConnections, files: forceFiles },
        disabledVerifiers: opts.disabledVerifiers,
        priorAuditCount: 1, // routine sizes; the plant is what we measure, not the sample
    };
    const report = await runAudit({ components, connections }, opts.config, opts.projectRoot, auditOpts);
    if (!report)
        throw new Error('self-test: audit returned null');
    const detectedByClass = new Map();
    for (const e of report.defect_evidence ?? []) {
        if (e.ok || !e.class)
            continue;
        let s = detectedByClass.get(e.class);
        if (!s) {
            s = new Set();
            detectedByClass.set(e.class, s);
        }
        s.add(e.id);
    }
    const classes = Object.keys(planted).map((cls) => {
        if (cls === 'MISSED_EDGE') {
            return { class: cls, testable: false, planted: 0, detected: 0, recall: null, missed_ids: [], note: 'MISSED_EDGE untestable in CLI mode (LLM-only verifier)' };
        }
        const ids = planted[cls];
        if (ids.length === 0)
            return { class: cls, testable: false, planted: 0, detected: 0, recall: null, missed_ids: [], note: 'nothing planted' };
        const det = detectedByClass.get(cls) ?? new Set();
        const hit = ids.filter((id) => det.has(id));
        return {
            class: cls,
            testable: true,
            planted: ids.length,
            detected: hit.length,
            recall: hit.length / ids.length,
            missed_ids: ids.filter((id) => !det.has(id)).slice(0, 10),
        };
    });
    const testable = classes.filter((c) => c.testable);
    const pass = testable.length > 0 && testable.every((c) => (c.recall ?? 0) >= threshold);
    const N_components = graph.components.length;
    const N_connections = graph.connections.length;
    const n_components = report.precision?.n_components ?? 0;
    const n_connections = report.precision?.n_connections ?? 0;
    return {
        K,
        plan,
        threshold,
        pass,
        classes,
        sampling_power: {
            N_components,
            N_connections,
            n_components,
            n_connections,
            p_single_component: N_components > 0 ? Math.min(1, n_components / N_components) : 0,
            p_single_connection: N_connections > 0 ? Math.min(1, n_connections / N_connections) : 0,
            screen_power_at_ltpd: producersRisk(report.screen?.n ?? 45, 0.05),
        },
        notes: [
            'five deterministic classes tested (HALLUCINATED_COMPONENT, HALLUCINATED_EDGE, WRONG_ENDPOINT, STALE_REFERENCE, DEDUP_COLLISION); MISSED_EDGE untestable in CLI mode (LLM-only)',
            ...notes,
            `founding connection sample for this population would be n=${N_connections > 0 ? cochranSize(0.9, 0.03, Z.Z_95, N_connections) : 0}`,
        ],
        audit: { sampled: report.sampled, defects: report.defects, verdict: report.verdict },
    };
}
//# sourceMappingURL=self-test.js.map