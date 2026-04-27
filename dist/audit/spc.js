/**
 * NavGator audit SPC — Run 2 / D5
 *
 * EWMA control chart for slow drift detection across scans.
 *
 * Reference:
 *   - Hawkins & Wu, 2014 — EWMA chart performance for small mean shifts.
 *   - Roberts 1959 — Original EWMA proposal.
 */
/** Initial state for a new stratum. mean=0 and variance=0 are placeholders;
 *  the first 5 observations are treated as warm-up (we never breach during
 *  warm-up). */
export function newEwmaState(lambda = 0.2, L = 2.7) {
    return { lambda, L, mean: 0, variance: 0, n: 0, points: [], breach_pending: false };
}
/** Number of warm-up observations before breaches are reported. */
const WARMUP = 5;
/**
 * Update EWMA with a new observation (e.g., this run's defect rate for one stratum).
 *
 * Strategy:
 *   - During warm-up (first 5 obs), accumulate sample mean+variance, no breach reporting.
 *   - After warm-up, mean and variance are frozen (process target locked).
 *     z is then the EWMA of (x - mean) deviations; limits are symmetric around 0.
 *
 * Returns a NEW state (immutable update).
 */
export function updateEwma(prev, x) {
    const lambda = prev.lambda;
    const L = prev.L;
    const n = prev.n + 1;
    let mean = prev.mean;
    let variance = prev.variance;
    let z;
    let breach = false;
    if (n <= WARMUP) {
        // Welford's online mean+variance.
        const delta = x - mean;
        mean = mean + delta / n;
        const delta2 = x - mean;
        // Population variance (M2 / n). Sufficient for control limits at this scale.
        variance = ((n - 1) * variance + delta * delta2) / n;
        z = 0; // No EWMA yet; reported as 0 so plot starts on target.
    }
    else {
        // Use deviation from frozen mean.
        const dev = x - mean;
        const prevZ = prev.points.length > 0 ? prev.points[prev.points.length - 1] : 0;
        z = lambda * dev + (1 - lambda) * prevZ;
        const sigma = Math.sqrt(Math.max(variance, 1e-12));
        // Stabilized SE: σ √(λ/(2-λ) · (1 - (1-λ)^(2(n-WARMUP))))
        const k = n - WARMUP;
        const stabilizer = 1 - Math.pow(1 - lambda, 2 * k);
        const se = sigma * Math.sqrt((lambda / (2 - lambda)) * stabilizer);
        const ucl = L * se;
        const lcl = -L * se;
        if (z > ucl || z < lcl)
            breach = true;
        const points = [...prev.points, z];
        if (points.length > 50)
            points.shift();
        return {
            state: { lambda, L, mean, variance, n, points, breach_pending: breach },
            breach,
            z,
            ucl,
            lcl,
        };
    }
    const points = [...prev.points, z];
    if (points.length > 50)
        points.shift();
    return {
        state: { lambda, L, mean, variance, n, points, breach_pending: false },
        breach,
        z,
        ucl: 0, // limits not meaningful during warmup
        lcl: 0,
    };
}
//# sourceMappingURL=spc.js.map