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
export declare const PHASE1_SUBGROUPS = 25;
/** Prior floor for p̄ / ū: max(observed, 0.01). Prevents zero-width limits. */
export declare const P_FLOOR = 0.01;
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
export declare function newEwmaState(lambda?: number, L?: number): EwmaState;
/**
 * Legacy entry point (Run 2 signature). Treats `x` as a rate observed on a
 * subgroup of unknown size; σ then comes from the Phase I sample variance of
 * x floored at the binomial σ for n=LEGACY_N. Prefer `updateChart`.
 */
export declare function updateEwma(prev: EwmaState, x: number): UpdateResult;
/**
 * Update one stratum's chart with a new subgroup. Returns a NEW state.
 */
export declare function updateChart(prev: EwmaState, obs: ChartObservation, opts?: UpdateOptions): UpdateResult;
//# sourceMappingURL=spc.d.ts.map