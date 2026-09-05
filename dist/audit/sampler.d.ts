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
export interface ProportionInterval {
    lower: number;
    upper: number;
    method: 'wilson' | 'clopper-pearson';
}
/**
 * Wilson score interval (NIST §7.2.4, source [7]):
 *
 *        p̂ + z²/(2n) ± z·sqrt( p̂(1−p̂)/n + z²/(4n²) )
 *   CI = ------------------------------------------------
 *                        1 + z²/n
 *
 * Lower limit cannot be negative (NIST's stated advantage over Wald).
 */
export declare function wilsonInterval(x: number, n: number, z?: number): ProportionInterval;
/**
 * Clopper-Pearson "exact" interval (NIST §7.2.4, source [7]), solved by
 * bisection on the binomial CDF:
 *   Σ_{k≤x}   C(n,k) p_U^k (1−p_U)^(n−k) = α/2
 *   Σ_{k≤x−1} C(n,k) p_L^k (1−p_L)^(n−k) = 1 − α/2
 * Closed forms at the boundaries: x=0 → p_U = 1 − (α/2)^(1/n); x=n → p_L = (α/2)^(1/n).
 */
export declare function clopperPearsonInterval(x: number, n: number, alpha?: number): ProportionInterval;
/**
 * Default reporting interval (protocol step 9, sources [7][17]): Wilson,
 * except at x=0 or x=n where Clopper-Pearson is the honest exact bound.
 */
export declare function proportionInterval(x: number, n: number): ProportionInterval;
/**
 * c=0 plan size (packet §1.2, sources [1][2][16]):  n = ⌈ ln β / ln(1 − LTPD) ⌉.
 * LTPD 5%, β 10% → 45. The hypergeometric solution for N ≥ 3,000 is also 45,
 * so no finite-population correction is applied.
 */
export declare function zeroAcceptanceN(ltpd?: number, beta?: number): number;
/** Zero defects in n → one-sided upper bound at confidence `conf`: 1 − (1−conf)^(1/n). n=45 → 0.0644 (packet §1.3). */
export declare function zeroDefectUpperBound(n: number, conf?: number): number;
/** Producer's risk of a c=0 plan at true rate p: 1 − (1−p)^n. n=45, p=0.01 → 0.364 (packet §1.4). */
export declare function producersRisk(n: number, p: number): number;
/**
 * Neyman allocation with a per-stratum floor (protocol step 8):
 *   n_h = min(N_h, max(floor, n · N_h σ_h / Σ N_i σ_i))
 * Strata with N_h < floor are sampled in full and flagged `pooled` so their
 * chart series is aggregated under `__pooled`. The floor is applied AFTER
 * Neyman so the total may exceed `n`; that overrun is the price of keeping
 * small heuristic strata estimable.
 */
export declare function neymanAllocateWithFloor(n: number, strataSizes: ReadonlyArray<number>, strataStdDevs: ReadonlyArray<number>, floor?: number): {
    alloc: number[];
    pooled: boolean[];
};
/**
 * Stratified sample with floor + pooling flags (Run 4). Same contract as
 * selectAuditSample plus `byStratum[label].pooled`.
 */
export declare function selectStratifiedSample<T>(items: ReadonlyArray<T>, totalN: number, strataKey: (item: T) => string, opts?: {
    floor?: number;
    priorRates?: Record<string, number>;
    rand?: () => number;
    exclude?: Set<string>;
    idOf?: (item: T) => string;
}): {
    samples: T[];
    byStratum: Record<string, {
        sampled: number;
        total: number;
        pooled: boolean;
    }>;
};
export {};
//# sourceMappingURL=sampler.d.ts.map