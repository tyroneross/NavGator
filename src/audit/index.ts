/**
 * NavGator audit orchestrator — Run 2 / D4, reworked in Run 4 (2026-09-05).
 *
 * Per scan:
 *   1. CENSUS — invariants that can be counted exactly (unresolved endpoints,
 *      dedup collisions) are counted over the whole population, never sampled.
 *   2. ORACLES — precision/recall of the stored map against manifests the
 *      scanner never read (package.json, prisma schema, vercel crons, queue
 *      literals, optional SCIP index). See ./oracles.
 *   3. SCREEN — c=0, n=45 per population at LTPD 5% / β 10%. Zero defects
 *      licenses "95% one-sided confidence true error ≤ 6.4%". Producer's risk on
 *      a 99%-correct map is 36%, so the verdict is triage, never a gate
 *      (research packet §1.3–1.4, protocol steps 6–7).
 *   4. PRECISION SAMPLE — founding n≈370 connections / 200 components (±3pp)
 *      on the first audit or Cochran; routine n≈137 (±5pp) otherwise. Neyman
 *      allocation with a floor of n_h ≥ 30; strata below the floor are sampled
 *      in full and charted under `__pooled` (protocol step 8).
 *   5. VERIFIERS — the six deterministic/LLM checks run once over the union of
 *      inspected facts; `sampled` counts DISTINCT facts (Run 4 defect 3).
 *   6. SPRT — when selected, draws continuation batches until a verdict or the
 *      founding-sample cap, else `inconclusive` (Run 4 defect 4).
 *   7. CHARTS — per-stratum p-chart + EWMA + CUSUM with Phase I/II and version
 *      re-baseline (see ./spc), plus a u-chart on the census series.
 *
 * Hooked from scanner.ts after Phase 4 storage. Must NOT throw out of a scan.
 */

import type {
  ArchitectureComponent,
  ArchitectureConnection,
  AuditPrecisionDesign,
  AuditReport,
  AuditSampleEvidence,
  AuditScreen,
  AuditStratumStats,
  ComponentType,
  ConnectionType,
  NavGatorConfig,
  NavHashes,
} from '../types.js';
import { NAVGATOR_VERSION } from '../version.js';
import { loadHashes } from '../storage.js';
import {
  cochranSize,
  producersRisk,
  proportionInterval,
  sampleWithoutReplacement,
  selectStratifiedSample,
  sprtNext,
  Z,
  zeroAcceptanceN,
  zeroDefectUpperBound,
} from './sampler.js';
import { newEwmaState, updateChart, type EwmaState } from './spc.js';
import {
  type DefectClass,
  type SampleEvidence,
  type VerifierContext,
  type VerifierOutcome,
  verifyDedupCollision,
  verifyHallucinatedComponent,
  verifyHallucinatedEdge,
  verifyMissedEdge,
  verifyStaleReference,
  verifyWrongEndpoint,
} from './verifiers.js';
import { runCensus, runOracles } from './oracles/index.js';

export type { AuditReport } from '../types.js';

// ============================================================================
// PUBLIC TYPES
// ============================================================================

export type AuditPlan = 'AQL' | 'SPRT' | 'Cochran';

export interface AuditOptions {
  /** Override plan selection. */
  plan?: AuditPlan;
  /** Skip the audit entirely (returns null from runAudit). */
  skip?: boolean;
  /** Whether NavGator is running inside an MCP session (enables LLM-judge). */
  isMcpMode?: boolean;
  /** History — used to switch from AQL to SPRT and to seed Neyman priors. */
  priorEwma?: Record<string, EwmaState>;
  priorAuditCount?: number;
  /** Set when previous run breached the chart → forces Cochran (founding sizes). */
  forceCochran?: boolean;
  /** RNG injection for deterministic tests. */
  rand?: () => number;
  // ---- Run 4 ----
  /** Run the SCIP imports oracle (spawns scip-typescript). */
  scip?: boolean;
  /** Run manifest oracles (default true). */
  oracles?: boolean;
  /** Inject hashes instead of loading from storage (self-test). */
  hashes?: NavHashes | null;
  /** Facts that MUST be inspected in addition to the random sample (self-test). */
  forceInclude?: {
    components?: ReadonlyArray<ArchitectureComponent>;
    connections?: ReadonlyArray<ArchitectureConnection>;
    files?: ReadonlyArray<string>;
  };
  /** Verifiers to stub out (mutation testing of the self-test). */
  disabledVerifiers?: ReadonlyArray<DefectClass>;
  /** Max defect evidence rows kept on the report (default 20). */
  evidenceCap?: number;
  /** Per-stratum sample floor (default 30). */
  floor?: number;
  /** Allow the prisma oracle to import `@prisma/internals` from the TARGET repo (code execution from an audited repo; default false, env NAVGATOR_TRUST_TARGET_DEPS=1). */
  trustTargetDeps?: boolean;
  /** SCIP indexer timeout in ms (default 120000; env NAVGATOR_SCIP_TIMEOUT_MS). */
  scipTimeoutMs?: number;
}

// ============================================================================
// CONSTANTS (protocol steps 6 and 8)
// ============================================================================

export const SCREEN_LTPD = 0.05;
export const SCREEN_BETA = 0.10;
export const STRATUM_FLOOR = 30;
/** Expected precision used to size the sample: n₀ = z²p(1−p)/e² (packet §2.3). */
const P_EXPECTED = 0.9;
const FOUNDING_MARGIN = 0.03;
const ROUTINE_MARGIN = 0.05;
const FOUNDING_COMPONENTS = 200;
const DEFAULT_EVIDENCE_CAP = 20;

// ============================================================================
// STRATA KEYS
// ============================================================================

const PACKAGE_TYPES = new Set<ComponentType>(['npm', 'pip', 'spm', 'cargo', 'go', 'gem', 'composer']);
const INFRA_TYPES = new Set<ComponentType>(['infra', 'database', 'queue', 'cron', 'config']);

export function componentStratum(c: ArchitectureComponent): string {
  if (PACKAGE_TYPES.has(c.type)) return 'package';
  if (INFRA_TYPES.has(c.type)) return 'infra';
  if (c.type === 'llm') return 'connection-llm';
  if (c.type === 'service') return 'connection-services';
  return '__other';
}

export function connectionStratum(c: ArchitectureConnection): string {
  const t: ConnectionType = c.connection_type;
  if (t === 'imports' || t === 'uses-package') return 'connection-imports';
  if (t === 'service-call') return 'connection-services';
  if (t === 'schema-relation' || t === 'api-calls-db' || t === 'field-reference') return 'connection-prisma';
  if (t === 'prompt-location' || t === 'prompt-usage') return 'connection-llm';
  return '__other';
}

// ============================================================================
// PLAN SELECTION
// ============================================================================

function pickPlanLabel(opts: AuditOptions): AuditPlan {
  if (opts.plan) return opts.plan;
  if (opts.forceCochran) return 'Cochran';
  if ((opts.priorAuditCount ?? 0) >= 3) return 'SPRT';
  return 'AQL';
}

function precisionDesign(plan: AuditPlan, opts: AuditOptions, nComp: number, nConn: number): AuditPrecisionDesign {
  const founding = plan === 'Cochran' || (opts.priorAuditCount ?? 0) === 0;
  const margin = founding ? FOUNDING_MARGIN : ROUTINE_MARGIN;
  const nConnections = nConn > 0 ? Math.min(nConn, cochranSize(P_EXPECTED, margin, Z.Z_95, nConn)) : 0;
  const nComponents =
    nComp > 0
      ? Math.min(nComp, founding ? FOUNDING_COMPONENTS : cochranSize(P_EXPECTED, margin, Z.Z_95, nComp))
      : 0;
  return {
    kind: founding ? 'founding' : 'routine',
    margin,
    n_components: nComponents,
    n_connections: nConnections,
    floor: opts.floor ?? STRATUM_FLOOR,
    pooled_strata: [],
  };
}

// ============================================================================
// VERIFIER RUNNER (honours disabledVerifiers)
// ============================================================================

function disabledOutcome(cls: DefectClass, ids: ReadonlyArray<string>): VerifierOutcome {
  return {
    class: cls,
    sampledCount: ids.length,
    defectCount: 0,
    samples: ids.map((id) => ({ id, ok: true, reason: 'verifier-disabled' })),
  };
}

interface Inspection {
  compOk: Map<string, SampleEvidence>;
  connOk: Map<string, SampleEvidence>;
  fileOk: Map<string, SampleEvidence>;
  outcomes: VerifierOutcome[];
}

async function inspect(
  comps: ReadonlyArray<ArchitectureComponent>,
  conns: ReadonlyArray<ArchitectureConnection>,
  files: ReadonlyArray<string>,
  allConnections: ReadonlyArray<ArchitectureConnection>,
  ctx: VerifierContext,
  disabled: ReadonlySet<DefectClass>
): Promise<Inspection> {
  const [v1, v2, v3, v4, v6] = await Promise.all([
    disabled.has('HALLUCINATED_COMPONENT')
      ? disabledOutcome('HALLUCINATED_COMPONENT', comps.map((c) => c.component_id))
      : verifyHallucinatedComponent(comps, ctx),
    disabled.has('HALLUCINATED_EDGE')
      ? disabledOutcome('HALLUCINATED_EDGE', conns.map((c) => c.connection_id))
      : Promise.resolve(verifyHallucinatedEdge(conns, ctx)),
    disabled.has('WRONG_ENDPOINT')
      ? disabledOutcome('WRONG_ENDPOINT', conns.map((c) => c.connection_id))
      : verifyWrongEndpoint(conns, ctx),
    disabled.has('STALE_REFERENCE') ? disabledOutcome('STALE_REFERENCE', files) : verifyStaleReference(files, ctx),
    Promise.resolve(verifyMissedEdge(files, allConnections, ctx)),
  ]);

  const compOk = new Map<string, SampleEvidence>();
  for (const e of v1.samples) compOk.set(e.id, e);
  const connOk = new Map<string, SampleEvidence>();
  for (const e of v2.samples) connOk.set(e.id, e);
  for (const e of v3.samples) {
    const prev = connOk.get(e.id);
    if (!prev || prev.ok) connOk.set(e.id, e); // a connection failing either verifier is one defect
  }
  const fileOk = new Map<string, SampleEvidence>();
  for (const e of v4.samples) fileOk.set(e.id, e);

  return { compOk, connOk, fileOk, outcomes: [v1, v2, v3, v4, v6] };
}

// ============================================================================
// ORCHESTRATOR
// ============================================================================

function emptyReport(opts: AuditOptions): AuditReport {
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
    navgator_version: NAVGATOR_VERSION,
    census: runCensus([], []),
  };
}

export async function runAudit(
  scanResult: {
    components: ReadonlyArray<ArchitectureComponent>;
    connections: ReadonlyArray<ArchitectureConnection>;
  },
  config: NavGatorConfig,
  projectRoot: string,
  opts: AuditOptions = {}
): Promise<AuditReport | null> {
  if (opts.skip) return null;

  const { components, connections } = scanResult;
  const rand = opts.rand ?? Math.random;
  const disabled = new Set<DefectClass>(opts.disabledVerifiers ?? []);
  const evidenceCap = opts.evidenceCap ?? DEFAULT_EVIDENCE_CAP;
  const floor = opts.floor ?? STRATUM_FLOOR;

  if (components.length + connections.length === 0) return emptyReport(opts);

  const componentById = new Map<string, ArchitectureComponent>();
  for (const c of components) componentById.set(c.component_id, c);

  // ---- 1. Census (exact, whole population) ----
  const census = runCensus(components, connections, componentById);

  // ---- 2. Plan + design ----
  const plan = pickPlanLabel(opts);
  const design = precisionDesign(plan, opts, components.length, connections.length);
  const screenN = zeroAcceptanceN(SCREEN_LTPD, SCREEN_BETA); // 45

  // Neyman priors from the last chart centre per stratum (0.5 = max variance when unknown).
  const priorRates: Record<string, number> = {};
  for (const [k, s] of Object.entries(opts.priorEwma ?? {})) {
    const p = s.center ?? (s.n > 0 ? s.mean : undefined);
    if (p !== undefined && Number.isFinite(p)) priorRates[k] = Math.max(0.01, p);
  }

  // ---- 3. Screen: SRS of n=45 per population ----
  const screenComps = sampleWithoutReplacement(components, Math.min(screenN, components.length), rand);
  const screenConns = sampleWithoutReplacement(connections, Math.min(screenN, connections.length), rand);

  // ---- 4. Precision sample: stratified, Neyman + floor, pooled flags ----
  const compSample = selectStratifiedSample(components, design.n_components, componentStratum, { floor, priorRates, rand });
  const connSample = selectStratifiedSample(connections, design.n_connections, connectionStratum, { floor, priorRates, rand });
  // A stratum key can be shared by both populations (e.g. `connection-services`
  // holds 3 service components AND 395 service-call connections). Pooling is
  // decided on the COMBINED N_h, so a small component side cannot pool a
  // large connection side.
  const stratumTotals: Record<string, number> = {};
  for (const [k, v] of Object.entries(compSample.byStratum)) stratumTotals[k] = (stratumTotals[k] ?? 0) + v.total;
  for (const [k, v] of Object.entries(connSample.byStratum)) stratumTotals[k] = (stratumTotals[k] ?? 0) + v.total;
  const pooledStrata = new Set<string>();
  for (const [k, total] of Object.entries(stratumTotals)) if (total < floor) pooledStrata.add(k);
  design.pooled_strata = [...pooledStrata].sort();

  // ---- Union of inspected facts (distinct) ----
  const compById = new Map<string, ArchitectureComponent>();
  const connById = new Map<string, ArchitectureConnection>();
  const forcedComp = new Set<string>();
  const forcedConn = new Set<string>();
  for (const c of [...screenComps, ...compSample.samples]) compById.set(c.component_id, c);
  for (const c of [...screenConns, ...connSample.samples]) connById.set(c.connection_id, c);
  for (const c of opts.forceInclude?.components ?? []) {
    compById.set(c.component_id, c);
    forcedComp.add(c.component_id);
  }
  for (const c of opts.forceInclude?.connections ?? []) {
    connById.set(c.connection_id, c);
    forcedConn.add(c.connection_id);
  }

  // ---- Context ----
  const hashes = opts.hashes !== undefined ? opts.hashes : await loadHashes(config, projectRoot);
  const ctx: VerifierContext = { projectRoot, hashes, componentById, isMcpMode: !!opts.isMcpMode };

  const allFiles = hashes ? Object.keys(hashes.files) : [];
  const fileSampleCount = Math.min(Math.max(5, Math.floor(design.n_connections * 0.2)), allFiles.length);
  const fileSet = new Set<string>(allFiles.length > 0 ? sampleWithoutReplacement(allFiles, fileSampleCount, rand) : []);
  for (const f of opts.forceInclude?.files ?? []) fileSet.add(f);

  // ---- 5. Verifiers, once over the union ----
  const insp = await inspect([...compById.values()], [...connById.values()], [...fileSet], connections, ctx, disabled);
  const v5 = disabled.has('DEDUP_COLLISION') ? disabledOutcome('DEDUP_COLLISION', []) : verifyDedupCollision(components);
  const outcomes: VerifierOutcome[] = [...insp.outcomes, v5];

  // ---- 6. SPRT continuation (draw further batches from the unsampled remainder) ----
  //
  // F3 (documented approximation): the observation sequence is the stratified,
  // floor-oversampled precision sample of components AND connections treated
  // as one Bernoulli stream. It is not an iid draw from either population.
  // Direction of bias: the floor over-represents small, heuristic strata
  // (cron/queue/llm), which historically carry the highest defect rates, so the
  // observed rate is biased UPWARD relative to the pooled population rate and
  // the SPRT is conservative toward `reject`. The decision is about the union
  // of both populations. The c=0 screen (SRS) remains the report-level verdict.
  const obs: Array<0 | 1> = [];
  const isDefect = (e: SampleEvidence | undefined) => e !== undefined && !e.ok;
  const isUnverifiable = (e: SampleEvidence | undefined) => e !== undefined && !!e.unverifiable;
  const pushObs = (ids: Iterable<string>, m: Map<string, SampleEvidence>) => {
    for (const id of ids) {
      const e = m.get(id);
      if (isUnverifiable(e)) continue; // F5: no evidence → not an observation
      obs.push(isDefect(e) ? 1 : 0);
    }
  };
  const randomComps = new Set<string>([...compById.keys()].filter((id) => !forcedComp.has(id)));
  const randomConns = new Set<string>([...connById.keys()].filter((id) => !forcedConn.has(id)));
  pushObs(randomComps, insp.compOk);
  pushObs(randomConns, insp.connOk);

  let sprtInfo: AuditReport['sprt'] | undefined;
  if (plan === 'SPRT') {
    const cap =
      Math.min(components.length, FOUNDING_COMPONENTS) +
      Math.min(connections.length, cochranSize(P_EXPECTED, FOUNDING_MARGIN, Z.Z_95, connections.length));
    let step = sprtNext(obs, 0.01, 0.05, 0.05, 0.05);
    let batches = 1;
    const batchConn = Math.max(1, Math.ceil(design.n_connections / 2));
    const batchComp = Math.max(1, Math.ceil(design.n_components / 2));
    while (step.verdict === 'continue' && obs.length < cap) {
      const moreComps = selectStratifiedSample(components, batchComp, componentStratum, {
        floor: 0,
        priorRates,
        rand,
        exclude: new Set(compById.keys()),
        idOf: (c) => c.component_id,
      }).samples;
      const moreConns = selectStratifiedSample(connections, batchConn, connectionStratum, {
        floor: 0,
        priorRates,
        rand,
        exclude: new Set(connById.keys()),
        idOf: (c) => c.connection_id,
      }).samples;
      if (moreComps.length + moreConns.length === 0) break;
      const more = await inspect(moreComps, moreConns, [], connections, ctx, disabled);
      for (const c of moreComps) {
        compById.set(c.component_id, c);
        randomComps.add(c.component_id);
      }
      for (const c of moreConns) {
        connById.set(c.connection_id, c);
        randomConns.add(c.connection_id);
      }
      for (const [id, e] of more.compOk) insp.compOk.set(id, e);
      for (const [id, e] of more.connOk) insp.connOk.set(id, e);
      // Fold batch counts into the by_class tallies of the first three verifiers.
      for (let i = 0; i < 3; i++) {
        const o = outcomes[i]!;
        const b = more.outcomes[i]!;
        o.sampledCount += b.sampledCount;
        o.defectCount += b.defectCount;
        o.samples.push(...b.samples);
      }
      pushObs(moreComps.map((c) => c.component_id), more.compOk);
      pushObs(moreConns.map((c) => c.connection_id), more.connOk);
      batches++;
      step = sprtNext(obs, 0.01, 0.05, 0.05, 0.05);
    }
    sprtInfo = {
      batches,
      observations: obs.length,
      cap,
      log_lr: step.logLR,
      verdict: step.verdict === 'continue' ? 'inconclusive' : step.verdict,
    };
  }

  // ---- Screen verdict (c=0) — the report-level verdict for EVERY plan (F4) ----
  //
  // F1: the screen inspects components AND connections and rejects on any
  // defect across both, so the OC arithmetic must use the COMBINED inspected
  // count: producer's risk 1 − 0.99^90 = 0.595 and bound 1 − 0.05^(1/90) =
  // 0.0327 for 45 + 45. The per-population figures (n=45 → 0.364 / 0.0644)
  // are reported alongside as `per_population`.
  let screenDefects = 0;
  let screenUnverifiable = 0;
  for (const c of screenComps) {
    const e = insp.compOk.get(c.component_id);
    if (isUnverifiable(e)) screenUnverifiable++;
    else if (isDefect(e)) screenDefects++;
  }
  for (const c of screenConns) {
    const e = insp.connOk.get(c.connection_id);
    if (isUnverifiable(e)) screenUnverifiable++;
    else if (isDefect(e)) screenDefects++;
  }
  const screenInspected = Math.max(1, screenComps.length + screenConns.length - screenUnverifiable);
  const screen: AuditScreen = {
    n: screenN,
    c: 0,
    ltpd: SCREEN_LTPD,
    consumer_risk: SCREEN_BETA,
    components_sampled: screenComps.length,
    connections_sampled: screenConns.length,
    defects: screenDefects,
    verdict: screenDefects === 0 ? 'accept' : 'reject',
    upper_bound_95: zeroDefectUpperBound(screenInspected, 0.95),
    producers_risk_at_1pct: producersRisk(screenInspected, 0.01),
    inspected: screenInspected,
    unverifiable: screenUnverifiable,
    per_population: {
      n: screenN,
      upper_bound_95: zeroDefectUpperBound(screenN, 0.95),
      producers_risk_at_1pct: producersRisk(screenN, 0.01),
    },
  };
  const verdict: AuditReport['verdict'] = screen.verdict;

  // ---- by_class ----
  const by_class: AuditReport['by_class'] = {};
  for (const v of outcomes) {
    by_class[v.class] = {
      sampled: v.sampledCount,
      defects: v.defectCount,
      ...(v.unverifiableCount ? { unverifiable: v.unverifiableCount } : {}),
    };
  }

  // ---- by_stratum over all randomly drawn facts (forced facts excluded) ----
  const agg: Record<string, { sampled: number; defects: number }> = {};
  const bump = (s: string, bad: boolean) => {
    agg[s] ??= { sampled: 0, defects: 0 };
    agg[s].sampled++;
    if (bad) agg[s].defects++;
  };
  for (const id of randomComps) {
    const e = insp.compOk.get(id);
    if (isUnverifiable(e)) continue; // F5: excluded from stratum rates
    bump(componentStratum(compById.get(id)!), isDefect(e));
  }
  for (const id of randomConns) {
    const e = insp.connOk.get(id);
    if (isUnverifiable(e)) continue;
    bump(connectionStratum(connById.get(id)!), isDefect(e));
  }
  const by_stratum: Record<string, AuditStratumStats> = {};
  for (const [k, v] of Object.entries(agg)) {
    by_stratum[k] = {
      sampled: v.sampled,
      defects: v.defects,
      defect_rate: v.sampled > 0 ? v.defects / v.sampled : 0,
      n_total: stratumTotals[k] ?? v.sampled,
      ci: proportionInterval(v.defects, v.sampled),
      ...(pooledStrata.has(k) ? { pooled: true } : {}),
    };
  }

  // ---- Distinct-fact totals (Run 4 defect 3) ----
  // F2: dedup collisions are a whole-population census figure
  // (census.dedup_collisions, by_class.DEDUP_COLLISION) and are NOT added to
  // the sampled defect count — doing so let defect_rate exceed 1 and fed
  // x > n into the interval helper.
  // F5: unverifiable facts are inspected but carry no evidence; they are
  // reported in `unverifiable` and removed from the rate denominator.
  let unverifiable = 0;
  let distinctDefects = 0;
  for (const m of [insp.compOk, insp.connOk, insp.fileOk]) {
    for (const e of m.values()) {
      if (e.unverifiable) unverifiable++;
      else if (!e.ok) distinctDefects++;
    }
  }
  const sampled = compById.size + connById.size + fileSet.size;
  const evaluable = Math.max(0, sampled - unverifiable);
  const defects = distinctDefects;

  // ---- Evidence (capped) ----
  const defect_evidence: AuditSampleEvidence[] = [];
  for (const v of outcomes) {
    for (const e of v.samples) {
      if (!e.ok && defect_evidence.length < evidenceCap) defect_evidence.push({ ...e, class: v.class });
    }
    if (defect_evidence.length >= evidenceCap) break;
  }

  // ---- Oracles ----
  let oracles: AuditReport['oracles'];
  if (opts.oracles !== false) {
    oracles = await runOracles(
      { projectRoot, components, connections, componentById, hashes },
      {
        scip: !!opts.scip,
        trustTargetDeps: opts.trustTargetDeps ?? process.env['NAVGATOR_TRUST_TARGET_DEPS'] === '1',
        scipTimeoutMs: opts.scipTimeoutMs ?? (Number(process.env['NAVGATOR_SCIP_TIMEOUT_MS']) || undefined),
      }
    );
  }

  return {
    plan,
    n: design.n_components + design.n_connections,
    c: 0,
    sampled,
    defects,
    defect_rate: evaluable > 0 ? defects / evaluable : 0,
    ...(unverifiable > 0 ? { unverifiable } : {}),
    by_class,
    by_stratum,
    llm_skipped: !!outcomes[4]?.llm_skipped,
    verdict,
    timestamp: Date.now(),
    navgator_version: NAVGATOR_VERSION,
    screen,
    precision: design,
    ...(sprtInfo ? { sprt: sprtInfo } : {}),
    census,
    ...(oracles ? { oracles } : {}),
    ...(defect_evidence.length > 0 ? { defect_evidence } : {}),
  };
}

// ============================================================================
// CHART UPDATE (called after runAudit returns; returns a new state map)
// ============================================================================

export const CENSUS_STRATUM = '__census-unresolved';
export const POOLED_STRATUM = '__pooled';

export function updateEwmaForAudit(
  prior: Record<string, EwmaState> | undefined,
  report: AuditReport,
  version: string = NAVGATOR_VERSION
): { ewma: Record<string, EwmaState>; anyBreach: boolean } {
  const next: Record<string, EwmaState> = { ...(prior ?? {}) };
  let anyBreach = false;
  const pooled = { sampled: 0, defects: 0 };

  for (const [stratum, stats] of Object.entries(report.by_stratum)) {
    if (stats.pooled) {
      pooled.sampled += stats.sampled;
      pooled.defects += stats.defects;
      // A stratum charted under __pooled must not keep a stale standalone
      // series that never updates again (finding (a): ambient `connection-imports`
      // showed a legacy n=0 point). Its history lives in __pooled from here on.
      delete next[stratum];
      continue;
    }
    if (!(stats.sampled > 0)) continue; // (a): never chart an empty subgroup
    const prev = next[stratum] ?? newEwmaState();
    const r = updateChart(prev, { x: stats.defect_rate, n: stats.sampled, defects: stats.defects }, { version, kind: 'p' });
    next[stratum] = r.state;
    if (r.breach) anyBreach = true;
  }
  if (pooled.sampled > 0) {
    const prev = next[POOLED_STRATUM] ?? newEwmaState();
    const r = updateChart(
      prev,
      { x: pooled.defects / pooled.sampled, n: pooled.sampled, defects: pooled.defects },
      { version, kind: 'p' }
    );
    next[POOLED_STRATUM] = r.state;
    if (r.breach) anyBreach = true;
  }
  // u-chart on the exact census series: defects per edge, n_i = edges (grows with the repo).
  const cen = report.census?.unresolved_endpoints;
  if (cen && cen.total > 0) {
    const prev = next[CENSUS_STRATUM] ?? newEwmaState();
    const r = updateChart(prev, { x: cen.rate, n: cen.total, defects: cen.bad }, { version, kind: 'u' });
    next[CENSUS_STRATUM] = r.state;
    if (r.breach) anyBreach = true;
  }

  return { ewma: next, anyBreach };
}
