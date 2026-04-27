/**
 * NavGator audit sampler — Run 2 / D1
 *
 * Pure-math statistical sampling helpers. Zero deps.
 *
 * References:
 *   - NIST/SEMATECH e-Handbook §6.2.2-3 (acceptance sampling, attributes)
 *   - Wald 1945 — Sequential analysis (SPRT)
 *   - Cochran 1977 — Sampling techniques (FPC, Neyman allocation)
 */
/** Standard normal quantiles for common confidence levels. */
export declare const Z: {
    /** 90% two-sided CI / 95% one-sided */
    readonly Z_90: 1.645;
    /** 95% two-sided CI */
    readonly Z_95: 1.96;
    /** 99% two-sided CI */
    readonly Z_99: 2.576;
};
/**
 * Binomial CDF P(X ≤ c) where X ~ Binomial(n, p).
 * Used for OC-curve calc: probability of acceptance at proportion-defective p.
 */
export declare function binomialCDF(n: number, p: number, c: number): number;
interface AQLPlan {
    n: number;
    c: number;
    plan: 'AQL';
    codeLetter: string;
    lotRange: string;
}
/** Pick an AQL=2.5% sampling plan based on lot size. */
export declare function chooseAQLPlan(lotSize: number): AQLPlan;
export type SprtVerdict = 'accept' | 'reject' | 'continue';
export interface SprtStep {
    verdict: SprtVerdict;
    /** ln of the likelihood ratio after the latest observation. */
    logLR: number;
    /** Upper bound A = (1-β)/α. */
    A: number;
    /** Lower bound B = β/(1-α). */
    B: number;
}
/**
 * Run SPRT given the full observation sequence (1 = defect, 0 = clean).
 * Continue while B < Λ < A. Accept H0 (p=p0) when Λ ≤ B; reject (p=p1) when Λ ≥ A.
 *
 * @param observations  array of 0/1 outcomes
 * @param p0  null-hypothesis defect rate (e.g. 0.01)
 * @param p1  alternative defect rate (e.g. 0.05)
 * @param alpha  type-I error (default 0.05)
 * @param beta  type-II error (default 0.05)
 */
export declare function sprtNext(observations: ReadonlyArray<0 | 1>, p0: number, p1: number, alpha?: number, beta?: number): SprtStep;
/**
 * Cochran's sample-size formula:  n = Z² · p(1-p) / e²
 *   With finite-population correction (FPC) when populationSize given:
 *   n_adj = n / (1 + (n-1) / N)
 *
 * @param p  expected proportion (use 0.5 for max variance / worst-case)
 * @param e  margin of error (e.g., 0.05 for ±5%)
 * @param z  z-score for desired confidence (default 1.96 for 95%)
 * @param populationSize  optional finite-N for FPC adjustment
 */
export declare function cochranSize(p: number, e: number, z?: number, populationSize?: number): number;
/**
 * Neyman optimal allocation:
 *   n_h = n · (N_h · σ_h) / Σ (N_i · σ_i)
 *
 * Returns per-stratum sample sizes. Rounds in a way that preserves Σ n_h = n.
 *
 * @param n  total sample size
 * @param strataSizes  N_h per stratum
 * @param strataStdDevs  σ_h per stratum (use √(p(1-p)) for proportions)
 */
export declare function neymanAllocate(n: number, strataSizes: ReadonlyArray<number>, strataStdDevs: ReadonlyArray<number>): number[];
/**
 * Pick `count` items from `items` without replacement (Fisher-Yates partial shuffle).
 */
export declare function sampleWithoutReplacement<T>(items: ReadonlyArray<T>, count: number, rand?: () => number): T[];
/**
 * Stratified sample selection.
 *
 * @param items        full population
 * @param totalN       desired total sample
 * @param strataKey    function (item) → stratum label
 * @param priorRates   optional Record<stratum, defectRate> for variance estimation
 * @param rand         RNG (test injection)
 */
export declare function selectAuditSample<T>(items: ReadonlyArray<T>, totalN: number, strataKey: (item: T) => string, priorRates?: Record<string, number>, rand?: () => number): {
    samples: T[];
    byStratum: Record<string, {
        sampled: number;
        total: number;
    }>;
};
export {};
//# sourceMappingURL=sampler.d.ts.map