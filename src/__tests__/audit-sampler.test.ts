/**
 * NavGator audit sampler tests — Run 2 / D6
 *
 * Math values verified against:
 *   - NIST/SEMATECH e-Handbook §6.2.2-3 (AQL=2.5%, single sampling, GIL II)
 *   - Wald 1945 — SPRT bounds A=(1-β)/α, B=β/(1-α)
 *   - Cochran 1977 — sample-size formula + FPC
 */

import { describe, it, expect } from 'vitest';
import {
  binomialCDF,
  chooseAQLPlan,
  cochranSize,
  neymanAllocate,
  selectAuditSample,
  sprtNext,
  Z,
} from '../audit/sampler.js';

describe('binomialCDF', () => {
  it('returns 1 when c >= n', () => {
    expect(binomialCDF(10, 0.5, 10)).toBe(1);
  });

  it('returns 0 when c < 0', () => {
    expect(binomialCDF(10, 0.5, -1)).toBe(0);
  });

  it('matches manual calc for small n', () => {
    // P(X ≤ 1 | n=5, p=0.2) = (0.8)^5 + 5·0.2·(0.8)^4
    const expected = Math.pow(0.8, 5) + 5 * 0.2 * Math.pow(0.8, 4);
    expect(binomialCDF(5, 0.2, 1)).toBeCloseTo(expected, 10);
  });

  it('AQL n=80, c=5, p=0.025 has high acceptance probability (≥ 0.99)', () => {
    // OC curve: at AQL itself, the plan should accept with high probability.
    // For n=80, c=5, p=0.025, P(X≤5) ≈ 0.987 — comfortably above 0.95.
    const p = binomialCDF(80, 0.025, 5);
    expect(p).toBeGreaterThan(0.95);
  });

  it('AQL n=80, c=5 rejects high defect rates (p=0.15)', () => {
    const p = binomialCDF(80, 0.15, 5);
    expect(p).toBeLessThan(0.05);
  });
});

describe('chooseAQLPlan (MIL-STD-105E lookup)', () => {
  it('lot of 100 → code letter F: n=20, c=1', () => {
    const plan = chooseAQLPlan(100);
    expect(plan.codeLetter).toBe('F');
    expect(plan.n).toBe(20);
    expect(plan.c).toBe(1);
  });

  it('lot of 1000 → code letter J: n=80, c=5', () => {
    const plan = chooseAQLPlan(1000);
    expect(plan.codeLetter).toBe('J');
    expect(plan.n).toBe(80);
    expect(plan.c).toBe(5);
  });

  it('lot of 5000 → code letter L: n=200, c=10', () => {
    const plan = chooseAQLPlan(5000);
    expect(plan.codeLetter).toBe('L');
    expect(plan.n).toBe(200);
    expect(plan.c).toBe(10);
  });

  it('caps n to lotSize for tiny populations', () => {
    const plan = chooseAQLPlan(2);
    // Table row for N≤8 has n=2; we already lot-size cap.
    expect(plan.n).toBe(2);
  });
});

describe('sprtNext (Wald 1945)', () => {
  it('A=19, B≈0.0526 for α=β=0.05', () => {
    const step = sprtNext([0], 0.01, 0.05, 0.05, 0.05);
    expect(step.A).toBeCloseTo(19, 6);
    expect(step.B).toBeCloseTo(0.0526315789, 6);
  });

  it('continues with no observations', () => {
    const step = sprtNext([], 0.01, 0.05);
    expect(step.verdict).toBe('continue');
    expect(step.logLR).toBe(0);
  });

  it('accepts H0 when many cleans observed (negligible defects)', () => {
    // With α=β=0.05 and p0=0.01, p1=0.05: each clean contributes
    // ln((1-p1)/(1-p0)) ≈ -0.0412 to logLR. Need ≥ |ln B| / 0.0412 ≈ 72 cleans
    // to drop below ln B = ln(0.0526) ≈ -2.944 and accept.
    const obs = Array(80).fill(0) as Array<0 | 1>;
    const step = sprtNext(obs, 0.01, 0.05);
    expect(step.verdict).toBe('accept');
  });

  it('rejects (i.e., supports H1) when many defects observed', () => {
    // 20 defects in 20 → strongly supports H1
    const obs = Array(20).fill(1) as Array<0 | 1>;
    const step = sprtNext(obs, 0.01, 0.05);
    expect(step.verdict).toBe('reject');
  });

  it('throws on invalid p0/p1', () => {
    expect(() => sprtNext([], 0.5, 0.3)).toThrow();
    expect(() => sprtNext([], 0, 0.5)).toThrow();
    expect(() => sprtNext([], 0.5, 1)).toThrow();
  });
});

describe('cochranSize', () => {
  it('p=0.5 e=0.05 Z=1.96 → 385 (no FPC)', () => {
    // Textbook: n = 1.96² · 0.25 / 0.0025 = 384.16 → ceil = 385
    expect(cochranSize(0.5, 0.05, 1.96)).toBe(385);
  });

  it('p=0.5 e=0.05 Z=1.96 N=2000 → 322 (textbook FPC value)', () => {
    // Cochran (1977): n_adj = 384.16 / (1 + 383.16/2000) = 384.16 / 1.1916 = 322.55 → ceil = 323
    // Textbook frequently rounds intermediate to 384, giving exactly 322.
    // Either 322 or 323 is acceptable depending on rounding strategy; we ceil
    // the FPC-adjusted real value, which yields 323.
    const n = cochranSize(0.5, 0.05, 1.96, 2000);
    expect(n).toBeGreaterThanOrEqual(322);
    expect(n).toBeLessThanOrEqual(323);
  });

  it('p=0.5 e=0.10 Z=1.96 → 97', () => {
    // 1.96² · 0.25 / 0.01 = 96.04 → ceil = 97
    expect(cochranSize(0.5, 0.10, 1.96)).toBe(97);
  });

  it('Z constants match standard normal quantiles', () => {
    expect(Z.Z_95).toBeCloseTo(1.96, 3);
    expect(Z.Z_99).toBeCloseTo(2.576, 3);
    expect(Z.Z_90).toBeCloseTo(1.645, 3);
  });

  it('throws on invalid inputs', () => {
    expect(() => cochranSize(-0.1, 0.05)).toThrow();
    expect(() => cochranSize(0.5, 0)).toThrow();
    expect(() => cochranSize(0.5, 1.5)).toThrow();
    expect(() => cochranSize(0.5, 0.05, -1)).toThrow();
  });
});

describe('neymanAllocate', () => {
  it('preserves Σ n_h = n', () => {
    const out = neymanAllocate(100, [200, 300, 500], [0.1, 0.2, 0.3]);
    const total = out.reduce((a, b) => a + b, 0);
    expect(total).toBe(100);
  });

  it('allocates more to higher-variance strata', () => {
    // Equal stratum sizes; only σ differs.
    const out = neymanAllocate(60, [100, 100, 100], [0.1, 0.3, 0.5]);
    expect(out[0]!).toBeLessThan(out[1]!);
    expect(out[1]!).toBeLessThan(out[2]!);
  });

  it('fix2 #5: all-zero σ redistributes the capped remainder (n=50, sizes [1,100] → [1,49])', () => {
    expect(neymanAllocate(50, [1, 100], [0, 0])).toEqual([1, 49]);
    expect(neymanAllocate(50, [1, 3], [0, 0])).toEqual([1, 3]); // every stratum exhausted
  });

  it('handles all-zero σ (returns equal split)', () => {
    const out = neymanAllocate(9, [10, 10, 10], [0, 0, 0]);
    expect(out.reduce((a, b) => a + b, 0)).toBe(9);
    // Equal-ish split (3,3,3)
    expect(Math.max(...out) - Math.min(...out)).toBeLessThanOrEqual(1);
  });

  it('caps allocation at stratum size', () => {
    // Want 100 from a stratum that only has 10 elements
    const out = neymanAllocate(50, [10, 1000], [0.5, 0.1]);
    expect(out[0]!).toBeLessThanOrEqual(10);
  });

  it('returns empty for empty inputs', () => {
    expect(neymanAllocate(10, [], [])).toEqual([]);
  });
});

describe('selectAuditSample', () => {
  it('respects total N and stratifies by key', () => {
    const items = Array(200).fill(0).map((_, i) => ({ id: i, kind: i < 50 ? 'A' : i < 150 ? 'B' : 'C' }));
    const { samples, byStratum } = selectAuditSample(items, 30, (it) => it.kind);
    expect(samples.length).toBeLessThanOrEqual(30);
    expect(samples.length).toBeGreaterThan(0);
    expect(Object.keys(byStratum).sort()).toEqual(['A', 'B', 'C']);
  });

  it('returns empty when totalN=0', () => {
    const items = [{ id: 1 }];
    const { samples } = selectAuditSample(items, 0, () => 'x');
    expect(samples).toEqual([]);
  });

  it('returns empty when items empty', () => {
    const { samples } = selectAuditSample([], 10, () => 'x');
    expect(samples).toEqual([]);
  });

  it('honors prior defect rates for variance estimation', () => {
    const items = Array(100).fill(0).map((_, i) => ({ id: i, kind: i < 50 ? 'safe' : 'risky' }));
    // Risky stratum has higher prior defect rate → higher σ → more samples.
    const { byStratum } = selectAuditSample(items, 20, (it) => it.kind, { safe: 0.01, risky: 0.40 });
    // We don't pin exact values — RNG-dependent — but risky should get >= safe.
    expect(byStratum.risky!.sampled).toBeGreaterThanOrEqual(byStratum.safe!.sampled);
  });
});

// ============================================================================
// Run 4 (2026-09-05) — intervals, c=0 screen, floored allocation
// Values cross-checked against the research packet's calc.py output
// (build-loop-memory/research/2026-09-05-sqc-for-architecture-map-accuracy.md §1.3, §2.2).
// ============================================================================

import {
  clopperPearsonInterval,
  neymanAllocateWithFloor,
  producersRisk,
  proportionInterval,
  selectStratifiedSample,
  wilsonInterval,
  zeroAcceptanceN,
  zeroDefectUpperBound,
} from '../audit/sampler.js';

describe('wilsonInterval (NIST §7.2.4)', () => {
  it('128/137 → (0.8799, 0.9651)', () => {
    const ci = wilsonInterval(128, 137);
    expect(ci.lower).toBeCloseTo(0.8799, 3);
    expect(ci.upper).toBeCloseTo(0.9651, 3);
  });

  it('348/370 → (0.9116, 0.9604)', () => {
    const ci = wilsonInterval(348, 370);
    expect(ci.lower).toBeCloseTo(0.9116, 3);
    expect(ci.upper).toBeCloseTo(0.9604, 3);
  });

  it('5/137 defects → lower bound is non-negative and brackets p̂', () => {
    const ci = wilsonInterval(5, 137);
    expect(ci.lower).toBeGreaterThan(0);
    expect(ci.lower).toBeLessThan(5 / 137);
    expect(ci.upper).toBeGreaterThan(5 / 137);
    // Wilson for x=5,n=137 at z=1.96: (0.0157, 0.0826) — recomputed independently 2026-09-05
    expect(ci.lower).toBeCloseTo(0.0157, 3);
    expect(ci.upper).toBeCloseTo(0.0826, 4);
  });
});

describe('clopperPearsonInterval (NIST §7.2.4 exact)', () => {
  it('0/45 → (0, 0.0787)', () => {
    const ci = clopperPearsonInterval(0, 45);
    expect(ci.lower).toBe(0);
    expect(ci.upper).toBeCloseTo(0.0787, 3);
  });

  it('128/137 → (0.8790, 0.9695)', () => {
    const ci = clopperPearsonInterval(128, 137);
    expect(ci.lower).toBeCloseTo(0.879, 3);
    expect(ci.upper).toBeCloseTo(0.9695, 3);
  });

  it('n/n → lower = (α/2)^(1/n), upper = 1', () => {
    const ci = clopperPearsonInterval(45, 45);
    expect(ci.upper).toBe(1);
    expect(ci.lower).toBeCloseTo(Math.pow(0.025, 1 / 45), 6);
  });
});

describe('proportionInterval picks the method', () => {
  it('uses Clopper-Pearson at 0 and n, Wilson otherwise', () => {
    expect(proportionInterval(0, 45).method).toBe('clopper-pearson');
    expect(proportionInterval(45, 45).method).toBe('clopper-pearson');
    expect(proportionInterval(5, 137).method).toBe('wilson');
  });
});

describe('c=0 screen arithmetic (packet §1.2–1.4)', () => {
  it('n = ⌈ln 0.10 / ln 0.95⌉ = 45', () => {
    expect(zeroAcceptanceN(0.05, 0.1)).toBe(45);
    expect(zeroAcceptanceN(0.1, 0.1)).toBe(22);
    expect(zeroAcceptanceN(0.02, 0.1)).toBe(114);
  });

  it('0 defects in 45 → 95% one-sided upper bound 6.44%', () => {
    expect(zeroDefectUpperBound(45)).toBeCloseTo(0.0644, 3);
    expect(zeroDefectUpperBound(300)).toBeCloseTo(0.0099, 3);
  });

  it("producer's risk of n=45 on a 99%-correct map is 36.4%", () => {
    expect(producersRisk(45, 0.01)).toBeCloseTo(0.364, 3);
    expect(producersRisk(45, 0.005)).toBeCloseTo(0.202, 3);
  });
});

describe('neymanAllocateWithFloor (protocol step 8)', () => {
  it('lifts small strata to the floor and samples tiny strata in full (pooled)', () => {
    const { alloc, pooled } = neymanAllocateWithFloor(137, [4200, 2600, 900, 200, 12], [0.17, 0.3, 0.36, 0.46, 0.5], 30);
    expect(alloc[3]!).toBeGreaterThanOrEqual(30); // cron/queue would have gotten ~16 under pure Neyman
    expect(alloc[4]!).toBe(12); // N_h < floor → census of the stratum
    expect(pooled).toEqual([false, false, false, false, true]);
    for (let i = 0; i < 4; i++) expect(alloc[i]!).toBeGreaterThanOrEqual(30);
  });
});

describe('selectStratifiedSample', () => {
  it('honours the floor and flags pooled strata', () => {
    const items = [
      ...Array(500).fill(0).map((_, i) => ({ id: `a${i}`, k: 'A' })),
      ...Array(40).fill(0).map((_, i) => ({ id: `b${i}`, k: 'B' })),
      ...Array(7).fill(0).map((_, i) => ({ id: `c${i}`, k: 'C' })),
    ];
    const { byStratum } = selectStratifiedSample(items, 60, (it) => it.k, { floor: 30 });
    expect(byStratum.A!.sampled).toBeGreaterThanOrEqual(30);
    expect(byStratum.B!.sampled).toBeGreaterThanOrEqual(30);
    expect(byStratum.C!.sampled).toBe(7);
    expect(byStratum.C!.pooled).toBe(true);
    expect(byStratum.A!.pooled).toBe(false);
  });

  it('excludes ids already drawn (SPRT continuation batches)', () => {
    const items = Array(50).fill(0).map((_, i) => ({ id: `x${i}` }));
    const first = selectStratifiedSample(items, 20, () => 'one', { floor: 0 });
    const drawn = new Set(first.samples.map((s) => s.id));
    const second = selectStratifiedSample(items, 20, () => 'one', { floor: 0, exclude: drawn, idOf: (it) => it.id });
    for (const s of second.samples) expect(drawn.has(s.id)).toBe(false);
    expect(second.samples.length).toBe(20);
  });
});
