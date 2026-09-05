/**
 * NavGator audit SPC — Run 2 / D5, rewritten in Run 4 (2026-09-05).
 *
 * One state object per stratum persisted on `index.json.ewma[stratum]`.
 * Three detectors run on every Phase II point:
 *
 *   Shewhart p-chart (or u-chart)  — catches the single catastrophic scan
 *   EWMA (λ=0.2, L=2.7)            — catches the slow slide
 *   tabular CUSUM (k=0.5σ, h=5σ)   — NIST: better than Shewhart for shifts ≤ 2σ
 *
 * Run rules: Western Electric Rule 1 (beyond 3σ) and Rule 4 (8 on one side)
 * only — the full set false-alarms ~1 in 53 points, which on per-commit
 * scanning is an alarm every other day (research packet §3.5, source [26]).
 *
 * Phase I / Phase II (packet §3.1, protocol step 12): limits are NOT computed
 * from the first few scans. The series is `provisional` until PHASE1_SUBGROUPS
 * points have accumulated; provisional series cannot breach. At freeze,
 * p̄ = ΣD_i / Σn_i (NIST §6.3.3.1, source [3]) floored at P_FLOOR so an all-zero
 * Phase I can never produce zero-width limits (Run 4 defect 1: atomize-ai
 * `connection-services` breached on its first non-zero point because eight
 * zeros gave mean 0, variance 0).
 *
 * Re-baseline (protocol step 15): a NavGator version change is a
 * measurement-system change. When `version` differs from the stored one the
 * series resets to provisional and records `rebaselined_from`.
 *
 * Sources (packet "Sources" numbering):
 *   [3]  NIST §6.3.3.1 p-chart: UCL/LCL = p̄ ± 3√(p̄(1−p̄)/n)
 *   [28] u-chart: ū ± 3√(ū/n_i)
 *   [5]  NIST §6.3.2.3 tabular CUSUM: S_hi = max(0, S_hi + x − μ₀ − k), S_lo = max(0, S_lo + μ₀ − k − x)
 *   [6]  NIST §6.3.2.4 EWMA: σ²_ewma = (λ/(2−λ))·σ²; λ 0.2–0.3; L from Lucas & Saccucci
 *   [26] Western Electric rules and their combined false-alarm rate
 *   Hawkins & Wu 2014 for λ=0.2, L=2.7 (small-shift ARL optimum) — retained from Run 2.
 */

import type { EwmaStateSnapshot } from '../types.js';

/** Phase I length before limits are frozen (Montgomery convention ~25–30; packet §3.1). */
export const PHASE1_SUBGROUPS = 25;
/** Prior floor for p̄ / ū: max(observed, 0.01). Prevents zero-width limits. */
export const P_FLOOR = 0.01;
/** Subgroup size assumed when an observation carries no `n` (legacy callers). */
const LEGACY_N = 30;

/**
 * EWMA / chart state. Field names `mean`, `variance`, `n`, `points`,
 * `breach_pending` keep their Run 2 meaning; everything else is Run 4 and
 * optional (see EwmaStateSnapshot in types.ts).
 */
export type EwmaState = EwmaStateSnapshot;

export interface ChartObservation {
  /** Observed rate for this subgroup (defects / inspected, or defects per edge). */
  x: number;
  /** Inspected units n_i (sample size for p-chart; edges for u-chart). */
  n?: number;
  /** Defect count (defaults to round(x·n)). */
  defects?: number;
}

export interface UpdateOptions {
  /** NavGator version producing the point; a change triggers re-baseline. */
  version?: string;
  /** 'p' (default) for defect fraction, 'u' for defects per edge. */
  kind?: 'p' | 'u';
  /** Prior floor for the centre line. */
  floor?: number;
  /** Phase I length override (tests). */
  phase1?: number;
}

export interface UpdateResult {
  state: EwmaState;
  /** True when at least one signal fired on this update. */
  breach: boolean;
  /** EWMA statistic as a deviation from the centre line (legacy `points` convention). */
  z: number;
  /** Shewhart limits used for this point (0 while provisional). */
  ucl: number;
  lcl: number;
  /** Run 4 additions. */
  phase: 'provisional' | 'frozen';
  center: number;
  signals: string[];
  ewma_ucl: number;
  ewma_lcl: number;
}

/** Initial state for a new stratum. */
export function newEwmaState(lambda = 0.2, L = 2.7): EwmaState {
  return {
    lambda,
    L,
    mean: 0,
    variance: 0,
    n: 0,
    points: [],
    breach_pending: false,
    kind: 'p',
    phase: 'provisional',
    phase1_defects: 0,
    phase1_units: 0,
  };
}

/**
 * Legacy entry point (Run 2 signature). Treats `x` as a rate observed on a
 * subgroup of unknown size; σ then comes from the Phase I sample variance of
 * x floored at the binomial σ for n=LEGACY_N. Prefer `updateChart`.
 */
export function updateEwma(prev: EwmaState, x: number): UpdateResult {
  return updateChart(prev, { x }, {});
}

/**
 * Update one stratum's chart with a new subgroup. Returns a NEW state.
 */
export function updateChart(prev: EwmaState, obs: ChartObservation, opts: UpdateOptions = {}): UpdateResult {
  const phase1Len = opts.phase1 ?? PHASE1_SUBGROUPS;
  const floor = opts.floor ?? P_FLOOR;

  // ---- Re-baseline on measurement-system change (protocol step 15) ----
  let base = prev;
  if (opts.version && prev.version && prev.version !== opts.version) {
    base = {
      ...newEwmaState(prev.lambda, prev.L),
      kind: opts.kind ?? prev.kind ?? 'p',
      rebaselined_from: prev.version,
      rebaselined_at: Date.now(),
    };
  }
  const version = opts.version ?? base.version;
  const kind: 'p' | 'u' = opts.kind ?? base.kind ?? 'p';
  const lambda = base.lambda;
  const L = base.L;
  const n = base.n + 1;

  const units = obs.n !== undefined && obs.n > 0 ? obs.n : undefined;
  const x = Number.isFinite(obs.x) ? Math.max(0, obs.x) : 0;
  const defects = obs.defects ?? (units ? Math.round(x * units) : 0);

  const phaseFrozen = base.phase === 'frozen';

  if (!phaseFrozen) {
    // ---------------- Phase I: accumulate, never breach ----------------
    const delta = x - base.mean;
    const mean = base.mean + delta / n;
    const delta2 = x - mean;
    const variance = ((n - 1) * base.variance + delta * delta2) / n; // Welford, population form
    const phase1_defects = (base.phase1_defects ?? 0) + defects;
    const phase1_units = (base.phase1_units ?? 0) + (units ?? 0);

    // Provisional EWMA around the running mean, for plotting only.
    const prevEwma = base.last?.ewma ?? mean;
    const ewma = lambda * x + (1 - lambda) * prevEwma;
    const z = ewma - mean;
    const points = [...base.points, z];
    if (points.length > 50) points.shift();

    let next: EwmaState = {
      ...base,
      version,
      kind,
      mean,
      variance,
      n,
      points,
      breach_pending: false,
      phase: 'provisional',
      phase1_defects,
      phase1_units,
      last: { x, n: units ?? 0, ucl: 0, lcl: 0, ewma, ewma_ucl: 0, ewma_lcl: 0 },
      signals: [],
    };

    if (n >= phase1Len) {
      // ---- Freeze: p̄ = ΣD_i / Σn_i (NIST §6.3.3.1) floored at the prior ----
      const observed = phase1_units > 0 ? phase1_defects / phase1_units : mean;
      const center = Math.max(observed, floor);
      next = {
        ...next,
        phase: 'frozen',
        center,
        floor_active: observed < floor,
        cusum: { s_hi: 0, s_lo: 0, k: 0.5, h: 5 },
        run_side: 0,
        last: { ...next.last!, ewma: center },
      };
    }

    return {
      state: next,
      breach: false,
      z,
      ucl: 0,
      lcl: 0,
      phase: next.phase!,
      center: next.center ?? mean,
      signals: [],
      ewma_ucl: 0,
      ewma_lcl: 0,
    };
  }

  // ---------------- Phase II: frozen limits, three detectors ----------------
  const center = base.center ?? Math.max(base.mean, floor);
  const floorActive = !!base.floor_active;

  // σ for this subgroup. p-chart: √(p̄(1−p̄)/n_i) [3]; u-chart: √(ū/n_i) [28].
  let sigma: number;
  if (units) {
    sigma = kind === 'u' ? Math.sqrt(center / units) : Math.sqrt((center * (1 - center)) / units);
  } else {
    const legacy = Math.sqrt(Math.max(base.variance, 0));
    const binomialAtLegacyN = Math.sqrt((center * (1 - center)) / LEGACY_N);
    sigma = Math.max(legacy, binomialAtLegacyN);
  }
  if (!(sigma > 0)) sigma = Math.sqrt((floor * (1 - floor)) / LEGACY_N);

  const signals: string[] = [];

  // Rule 1 — Shewhart 3σ.
  const ucl = center + 3 * sigma;
  const lcl = Math.max(0, center - 3 * sigma);
  if (x > ucl) signals.push('rule1-high');
  // A non-zero low-side breach is a real signal (scan silently missed part of
  // the repo — packet §3.3). Suppressed when the centre is the floor prior:
  // observations below a prior carry no information about the process.
  if (lcl > 0 && x < lcl && !floorActive) signals.push('rule1-low');

  // Rule 4 — 8 consecutive points on one side of the centre line.
  const side = x > center ? 1 : x < center ? -1 : 0;
  const prevRun = base.run_side ?? 0;
  const run_side = side === 0 ? 0 : Math.sign(prevRun) === side ? prevRun + side : side;
  if (run_side >= 8) signals.push('rule4-high');
  if (run_side <= -8 && !floorActive) signals.push('rule4-low');

  // EWMA on the raw rate; σ_ewma = σ√(λ/(2−λ)) (NIST §6.3.2.4, asymptotic form).
  const prevEwma = base.last?.ewma ?? center;
  const ewma = lambda * x + (1 - lambda) * prevEwma;
  const sigmaEwma = sigma * Math.sqrt(lambda / (2 - lambda));
  const ewma_ucl = center + L * sigmaEwma;
  const ewma_lcl = Math.max(0, center - L * sigmaEwma);
  if (ewma > ewma_ucl) signals.push('ewma-high');
  if (ewma_lcl > 0 && ewma < ewma_lcl && !floorActive) signals.push('ewma-low');

  // Standardised tabular CUSUM (NIST §6.3.2.3): u = (x − μ₀)/σ, k = 0.5, h = 5 (σ units).
  const c = base.cusum ?? { s_hi: 0, s_lo: 0, k: 0.5, h: 5 };
  const u = (x - center) / sigma;
  let s_hi = Math.max(0, c.s_hi + u - c.k);
  let s_lo = floorActive ? 0 : Math.max(0, c.s_lo - u - c.k);
  if (s_hi > c.h) {
    signals.push('cusum-high');
    s_hi = 0; // restart after signal
  }
  if (s_lo > c.h) {
    signals.push('cusum-low');
    s_lo = 0;
  }

  const breach = signals.length > 0;
  const z = ewma - center;
  const points = [...base.points, z];
  if (points.length > 50) points.shift();

  const next: EwmaState = {
    ...base,
    version,
    kind,
    n,
    points,
    breach_pending: breach,
    phase: 'frozen',
    center,
    cusum: { s_hi, s_lo, k: c.k, h: c.h },
    run_side,
    last: { x, n: units ?? 0, ucl, lcl, ewma, ewma_ucl, ewma_lcl },
    signals,
  };

  return { state: next, breach, z, ucl, lcl, phase: 'frozen', center, signals, ewma_ucl, ewma_lcl };
}
