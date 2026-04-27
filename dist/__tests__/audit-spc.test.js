/**
 * NavGator audit SPC tests — Run 2 / D6
 */
import { describe, it, expect } from 'vitest';
import { newEwmaState, updateEwma } from '../audit/spc.js';
describe('newEwmaState', () => {
    it('default lambda=0.2, L=2.7', () => {
        const s = newEwmaState();
        expect(s.lambda).toBeCloseTo(0.2, 6);
        expect(s.L).toBeCloseTo(2.7, 6);
        expect(s.n).toBe(0);
        expect(s.points).toEqual([]);
    });
    it('honors overrides', () => {
        const s = newEwmaState(0.1, 3);
        expect(s.lambda).toBe(0.1);
        expect(s.L).toBe(3);
    });
});
describe('updateEwma — warm-up phase', () => {
    it('does not breach during the first 5 observations even with extreme values', () => {
        let s = newEwmaState();
        for (const x of [0.5, 0.6, 0.7, 0.8, 0.9]) {
            const r = updateEwma(s, x);
            expect(r.breach).toBe(false);
            s = r.state;
        }
        expect(s.n).toBe(5);
    });
    it('estimates mean and variance from the warm-up window', () => {
        let s = newEwmaState();
        for (const x of [0.02, 0.02, 0.02, 0.02, 0.02]) {
            s = updateEwma(s, x).state;
        }
        expect(s.mean).toBeCloseTo(0.02, 6);
        expect(s.variance).toBeCloseTo(0, 6);
    });
});
describe('updateEwma — control phase', () => {
    it('stays in control for stable observations', () => {
        let s = newEwmaState();
        // Warm-up with mean=0.02, σ≈0.005
        const warm = [0.015, 0.020, 0.025, 0.020, 0.020];
        for (const x of warm)
            s = updateEwma(s, x).state;
        // 10 more stable points
        for (let i = 0; i < 10; i++) {
            const r = updateEwma(s, 0.02 + (Math.random() - 0.5) * 0.002);
            expect(r.breach).toBe(false);
            s = r.state;
        }
    });
    it('breaches on a sustained large shift', () => {
        let s = newEwmaState();
        const warm = [0.020, 0.020, 0.020, 0.020, 0.020];
        for (const x of warm)
            s = updateEwma(s, x).state;
        // Even with σ→0 (perfectly stable warm-up) the variance floors at 1e-12,
        // so any meaningful shift breaches. We force a shift to 0.10.
        let breached = false;
        for (let i = 0; i < 5; i++) {
            const r = updateEwma(s, 0.10);
            s = r.state;
            if (r.breach) {
                breached = true;
                break;
            }
        }
        expect(breached).toBe(true);
    });
    it('records control limits as ±L·σ·√(λ/(2-λ))·stabilizer', () => {
        let s = newEwmaState();
        // Warm-up with non-zero variance.
        const warm = [0.02, 0.04, 0.02, 0.04, 0.02];
        for (const x of warm)
            s = updateEwma(s, x).state;
        const r = updateEwma(s, 0.03);
        // After warm-up + 1 obs, k=1, stabilizer=1 - (0.8)^2 = 0.36
        // se = σ · √(0.2/1.8 · 0.36) = σ · √0.04 = σ · 0.2
        // ucl = 2.7 · σ · 0.2
        const sigma = Math.sqrt(s.variance);
        const expectedUcl = 2.7 * sigma * Math.sqrt((0.2 / 1.8) * (1 - Math.pow(0.8, 2)));
        expect(r.ucl).toBeCloseTo(expectedUcl, 6);
        expect(r.lcl).toBeCloseTo(-expectedUcl, 6);
    });
    it('caps points history at 50', () => {
        let s = newEwmaState();
        for (let i = 0; i < 80; i++) {
            s = updateEwma(s, 0.02).state;
        }
        expect(s.points.length).toBe(50);
    });
});
//# sourceMappingURL=audit-spc.test.js.map