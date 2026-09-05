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
// ============================================================================
// CONSTANTS
// ============================================================================
/** Standard normal quantiles for common confidence levels. */
export const Z = {
    /** 90% two-sided CI / 95% one-sided */
    Z_90: 1.645,
    /** 95% two-sided CI */
    Z_95: 1.96,
    /** 99% two-sided CI */
    Z_99: 2.576,
};
// ============================================================================
// BINOMIAL CDF (log-stable)
// ============================================================================
/**
 * Log-gamma via Lanczos approximation (g=7, n=9).
 * Accurate to ~1e-15 for x > 0.
 */
function lgamma(x) {
    if (x < 0.5) {
        // Reflection: ln Γ(x) = ln(π / sin(πx)) − ln Γ(1−x)
        return Math.log(Math.PI / Math.sin(Math.PI * x)) - lgamma(1 - x);
    }
    const g = 7;
    const c = [
        0.99999999999980993, 676.5203681218851, -1259.1392167224028,
        771.32342877765313, -176.61502916214059, 12.507343278686905,
        -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
    ];
    x -= 1;
    let a = c[0];
    const t = x + g + 0.5;
    for (let i = 1; i < 9; i++)
        a += c[i] / (x + i);
    return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}
/** ln C(n, k) via lgamma. Stable for n up to ~1e6. */
function logChoose(n, k) {
    if (k < 0 || k > n)
        return -Infinity;
    if (k === 0 || k === n)
        return 0;
    return lgamma(n + 1) - lgamma(k + 1) - lgamma(n - k + 1);
}
/**
 * Binomial CDF P(X ≤ c) where X ~ Binomial(n, p).
 * Used for OC-curve calc: probability of acceptance at proportion-defective p.
 */
export function binomialCDF(n, p, c) {
    if (p <= 0)
        return 1;
    if (p >= 1)
        return c >= n ? 1 : 0;
    if (c < 0)
        return 0;
    if (c >= n)
        return 1;
    const logP = Math.log(p);
    const log1mP = Math.log(1 - p);
    let sum = 0;
    for (let k = 0; k <= c; k++) {
        const logPmf = logChoose(n, k) + k * logP + (n - k) * log1mP;
        sum += Math.exp(logPmf);
    }
    // Numerical safety: clamp.
    if (sum > 1)
        return 1;
    if (sum < 0)
        return 0;
    return sum;
}
const AQL_TABLE = [
    { maxN: 8, codeLetter: 'A', n: 2, c: 0, lotRange: '2-8' },
    { maxN: 15, codeLetter: 'B', n: 3, c: 0, lotRange: '9-15' },
    { maxN: 25, codeLetter: 'C', n: 5, c: 0, lotRange: '16-25' },
    { maxN: 50, codeLetter: 'D', n: 8, c: 0, lotRange: '26-50' },
    { maxN: 90, codeLetter: 'E', n: 13, c: 1, lotRange: '51-90' },
    { maxN: 150, codeLetter: 'F', n: 20, c: 1, lotRange: '91-150' },
    { maxN: 280, codeLetter: 'G', n: 32, c: 2, lotRange: '151-280' },
    { maxN: 500, codeLetter: 'H', n: 50, c: 3, lotRange: '281-500' },
    { maxN: 1200, codeLetter: 'J', n: 80, c: 5, lotRange: '501-1200' },
    { maxN: 3200, codeLetter: 'K', n: 125, c: 7, lotRange: '1201-3200' },
    { maxN: 10000, codeLetter: 'L', n: 200, c: 10, lotRange: '3201-10000' },
    { maxN: 35000, codeLetter: 'M', n: 315, c: 14, lotRange: '10001-35000' },
    { maxN: Infinity, codeLetter: 'N', n: 500, c: 21, lotRange: '35001+' },
];
/** Pick an AQL=2.5% sampling plan based on lot size. */
export function chooseAQLPlan(lotSize) {
    for (const row of AQL_TABLE) {
        if (lotSize <= row.maxN) {
            return {
                n: Math.min(row.n, Math.max(1, lotSize)),
                c: row.c,
                plan: 'AQL',
                codeLetter: row.codeLetter,
                lotRange: row.lotRange,
            };
        }
    }
    // Unreachable (last row is Infinity), keeps TS happy.
    const last = AQL_TABLE[AQL_TABLE.length - 1];
    return { n: last.n, c: last.c, plan: 'AQL', codeLetter: last.codeLetter, lotRange: last.lotRange };
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
export function sprtNext(observations, p0, p1, alpha = 0.05, beta = 0.05) {
    if (p0 <= 0 || p0 >= 1 || p1 <= 0 || p1 >= 1 || p0 >= p1) {
        throw new Error('sprtNext: require 0 < p0 < p1 < 1');
    }
    const A = (1 - beta) / alpha;
    const B = beta / (1 - alpha);
    // ln Λ_n = Σ [x_i ln(p1/p0) + (1-x_i) ln((1-p1)/(1-p0))]
    const lnRatioDefect = Math.log(p1 / p0);
    const lnRatioClean = Math.log((1 - p1) / (1 - p0));
    let logLR = 0;
    for (const x of observations) {
        logLR += x === 1 ? lnRatioDefect : lnRatioClean;
    }
    const lnA = Math.log(A);
    const lnB = Math.log(B);
    let verdict = 'continue';
    if (logLR >= lnA)
        verdict = 'reject';
    else if (logLR <= lnB)
        verdict = 'accept';
    return { verdict, logLR, A, B };
}
// ============================================================================
// COCHRAN SAMPLE SIZE
// ============================================================================
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
export function cochranSize(p, e, z = Z.Z_95, populationSize) {
    if (p < 0 || p > 1)
        throw new Error('cochranSize: p must be in [0,1]');
    if (e <= 0 || e >= 1)
        throw new Error('cochranSize: e must be in (0,1)');
    if (z <= 0)
        throw new Error('cochranSize: z must be > 0');
    const n0 = (z * z * p * (1 - p)) / (e * e);
    if (!populationSize || populationSize <= 0) {
        return Math.ceil(n0);
    }
    const adj = n0 / (1 + (n0 - 1) / populationSize);
    return Math.ceil(adj);
}
// ============================================================================
// NEYMAN ALLOCATION
// ============================================================================
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
export function neymanAllocate(n, strataSizes, strataStdDevs) {
    if (strataSizes.length !== strataStdDevs.length) {
        throw new Error('neymanAllocate: strataSizes and strataStdDevs must align');
    }
    if (strataSizes.length === 0)
        return [];
    const denom = strataSizes.reduce((acc, N_h, i) => acc + N_h * (strataStdDevs[i] ?? 0), 0);
    if (denom <= 0) {
        // All-zero variance → equal split, capped by stratum size, then
        // (Run 4 fix2 #5) redistribute whatever the caps left unused to strata
        // with room, so Σ n_h = min(n, Σ N_h). n=50, sizes [1,100] → [1,49].
        const base = Math.floor(n / strataSizes.length);
        const rem = n - base * strataSizes.length;
        const alloc = strataSizes.map((N_h, i) => Math.min(N_h, base + (i < rem ? 1 : 0)));
        let remaining = n - alloc.reduce((a, b) => a + b, 0);
        while (remaining > 0) {
            let gave = false;
            for (let i = 0; i < alloc.length && remaining > 0; i++) {
                if ((alloc[i] ?? 0) < (strataSizes[i] ?? 0)) {
                    alloc[i] = (alloc[i] ?? 0) + 1;
                    remaining--;
                    gave = true;
                }
            }
            if (!gave)
                break; // every stratum exhausted
        }
        return alloc;
    }
    // Real-valued allocation
    const real = strataSizes.map((N_h, i) => (n * (N_h * (strataStdDevs[i] ?? 0))) / denom);
    // Cap at stratum size; floor; distribute remainder by largest fractional part.
    const capped = real.map((r, i) => Math.min(r, strataSizes[i] ?? 0));
    const floored = capped.map((r) => Math.floor(r));
    let remaining = n - floored.reduce((a, b) => a + b, 0);
    // Sort indices by descending fractional remainder.
    const fracOrder = capped
        .map((r, i) => ({ i, frac: r - Math.floor(r), room: (strataSizes[i] ?? 0) - (floored[i] ?? 0) }))
        .sort((a, b) => b.frac - a.frac);
    for (const { i, room } of fracOrder) {
        if (remaining <= 0)
            break;
        if (room > 0) {
            floored[i] = (floored[i] ?? 0) + 1;
            remaining--;
        }
    }
    // If we still owe samples (because of caps), spread them anywhere with room.
    if (remaining > 0) {
        for (let i = 0; i < floored.length && remaining > 0; i++) {
            const room = (strataSizes[i] ?? 0) - (floored[i] ?? 0);
            if (room > 0) {
                const give = Math.min(room, remaining);
                floored[i] = (floored[i] ?? 0) + give;
                remaining -= give;
            }
        }
    }
    return floored;
}
// ============================================================================
// STRATIFIED SAMPLING (D3 — pure helper)
// ============================================================================
/**
 * Pick `count` items from `items` without replacement (Fisher-Yates partial shuffle).
 */
export function sampleWithoutReplacement(items, count, rand = Math.random) {
    const n = items.length;
    if (count <= 0 || n === 0)
        return [];
    if (count >= n)
        return [...items];
    const arr = [...items];
    const out = [];
    for (let i = 0; i < count; i++) {
        const j = i + Math.floor(rand() * (n - i));
        const tmp = arr[i];
        arr[i] = arr[j];
        arr[j] = tmp;
        out.push(arr[i]);
    }
    return out;
}
/**
 * Stratified sample selection.
 *
 * @param items        full population
 * @param totalN       desired total sample
 * @param strataKey    function (item) → stratum label
 * @param priorRates   optional Record<stratum, defectRate> for variance estimation
 * @param rand         RNG (test injection)
 */
export function selectAuditSample(items, totalN, strataKey, priorRates, rand = Math.random) {
    if (items.length === 0 || totalN <= 0) {
        return { samples: [], byStratum: {} };
    }
    // Group.
    const buckets = new Map();
    for (const item of items) {
        const key = strataKey(item);
        let arr = buckets.get(key);
        if (!arr) {
            arr = [];
            buckets.set(key, arr);
        }
        arr.push(item);
    }
    const labels = [...buckets.keys()];
    const sizes = labels.map((l) => buckets.get(l).length);
    const stdDevs = labels.map((l) => {
        const p = priorRates?.[l] ?? 0.5;
        const clamped = Math.max(0, Math.min(1, p));
        return Math.sqrt(clamped * (1 - clamped));
    });
    const allocations = neymanAllocate(Math.min(totalN, items.length), sizes, stdDevs);
    const samples = [];
    const byStratum = {};
    for (let i = 0; i < labels.length; i++) {
        const label = labels[i];
        const want = allocations[i] ?? 0;
        const have = buckets.get(label);
        const picked = sampleWithoutReplacement(have, want, rand);
        samples.push(...picked);
        byStratum[label] = { sampled: picked.length, total: have.length };
    }
    return { samples, byStratum };
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
export function wilsonInterval(x, n, z = Z.Z_95) {
    if (n <= 0)
        return { lower: 0, upper: 1, method: 'wilson' };
    const p = x / n;
    const z2 = z * z;
    const denom = 1 + z2 / n;
    const centre = p + z2 / (2 * n);
    const half = z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
    return {
        lower: Math.max(0, (centre - half) / denom),
        upper: Math.min(1, (centre + half) / denom),
        method: 'wilson',
    };
}
/**
 * Clopper-Pearson "exact" interval (NIST §7.2.4, source [7]), solved by
 * bisection on the binomial CDF:
 *   Σ_{k≤x}   C(n,k) p_U^k (1−p_U)^(n−k) = α/2
 *   Σ_{k≤x−1} C(n,k) p_L^k (1−p_L)^(n−k) = 1 − α/2
 * Closed forms at the boundaries: x=0 → p_U = 1 − (α/2)^(1/n); x=n → p_L = (α/2)^(1/n).
 */
export function clopperPearsonInterval(x, n, alpha = 0.05) {
    if (n <= 0)
        return { lower: 0, upper: 1, method: 'clopper-pearson' };
    const a2 = alpha / 2;
    const solve = (f, target) => {
        // f is monotone decreasing in p (a CDF in p); find p with f(p) = target.
        let lo = 0;
        let hi = 1;
        for (let i = 0; i < 60; i++) {
            const mid = (lo + hi) / 2;
            if (f(mid) > target)
                lo = mid;
            else
                hi = mid;
        }
        return (lo + hi) / 2;
    };
    const lower = x <= 0 ? 0 : x >= n ? Math.pow(a2, 1 / n) : solve((p) => binomialCDF(n, p, x - 1), 1 - a2);
    const upper = x >= n ? 1 : x <= 0 ? 1 - Math.pow(a2, 1 / n) : solve((p) => binomialCDF(n, p, x), a2);
    return { lower, upper, method: 'clopper-pearson' };
}
/**
 * Default reporting interval (protocol step 9, sources [7][17]): Wilson,
 * except at x=0 or x=n where Clopper-Pearson is the honest exact bound.
 */
export function proportionInterval(x, n) {
    if (n <= 0)
        return { lower: 0, upper: 1, method: 'wilson' };
    if (x <= 0 || x >= n)
        return clopperPearsonInterval(x, n);
    return wilsonInterval(x, n);
}
/**
 * c=0 plan size (packet §1.2, sources [1][2][16]):  n = ⌈ ln β / ln(1 − LTPD) ⌉.
 * LTPD 5%, β 10% → 45. The hypergeometric solution for N ≥ 3,000 is also 45,
 * so no finite-population correction is applied.
 */
export function zeroAcceptanceN(ltpd = 0.05, beta = 0.10) {
    if (ltpd <= 0 || ltpd >= 1 || beta <= 0 || beta >= 1) {
        throw new Error('zeroAcceptanceN: require 0 < ltpd < 1 and 0 < beta < 1');
    }
    return Math.ceil(Math.log(beta) / Math.log(1 - ltpd));
}
/** Zero defects in n → one-sided upper bound at confidence `conf`: 1 − (1−conf)^(1/n). n=45 → 0.0644 (packet §1.3). */
export function zeroDefectUpperBound(n, conf = 0.95) {
    if (n <= 0)
        return 1;
    return 1 - Math.pow(1 - conf, 1 / n);
}
/** Producer's risk of a c=0 plan at true rate p: 1 − (1−p)^n. n=45, p=0.01 → 0.364 (packet §1.4). */
export function producersRisk(n, p) {
    return 1 - Math.pow(1 - p, n);
}
/**
 * Neyman allocation with a per-stratum floor (protocol step 8):
 *   n_h = min(N_h, max(floor, n · N_h σ_h / Σ N_i σ_i))
 * Strata with N_h < floor are sampled in full and flagged `pooled` so their
 * chart series is aggregated under `__pooled`. The floor is applied AFTER
 * Neyman so the total may exceed `n`; that overrun is the price of keeping
 * small heuristic strata estimable.
 */
export function neymanAllocateWithFloor(n, strataSizes, strataStdDevs, floor = 30) {
    const base = neymanAllocate(n, strataSizes, strataStdDevs);
    const alloc = base.map((a, i) => {
        const N = strataSizes[i] ?? 0;
        return Math.min(N, Math.max(floor, a));
    });
    const pooled = strataSizes.map((N) => N < floor);
    return { alloc, pooled };
}
/**
 * Stratified sample with floor + pooling flags (Run 4). Same contract as
 * selectAuditSample plus `byStratum[label].pooled`.
 */
export function selectStratifiedSample(items, totalN, strataKey, opts = {}) {
    const rand = opts.rand ?? Math.random;
    const floor = opts.floor ?? 30;
    const pool = opts.exclude && opts.idOf ? items.filter((it) => !opts.exclude.has(opts.idOf(it))) : items;
    if (pool.length === 0 || totalN <= 0)
        return { samples: [], byStratum: {} };
    const buckets = new Map();
    for (const item of pool) {
        const key = strataKey(item);
        let arr = buckets.get(key);
        if (!arr) {
            arr = [];
            buckets.set(key, arr);
        }
        arr.push(item);
    }
    const labels = [...buckets.keys()];
    const sizes = labels.map((l) => buckets.get(l).length);
    const stdDevs = labels.map((l) => {
        const p = Math.max(0, Math.min(1, opts.priorRates?.[l] ?? 0.5));
        return Math.sqrt(p * (1 - p));
    });
    const { alloc, pooled } = neymanAllocateWithFloor(Math.min(totalN, pool.length), sizes, stdDevs, floor);
    const samples = [];
    const byStratum = {};
    for (let i = 0; i < labels.length; i++) {
        const label = labels[i];
        const have = buckets.get(label);
        const picked = sampleWithoutReplacement(have, alloc[i] ?? 0, rand);
        samples.push(...picked);
        byStratum[label] = { sampled: picked.length, total: have.length, pooled: pooled[i] ?? false };
    }
    return { samples, byStratum };
}
//# sourceMappingURL=sampler.js.map