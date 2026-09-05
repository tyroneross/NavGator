/**
 * NavGator audit SPC tests — Run 2 / D6, rewritten Run 4 (2026-09-05).
 *
 * Run 2 behaviour (5-point warm-up, limits from the warm-up sample variance,
 * variance floored at 1e-12) let an all-zero series breach on its first
 * non-zero point (atomize-ai `connection-services`, defect 1). Run 4: Phase I
 * of 25 subgroups, p̄ floored at 0.01, p-chart σ from the subgroup size,
 * EWMA + CUSUM + WE-1/WE-4 only, version re-baseline.
 */

import { describe, it, expect } from 'vitest';
import { newEwmaState, P_FLOOR, PHASE1_SUBGROUPS, updateChart, updateEwma, type EwmaState } from '../audit/spc.js';

function feed(state: EwmaState, xs: ReadonlyArray<number>, n = 137, version = '0.9.1') {
  let s = state;
  const breaches: boolean[] = [];
  for (const x of xs) {
    const r = updateChart(s, { x, n, defects: Math.round(x * n) }, { version, kind: 'p' });
    s = r.state;
    breaches.push(r.breach);
  }
  return { state: s, breaches };
}

describe('newEwmaState', () => {
  it('default lambda=0.2, L=2.7, provisional', () => {
    const s = newEwmaState();
    expect(s.lambda).toBeCloseTo(0.2, 6);
    expect(s.L).toBeCloseTo(2.7, 6);
    expect(s.n).toBe(0);
    expect(s.points).toEqual([]);
    expect(s.phase).toBe('provisional');
  });

  it('honors overrides', () => {
    const s = newEwmaState(0.1, 3);
    expect(s.lambda).toBe(0.1);
    expect(s.L).toBe(3);
  });
});

describe('Phase I (provisional)', () => {
  it('never breaches before PHASE1_SUBGROUPS points, even on extreme values', () => {
    const { state, breaches } = feed(newEwmaState(), [0, 0, 0, 0.5, 0.9, 0, 0, 0.7, 0, 0]);
    expect(breaches.every((b) => !b)).toBe(true);
    expect(state.phase).toBe('provisional');
    expect(state.n).toBe(10);
  });

  it('freezes at PHASE1_SUBGROUPS with p̄ = ΣD/Σn and the 0.01 floor', () => {
    const zeros = Array(PHASE1_SUBGROUPS).fill(0) as number[];
    const { state } = feed(newEwmaState(), zeros);
    expect(state.phase).toBe('frozen');
    expect(state.center).toBeCloseTo(P_FLOOR, 9);
    expect(state.floor_active).toBe(true);

    const xs = Array(PHASE1_SUBGROUPS).fill(0.06) as number[];
    const s2 = feed(newEwmaState(), xs, 150).state;
    expect(s2.center).toBeCloseTo(0.06, 6);
    expect(s2.floor_active).toBe(false);
  });

  it('legacy updateEwma(prev, x) still accumulates (Run 2 signature)', () => {
    let s = newEwmaState();
    for (const x of [0.02, 0.02, 0.02, 0.02, 0.02]) s = updateEwma(s, x).state;
    expect(s.mean).toBeCloseTo(0.02, 6);
    expect(s.n).toBe(5);
    expect(s.phase).toBe('provisional');
  });
});

describe('atomize-ai connection-services replay (defect 1)', () => {
  // Eight 0.0 points then 0.0333 breached under Run 2 (mean 0, variance 0).
  const series = [0, 0, 0, 0, 0, 0, 0, 0, 0.0333];

  it('no breach while provisional', () => {
    const { state, breaches } = feed(newEwmaState(), series, 30);
    expect(breaches.some(Boolean)).toBe(false);
    expect(state.phase).toBe('provisional');
  });

  it('no breach after freezing on all-zero Phase I because p̄ is floored', () => {
    const zeros = Array(PHASE1_SUBGROUPS).fill(0) as number[];
    const frozen = feed(newEwmaState(), zeros, 30).state;
    expect(frozen.phase).toBe('frozen');
    const r = updateChart(frozen, { x: 0.0333, n: 30, defects: 1 }, { version: '0.9.1', kind: 'p' });
    expect(r.breach).toBe(false);
    expect(r.signals).toEqual([]);
    // Limits are real width now: p̄ + 3√(p̄(1−p̄)/30) = 0.01 + 3·0.01817 ≈ 0.0645
    expect(r.ucl).toBeCloseTo(0.0645, 3);
    expect(r.lcl).toBe(0);
  });
});

describe('Phase II detectors', () => {
  const stable = Array(PHASE1_SUBGROUPS).fill(0.06) as number[];

  it('p-chart limits match NIST: p̄=0.06, n=150 → UCL 0.1182, LCL 0.0018', () => {
    const frozen = feed(newEwmaState(), stable, 150).state;
    const r = updateChart(frozen, { x: 0.06, n: 150 }, { version: '0.9.1' });
    expect(r.ucl).toBeCloseTo(0.1182, 3);
    expect(r.lcl).toBeCloseTo(0.0018, 3);
    // EWMA band: σ_ewma = 0.01939·√(0.2/1.8) = 0.00646 → 0.06 ± 2.7·0.00646 = (0.0425, 0.0775)
    expect(r.ewma_ucl).toBeCloseTo(0.0775, 3);
    expect(r.ewma_lcl).toBeCloseTo(0.0425, 3);
  });

  it('Rule 1 fires on a single catastrophic point', () => {
    const frozen = feed(newEwmaState(), stable, 150).state;
    const r = updateChart(frozen, { x: 0.2, n: 150 }, { version: '0.9.1' });
    expect(r.breach).toBe(true);
    expect(r.signals).toContain('rule1-high');
  });

  it('EWMA/CUSUM catch a sustained 1σ slide that Rule 1 misses', () => {
    let s = feed(newEwmaState(), stable, 150).state;
    const shifted = 0.06 + 0.0194; // +1σ at n=150
    const seen = new Set<string>();
    let rule1 = false;
    for (let i = 0; i < 12; i++) {
      const r = updateChart(s, { x: shifted, n: 150 }, { version: '0.9.1' });
      s = r.state;
      for (const sig of r.signals) seen.add(sig);
      if (r.signals.includes('rule1-high')) rule1 = true;
    }
    expect(rule1).toBe(false);
    expect(seen.has('ewma-high') || seen.has('cusum-high')).toBe(true);
  });

  it('a non-zero low-side breach is a real signal when the centre came from data', () => {
    const frozen = feed(newEwmaState(), Array(PHASE1_SUBGROUPS).fill(0.1) as number[], 400).state;
    expect(frozen.floor_active).toBe(false);
    const r = updateChart(frozen, { x: 0, n: 400 }, { version: '0.9.1' });
    expect(r.lcl).toBeGreaterThan(0);
    expect(r.signals).toContain('rule1-low');
  });

  it('low-side signals are suppressed when the centre is the floor prior', () => {
    let s = feed(newEwmaState(), Array(PHASE1_SUBGROUPS).fill(0) as number[], 400).state;
    expect(s.floor_active).toBe(true);
    for (let i = 0; i < 20; i++) {
      const r = updateChart(s, { x: 0, n: 400 }, { version: '0.9.1' });
      s = r.state;
      expect(r.breach).toBe(false);
    }
  });

  it('Rule 4 fires on 8 consecutive points above the centre', () => {
    let s = feed(newEwmaState(), stable, 150).state;
    let hit = false;
    for (let i = 0; i < 8; i++) {
      const r = updateChart(s, { x: 0.065, n: 150 }, { version: '0.9.1' });
      s = r.state;
      if (r.signals.includes('rule4-high')) hit = true;
    }
    expect(hit).toBe(true);
  });

  it('caps points history at 50', () => {
    const { state } = feed(newEwmaState(), Array(80).fill(0.02) as number[]);
    expect(state.points.length).toBe(50);
  });
});

describe('re-baseline on NavGator version change (protocol step 15)', () => {
  it('resets to provisional and records the prior version', () => {
    const frozen = feed(newEwmaState(), Array(PHASE1_SUBGROUPS).fill(0.06) as number[], 150, '0.9.1').state;
    expect(frozen.phase).toBe('frozen');
    const r = updateChart(frozen, { x: 0.3, n: 150 }, { version: '0.9.2' });
    expect(r.breach).toBe(false);
    expect(r.state.phase).toBe('provisional');
    expect(r.state.n).toBe(1);
    expect(r.state.version).toBe('0.9.2');
    expect(r.state.rebaselined_from).toBe('0.9.1');
  });

  it('a legacy state without version adopts the current version without resetting', () => {
    const legacy: EwmaState = { lambda: 0.2, L: 2.7, mean: 0, variance: 0, n: 10, points: Array(10).fill(0), breach_pending: true };
    const r = updateChart(legacy, { x: 0.0333, n: 30 }, { version: '0.9.1' });
    expect(r.state.n).toBe(11);
    expect(r.state.version).toBe('0.9.1');
    expect(r.state.rebaselined_from).toBeUndefined();
    expect(r.state.breach_pending).toBe(false);
  });
});
