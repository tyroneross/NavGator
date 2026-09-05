/**
 * `navgator audit-report` — Run 4 (2026-09-05).
 *
 * Reads the stored audit history (timeline entries carrying `audit`), the
 * per-stratum control-chart state on index.json, and prints:
 *   - the last N audits (plan, distinct facts sampled, defects, rate + 95% CI, verdict)
 *   - the c=0 screen with its producer's-risk caveat
 *   - the census (exact unresolved-endpoint count, by type and top dir)
 *   - oracle precision/recall with intervals (stored from the last scan, or
 *     recomputed live with --oracles / --scip)
 *   - chart state per stratum (phase, centre, limits, last points, signals)
 *   - optional --self-test: plants K defects per class into an in-memory
 *     clone of the graph and reports per-class instrument recall.
 *
 * Output: --md (default) or --json. Read-only except for the SCIP indexer's
 * temp file when --scip is passed.
 */
import { getConfig } from '../../config.js';
import { loadAllComponents, loadAllConnections, loadHashes, loadIndex } from '../../storage.js';
import { loadTimeline } from '../../diff.js';
import { NAVGATOR_VERSION } from '../../version.js';
import { runOracles } from '../../audit/oracles/index.js';
import { runSelfTest } from '../../audit/self-test.js';
import { proportionInterval } from '../../audit/sampler.js';
import { PHASE1_SUBGROUPS } from '../../audit/spc.js';
import { checkDataAvailability } from './helpers.js';
import { EXIT_CODES } from '../exit-codes.js';
export function registerAuditReportCommand(program) {
    program
        .command('audit-report')
        .description('Report the SQC self-audit: last audits, census, oracle precision/recall, control charts, optional self-test')
        .option('--json', 'Output as JSON')
        .option('--md', 'Output as Markdown (default)')
        .option('--last <n>', 'Number of recent audits to list', '5')
        .option('--self-test', 'Plant K defects per class into an in-memory clone of the graph and report instrument recall')
        .option('--k <n>', 'Defects planted per class for --self-test', '10')
        .option('--plan <plan>', 'Plan for --self-test: aql | sprt | cochran', 'aql')
        .option('--oracles', 'Recompute manifest oracles live from the stored graph (npm, prisma, cron, queue)')
        .option('--scip', 'Also run the SCIP imports oracle live (spawns scip-typescript; implies --oracles)')
        .option('--scip-timeout <ms>', 'SCIP indexer timeout in ms (default 120000; env NAVGATOR_SCIP_TIMEOUT_MS)')
        .option('--trust-target-deps', "Let the prisma oracle import @prisma/internals from the audited repo's node_modules (executes its code)")
        .action(async (options) => {
        try {
            const dataWarning = checkDataAvailability();
            if (dataWarning) {
                console.log(dataWarning);
                process.exitCode = EXIT_CODES.NO_DATA;
                return;
            }
            const config = getConfig();
            const root = process.cwd();
            const index = (await loadIndex(config));
            if (!index) {
                console.log('No architecture data found. Run `navgator scan` first.');
                process.exitCode = EXIT_CODES.NO_DATA;
                return;
            }
            const timeline = await loadTimeline(config, root);
            const lastN = Math.max(1, parseInt(options.last ?? '5', 10) || 5);
            const withAudit = timeline.entries.filter((e) => e.audit);
            const recent = withAudit.slice(-lastN).reverse();
            const data = {
                navgator_version: NAVGATOR_VERSION,
                project_root: root,
                generated_at: Date.now(),
                audit_history_count: index.audit_history_count ?? withAudit.length,
                pending_drift_breach: !!index.pending_drift_breach,
                audits: recent.map((e) => {
                    const a = e.audit;
                    return {
                        timestamp: e.timestamp,
                        scan_type: e.scan_type,
                        plan: a.plan,
                        n: a.n,
                        sampled: a.sampled,
                        defects: a.defects,
                        defect_rate: a.defect_rate,
                        ci: proportionInterval(a.defects, a.sampled),
                        verdict: a.verdict,
                        drift_breach: !!a.drift_breach,
                        navgator_version: a.navgator_version,
                        screen: a.screen,
                        sprt: a.sprt,
                    };
                }),
                latest: withAudit.length > 0 ? withAudit[withAudit.length - 1].audit : null,
                charts: index.ewma ?? {},
            };
            const needGraph = options.oracles || options.scip || options.selfTest;
            if (needGraph) {
                const [components, connections, hashes] = await Promise.all([
                    loadAllComponents(config, root),
                    loadAllConnections(config, root),
                    loadHashes(config, root),
                ]);
                const componentById = new Map(components.map((c) => [c.component_id, c]));
                if (options.oracles || options.scip) {
                    data.live_oracles = await runOracles({ projectRoot: root, components, connections, componentById, hashes }, {
                        scip: !!options.scip,
                        scipTimeoutMs: Number(options.scipTimeout) || Number(process.env['NAVGATOR_SCIP_TIMEOUT_MS']) || undefined,
                        trustTargetDeps: !!options.trustTargetDeps || process.env['NAVGATOR_TRUST_TARGET_DEPS'] === '1',
                    });
                }
                if (options.selfTest) {
                    const planRaw = (options.plan ?? 'aql').toUpperCase();
                    const plan = planRaw === 'SPRT' ? 'SPRT' : planRaw === 'COCHRAN' ? 'Cochran' : 'AQL';
                    data.self_test = await runSelfTest({ components, connections }, { projectRoot: root, config, hashes, K: Math.max(1, parseInt(options.k ?? '10', 10) || 10), plan });
                }
            }
            if (options.json && !options.md) {
                console.log(JSON.stringify(data, null, 2));
            }
            else {
                console.log(renderMarkdown(data));
            }
        }
        catch (err) {
            console.error('audit-report failed:', err.message);
            process.exitCode = EXIT_CODES.OPERATIONAL;
        }
    });
}
// ============================================================================
// MARKDOWN
// ============================================================================
function pct(x, digits = 1) {
    if (x === null || x === undefined || !Number.isFinite(x))
        return 'n/a';
    return `${(x * 100).toFixed(digits)}%`;
}
function ci(i) {
    if (!i)
        return '';
    return `[${pct(i.lower)}, ${pct(i.upper)}]${i.method === 'clopper-pearson' ? ' CP' : ''}`;
}
function when(ts) {
    return new Date(ts).toISOString().replace('T', ' ').slice(0, 16);
}
export function renderMarkdown(d) {
    const out = [];
    out.push(`# NavGator audit report`);
    out.push('');
    out.push(`Project: \`${d.project_root}\`  `);
    out.push(`NavGator ${d.navgator_version} · ${d.audit_history_count} audits on record · generated ${when(d.generated_at)}`);
    if (d.pending_drift_breach)
        out.push(`\n**Pending drift breach** — next \`--auto\` scan promotes to full + Cochran.`);
    out.push('');
    // ---- Recent audits ----
    out.push(`## Last ${d.audits.length} audits`);
    out.push('');
    if (d.audits.length === 0)
        out.push('_No audits stored on the timeline yet. Run `navgator scan`._');
    else {
        out.push('| When | Plan | Requested n | Distinct facts | Defects | Rate [95% CI] | Verdict | Breach |');
        out.push('|---|---|---:|---:|---:|---|---|---|');
        for (const a of d.audits) {
            out.push(`| ${when(a.timestamp)} | ${a.plan}${a.sprt ? ` (${a.sprt.batches} batch${a.sprt.batches === 1 ? '' : 'es'})` : ''} | ${a.n} | ${a.sampled} | ${a.defects} | ${pct(a.defect_rate)} ${ci(a.ci)} | ${a.verdict} | ${a.drift_breach ? 'yes' : 'no'} |`);
        }
    }
    out.push('');
    const L = d.latest;
    if (L) {
        // ---- Screen ----
        if (L.screen) {
            const s = L.screen;
            out.push(`## c=0 screen (latest)`);
            out.push('');
            const inspected = s.inspected ?? s.components_sampled + s.connections_sampled;
            out.push(`n=${s.n} per population (components ${s.components_sampled}, connections ${s.connections_sampled}; ${inspected} evaluable units inspected${s.unverifiable ? `, ${s.unverifiable} unverifiable` : ''}), LTPD ${pct(s.ltpd, 0)}, consumer's risk ${pct(s.consumer_risk, 0)}, reject on any defect across both → **${s.defects} defect${s.defects === 1 ? '' : 's'}, ${s.verdict}**.`);
            out.push('');
            if (s.defects === 0)
                out.push(`Zero defects across ${inspected} units licenses: 95% one-sided confidence the true error rate is ≤ ${pct(s.upper_bound_95)}.`);
            out.push(`Producer's risk of the combined screen: a map that is truly 99% correct fails it ${pct(s.producers_risk_at_1pct, 0)} of the time` +
                (s.per_population ? ` (one population of n=${s.per_population.n} alone: ${pct(s.per_population.producers_risk_at_1pct, 0)}, bound ≤ ${pct(s.per_population.upper_bound_95)})` : '') +
                `. **Triage, never a gate.**`);
            if (L.sprt) {
                out.push('');
                out.push(`SPRT (plan ${L.plan}): ${L.sprt.verdict ?? 'n/a'} after ${L.sprt.batches} batch${L.sprt.batches === 1 ? '' : 'es'}, ${L.sprt.observations}/${L.sprt.cap} observations, log LR ${L.sprt.log_lr.toFixed(2)}. Observations are the stratified, floor-oversampled sample of both populations (biased toward reject); the c=0 screen above is the report verdict.`);
            }
            if (L.unverifiable) {
                out.push('');
                out.push(`${L.unverifiable} inspected facts were unverifiable (no config file or declaring file recorded); they are excluded from every rate above.`);
            }
            out.push('');
        }
        // ---- Precision design + strata ----
        if (L.precision) {
            const p = L.precision;
            out.push(`## Precision sample (latest)`);
            out.push('');
            out.push(`${p.kind} design (±${pct(p.margin, 0)}): ${p.n_components} components + ${p.n_connections} connections, Neyman allocation with floor n_h ≥ ${p.floor}.` +
                (p.pooled_strata.length > 0 ? ` Pooled (N_h < floor): ${p.pooled_strata.join(', ')}.` : ''));
            out.push('');
        }
        const classes = Object.entries(L.by_class);
        if (classes.length > 0) {
            out.push('| Verifier | Inspected | Defects | Unverifiable |');
            out.push('|---|---:|---:|---:|');
            for (const [k, v] of classes)
                out.push(`| ${k} | ${v.sampled} | ${v.defects} | ${v.unverifiable ?? 0} |`);
            out.push('');
        }
        const strata = Object.entries(L.by_stratum);
        if (strata.length > 0) {
            out.push('| Stratum | N_h | Sampled | Defects | Rate [95% CI] | Pooled |');
            out.push('|---|---:|---:|---:|---|---|');
            for (const [k, v] of strata.sort((a, b) => a[0].localeCompare(b[0]))) {
                out.push(`| ${k} | ${v.n_total ?? ''} | ${v.sampled} | ${v.defects} | ${pct(v.defect_rate)} ${ci(v.ci)} | ${v.pooled ? 'yes' : ''} |`);
            }
            out.push('');
        }
        // ---- Census ----
        if (L.census) {
            const c = L.census.unresolved_endpoints;
            out.push(`## Census (exact, never sampled)`);
            out.push('');
            out.push(`Unresolved endpoints: **${c.bad} / ${c.total}** (${pct(c.rate, 2)} ${ci(c.ci)}). Dedup collisions: ${L.census.dedup_collisions}.`);
            out.push('');
            const types = Object.entries(c.by_type).filter(([, v]) => v.bad > 0).sort((a, b) => b[1].bad - a[1].bad);
            if (types.length > 0) {
                out.push('| Connection type | Bad | Total |');
                out.push('|---|---:|---:|');
                for (const [t, v] of types)
                    out.push(`| ${t} | ${v.bad} | ${v.total} |`);
                out.push('');
            }
            const dirs = Object.entries(c.by_top_dir).filter(([, v]) => v.bad > 0);
            if (dirs.length > 0) {
                out.push('| Top dir | Bad | Total |');
                out.push('|---|---:|---:|');
                for (const [t, v] of dirs)
                    out.push(`| ${t} | ${v.bad} | ${v.total} |`);
                out.push('');
            }
        }
    }
    // ---- Oracles ----
    const oracles = d.live_oracles ?? L?.oracles;
    out.push(`## Oracles ${d.live_oracles ? '(recomputed live)' : '(stored with latest audit)'}`);
    out.push('');
    if (!oracles || oracles.length === 0)
        out.push('_No oracle results. Run `navgator scan` (or `audit-report --oracles`)._');
    else {
        out.push('| Oracle | Stratum | Strength | Truth | Map | TP | FP | FN | Precision [95% CI] | Recall [95% CI] | Frame |');
        out.push('|---|---|---|---:|---:|---:|---:|---:|---|---|---|');
        for (const o of oracles) {
            out.push(`| ${o.oracle} | ${o.stratum} | ${o.oracle_strength} | ${o.truth_count} | ${o.map_count} | ${o.tp} | ${o.fp} | ${o.fn} | ${pct(o.precision)} ${ci(o.precision_ci)} | ${pct(o.recall)} ${ci(o.recall_ci)} | ${o.frame_coverage !== undefined ? pct(o.frame_coverage, 0) : ''} |`);
        }
        out.push('');
        for (const o of oracles) {
            const bits = [];
            if (o.fp_samples.length > 0)
                bits.push(`FP e.g. ${o.fp_samples.slice(0, 5).map((s) => `\`${s}\``).join(', ')}`);
            if (o.fn_samples.length > 0)
                bits.push(`FN e.g. ${o.fn_samples.slice(0, 5).map((s) => `\`${s}\``).join(', ')}`);
            const notes = o.notes.length > 0 ? o.notes.join('; ') : '';
            if (bits.length > 0 || notes)
                out.push(`- **${o.oracle}**: ${[...bits, notes].filter(Boolean).join(' — ')}`);
        }
        out.push('');
    }
    // ---- Charts ----
    out.push(`## Control charts`);
    out.push('');
    const charts = Object.entries(d.charts);
    if (charts.length === 0)
        out.push('_No chart state yet._');
    else {
        out.push(`Phase I needs ${PHASE1_SUBGROUPS} subgroups before limits freeze; provisional series cannot breach. Rules: WE-1 (3σ) and WE-4 (8 one side) + EWMA(λ=0.2, L=2.7) + CUSUM(k=0.5σ, h=5σ).`);
        out.push('');
        out.push('| Stratum | Kind | Phase | Points | Centre | Last x (n) | UCL / LCL | EWMA (UCL/LCL) | CUSUM hi/lo | Signals | Version |');
        out.push('|---|---|---|---:|---|---|---|---|---|---|---|');
        for (const [k, s] of charts.sort((a, b) => a[0].localeCompare(b[0]))) {
            if (!(s.n > 0))
                continue; // (a): never render an empty series
            const phase = s.phase ?? 'legacy (pre-Run 4 state, no version; re-baselines on next update)';
            const last = s.last;
            const centre = s.center !== undefined ? `${pct(s.center, 2)}${s.floor_active ? ' (floor)' : ''}` : pct(s.mean, 2);
            out.push(`| ${k} | ${s.kind ?? 'p'} | ${phase} | ${s.n} | ${centre} | ${last ? `${pct(last.x, 2)} (${last.n})` : ''} | ${last && s.phase === 'frozen' ? `${pct(last.ucl, 2)} / ${pct(last.lcl, 2)}` : ''} | ${last && s.phase === 'frozen' ? `${pct(last.ewma, 2)} (${pct(last.ewma_ucl, 2)}/${pct(last.ewma_lcl, 2)})` : ''} | ${s.cusum ? `${s.cusum.s_hi.toFixed(2)} / ${s.cusum.s_lo.toFixed(2)}` : ''} | ${(s.signals ?? []).join(', ') || (s.breach_pending ? 'legacy-breach' : '')} | ${s.version ?? ''}${s.rebaselined_from ? ` (re-baselined from ${s.rebaselined_from})` : ''} |`);
        }
        out.push('');
        const withPoints = charts.filter(([, s]) => s.points.length > 0);
        if (withPoints.length > 0) {
            out.push('Last points (EWMA deviation from centre):');
            out.push('');
            for (const [k, s] of withPoints)
                out.push(`- \`${k}\`: ${s.points.slice(-10).map((p) => (p * 100).toFixed(2)).join(', ')} (pp)`);
            out.push('');
        }
    }
    // ---- Self-test ----
    if (d.self_test) {
        const t = d.self_test;
        out.push(`## Self-test (K=${t.K} per class, plan ${t.plan}) — ${t.pass ? 'PASS' : 'FAIL'}`);
        out.push('');
        out.push('Five deterministic classes tested; MISSED_EDGE untestable in CLI mode (LLM-only).');
        out.push('');
        out.push('| Class | Testable | Planted | Detected | Recall |');
        out.push('|---|---|---:|---:|---|');
        for (const c of t.classes) {
            out.push(`| ${c.class} | ${c.testable ? 'yes' : `no — ${c.note ?? ''}`} | ${c.planted} | ${c.detected} | ${c.recall === null ? 'n/a' : pct(c.recall, 0)} |`);
        }
        out.push('');
        const sp = t.sampling_power;
        out.push(`Instrument recall above is conditional on inspection. Sampling power of this plan: a single defective component lands in the sample with p=${pct(sp.p_single_component)} (n=${sp.n_components}/N=${sp.N_components}), a connection with p=${pct(sp.p_single_connection)} (n=${sp.n_connections}/N=${sp.N_connections}); the c=0 screen rejects a map at LTPD 5% with p=${pct(sp.screen_power_at_ltpd, 0)}.`);
        if (t.notes.length > 0) {
            out.push('');
            for (const n of t.notes)
                out.push(`- ${n}`);
        }
        out.push('');
    }
    return out.join('\n');
}
//# sourceMappingURL=audit-report.js.map