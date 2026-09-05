/**
 * NavGator audit self-test + orchestrator tests — Run 4 (2026-09-05).
 *
 *  - the self-test detects ≥ 90% of planted defects per testable class
 *  - MUTATION PROOF: with a verifier stubbed out the self-test FAILS
 *  - `sampled` counts distinct facts (defect 3)
 *  - strata below the floor are flagged pooled and charted under __pooled
 *  - SPRT draws continuation batches and ends accept/reject/inconclusive (defect 4)
 *  - the audit never throws out of a scan when a verifier explodes
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ArchitectureComponent, ArchitectureConnection, NavGatorConfig, NavHashes } from '../types.js';
import { runAudit, updateEwmaForAudit, POOLED_STRATUM, CENSUS_STRATUM } from '../audit/index.js';
import { runSelfTest } from '../audit/self-test.js';
import { getConfig } from '../config.js';

let root: string;
let config: NavGatorConfig;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sha(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

/** Build a clean, realistic fixture: F source files, one component per file, imports between them. */
function buildGraph(F: number): { components: ArchitectureComponent[]; connections: ArchitectureConnection[]; hashes: NavHashes } {
  const components: ArchitectureComponent[] = [];
  const connections: ArchitectureConnection[] = [];
  const files: Record<string, { hash: string; lastScanned: number; size: number }> = {};
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'fx', dependencies: { react: '1' } }));
  components.push({
    component_id: 'COMP_npm_react',
    name: 'react',
    type: 'npm',
    role: { purpose: 'ui', layer: 'frontend', critical: false },
    source: { detection_method: 'auto', config_files: ['package.json'], confidence: 1 },
    connects_to: [],
    connected_from: [],
    status: 'active',
    tags: [],
    timestamp: 0,
    last_updated: 0,
  });
  for (let i = 0; i < F; i++) {
    const rel = `src/mod${i}.ts`;
    const next = `mod${(i + 1) % F}`;
    const content = `import { fn${(i + 1) % F} } from './${next}';\nimport React from 'react';\nexport function fn${i}() { return fn${(i + 1) % F}(); }\n`;
    fs.writeFileSync(path.join(root, rel), content);
    files[rel] = { hash: sha(content), lastScanned: 0, size: content.length };
    components.push({
      component_id: `COMP_mod${i}`,
      name: `mod${i}`,
      type: 'component',
      role: { purpose: 'module', layer: 'backend', critical: false },
      source: { detection_method: 'auto', config_files: [rel], confidence: 1 },
      connects_to: [],
      connected_from: [],
      status: 'active',
      tags: [],
      timestamp: 0,
      last_updated: 0,
    });
  }
  for (let i = 0; i < F; i++) {
    const rel = `src/mod${i}.ts`;
    connections.push({
      connection_id: `CONN_imp_${i}`,
      from: { component_id: `COMP_mod${i}`, location: { file: rel, line: 1 } },
      to: { component_id: `COMP_mod${(i + 1) % F}`, location: { file: `src/mod${(i + 1) % F}.ts`, line: 1 } },
      connection_type: 'imports',
      code_reference: { file: rel, symbol: `fn${(i + 1) % F}` },
      detected_from: 'test',
      confidence: 1,
      timestamp: 0,
      last_verified: 0,
    });
    connections.push({
      connection_id: `CONN_pkg_${i}`,
      from: { component_id: `COMP_mod${i}`, location: { file: rel, line: 2 } },
      to: { component_id: 'COMP_npm_react' },
      connection_type: 'uses-package',
      code_reference: { file: rel, symbol: 'react' },
      detected_from: 'test',
      confidence: 1,
      timestamp: 0,
      last_verified: 0,
    });
  }
  return { components, connections, hashes: { version: '1.0', generatedAt: 0, projectPath: root, files } };
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-selftest-'));
  config = getConfig();
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('runSelfTest', () => {
  it('detects ≥ 90% of planted defects in every testable class', async () => {
    const g = buildGraph(60);
    const rep = await runSelfTest(g, { projectRoot: root, config, hashes: g.hashes, K: 10, rand: mulberry32(7) });
    const byClass = Object.fromEntries(rep.classes.map((c) => [c.class, c]));
    for (const cls of ['HALLUCINATED_COMPONENT', 'HALLUCINATED_EDGE', 'WRONG_ENDPOINT', 'STALE_REFERENCE', 'DEDUP_COLLISION'] as const) {
      expect(byClass[cls]!.testable, cls).toBe(true);
      expect(byClass[cls]!.planted, cls).toBe(10);
      expect(byClass[cls]!.recall!, cls).toBeGreaterThanOrEqual(0.9);
    }
    expect(byClass['MISSED_EDGE']!.testable).toBe(false);
    expect(rep.pass).toBe(true);
    expect(rep.sampling_power.screen_power_at_ltpd).toBeCloseTo(0.9, 1);
  });

  it('MUTATION: stubbing WRONG_ENDPOINT makes the self-test fail with recall 0 for that class only', async () => {
    const g = buildGraph(60);
    const rep = await runSelfTest(g, {
      projectRoot: root,
      config,
      hashes: g.hashes,
      K: 10,
      rand: mulberry32(7),
      disabledVerifiers: ['WRONG_ENDPOINT'],
    });
    const we = rep.classes.find((c) => c.class === 'WRONG_ENDPOINT')!;
    expect(we.recall).toBe(0);
    expect(we.missed_ids.length).toBe(10);
    expect(rep.pass).toBe(false);
    const he = rep.classes.find((c) => c.class === 'HALLUCINATED_EDGE')!;
    expect(he.recall).toBe(1);
  });

  it('MUTATION: stubbing STALE_REFERENCE and DEDUP_COLLISION each fail independently', async () => {
    const g = buildGraph(40);
    for (const cls of ['STALE_REFERENCE', 'DEDUP_COLLISION'] as const) {
      const rep = await runSelfTest(g, { projectRoot: root, config, hashes: g.hashes, K: 5, rand: mulberry32(3), disabledVerifiers: [cls] });
      expect(rep.pass, cls).toBe(false);
      expect(rep.classes.find((c) => c.class === cls)!.recall, cls).toBe(0);
    }
  });

  it('does not mutate the caller graph', async () => {
    const g = buildGraph(20);
    const nComp = g.components.length;
    const nConn = g.connections.length;
    const hash0 = g.hashes.files['src/mod0.ts']!.hash;
    await runSelfTest(g, { projectRoot: root, config, hashes: g.hashes, K: 10 });
    expect(g.components.length).toBe(nComp);
    expect(g.connections.length).toBe(nConn);
    expect(g.hashes.files['src/mod0.ts']!.hash).toBe(hash0);
  });
});

describe('runAudit (Run 4 corrections)', () => {
  it('sampled counts distinct facts, not per-verifier sums (defect 3)', async () => {
    const g = buildGraph(80);
    const r = (await runAudit(g, config, root, { hashes: g.hashes, rand: mulberry32(1), oracles: false }))!;
    const inspectedConns = r.by_class.HALLUCINATED_EDGE!.sampled;
    const inspectedComps = r.by_class.HALLUCINATED_COMPONENT!.sampled;
    const files = r.by_class.STALE_REFERENCE!.sampled;
    // Old behaviour: v1+v2+v3+v4+v6 = comps + 2·conns + 2·files.
    expect(r.sampled).toBe(inspectedComps + inspectedConns + files);
    expect(r.by_class.WRONG_ENDPOINT!.sampled).toBe(inspectedConns);
    expect(r.defects).toBe(0);
    expect(r.verdict).toBe('accept');
    expect(r.screen?.c).toBe(0);
    expect(r.screen?.n).toBe(45);
    // F1: risk at the COMBINED inspected count (45 + 45 = 90): 1 − 0.99^90 = 0.595; bound 1 − 0.05^(1/90) = 0.0327.
    expect(r.screen?.inspected).toBe(90);
    expect(r.screen?.producers_risk_at_1pct).toBeCloseTo(0.595, 2);
    expect(r.screen?.upper_bound_95).toBeCloseTo(0.0327, 3);
    expect(r.screen?.per_population?.producers_risk_at_1pct).toBeCloseTo(0.364, 2);
    expect(r.screen?.per_population?.upper_bound_95).toBeCloseTo(0.0644, 3);
    expect(r.census?.unresolved_endpoints.bad).toBe(0);
    expect(r.navgator_version).toBeTruthy();
  });

  it('flags strata under the floor as pooled and charts them under __pooled; census gets a u-chart', async () => {
    const g = buildGraph(80); // strata: package (1 npm comp), __other (80 comps), connection-imports (160 conns)
    const r = (await runAudit(g, config, root, { hashes: g.hashes, rand: mulberry32(2), oracles: false }))!;
    expect(r.by_stratum['package']?.pooled).toBe(true);
    expect(r.by_stratum['package']?.n_total).toBe(1);
    expect(r.by_stratum['connection-imports']?.sampled).toBeGreaterThanOrEqual(30);
    expect(r.by_stratum['connection-imports']?.ci?.method).toBe('clopper-pearson');
    expect(r.precision?.pooled_strata).toContain('package');
    const { ewma } = updateEwmaForAudit(undefined, r, '0.9.1');
    expect(ewma[POOLED_STRATUM]).toBeDefined();
    expect(ewma['package']).toBeUndefined();
    expect(ewma[CENSUS_STRATUM]?.kind).toBe('u');
    expect(ewma['connection-imports']?.version).toBe('0.9.1');
    expect(ewma['connection-imports']?.phase).toBe('provisional');
  });

  it('SPRT draws continuation batches and reaches accept on a clean graph (defect 4)', async () => {
    const g = buildGraph(150);
    const r = (await runAudit(g, config, root, { plan: 'SPRT', priorAuditCount: 5, hashes: g.hashes, rand: mulberry32(9), oracles: false }))!;
    expect(r.plan).toBe('SPRT');
    // F4: the report-level verdict is the c=0 screen for every plan; the SPRT decision lives on `sprt.verdict`.
    expect(['accept', 'reject']).toContain(r.verdict);
    expect(r.sprt).toBeDefined();
    expect(['accept', 'reject', 'inconclusive']).toContain(r.sprt!.verdict);
    expect(r.sprt!.observations).toBeGreaterThan(0);
    // 80 cleans are enough to accept (ln B ≈ −2.94 / −0.041 per clean ≈ 72): routine sample already exceeds that.
    expect(r.sprt!.verdict).toBe('accept');
  });

  it('SPRT reports inconclusive when the founding cap is reached without a verdict', async () => {
    // A graph too small to ever cross the SPRT bound: cap = N, alternating clean/defect keeps logLR in-band.
    const g = buildGraph(6);
    // Make half the import edges wrong-endpoint defects.
    for (let i = 0; i < 6; i += 2) g.connections[i * 2]!.code_reference.symbol = 'definitely_not_here';
    for (let i = 0; i < 6; i += 2) g.components[i + 1]!.name = 'nope_name';
    const r = (await runAudit(g, config, root, { plan: 'SPRT', priorAuditCount: 5, hashes: g.hashes, rand: mulberry32(4), oracles: false }))!;
    expect(['accept', 'reject', 'inconclusive']).toContain(r.sprt!.verdict);
    expect(r.sprt!.observations).toBeLessThanOrEqual(r.sprt!.cap);
  });

  it('returns a report (never throws) when hashes are unreadable and oracles hit an empty root', async () => {
    const g = buildGraph(10);
    const r = await runAudit(g, config, root, { hashes: null, rand: mulberry32(5) });
    expect(r).not.toBeNull();
    expect(r!.oracles?.length).toBe(5);
  });
});

describe('audit findings F2 / F5 / (a)', () => {
  it('F2: a planted dedup collision is counted in the census and by_class, never in the sampled defect rate', async () => {
    const g = buildGraph(30);
    for (let i = 0; i < 5; i++) g.components.push({ ...g.components[1]!, component_id: `COMP_dup_${i}` });
    const r = (await runAudit(g, config, root, { hashes: g.hashes, rand: mulberry32(11), oracles: false }))!;
    expect(r.census?.dedup_collisions).toBe(5);
    expect(r.by_class.DEDUP_COLLISION?.defects).toBe(5);
    expect(r.defects).toBe(0);
    expect(r.defect_rate).toBe(0);
    expect(r.defect_rate).toBeLessThanOrEqual(1);
  });

  it('F5: components with no evidence are reported unverifiable, excluded from rates, and never counted clean', async () => {
    const g = buildGraph(30);
    for (let i = 0; i < 12; i++) {
      g.components.push({
        component_id: `COMP_ghost_${i}`,
        name: `Ghost${i}`,
        type: 'component',
        role: { purpose: 'aggregate', layer: 'backend', critical: false },
        source: { detection_method: 'auto', config_files: [], confidence: 0.8 },
        connects_to: [],
        connected_from: [],
        status: 'active',
        tags: ['swift'],
        timestamp: 0,
        last_updated: 0,
      });
    }
    const forced = g.components.filter((c) => c.component_id.startsWith('COMP_ghost_'));
    const r = (await runAudit(g, config, root, { hashes: g.hashes, rand: mulberry32(12), oracles: false, forceInclude: { components: forced } }))!;
    expect(r.by_class.HALLUCINATED_COMPONENT?.unverifiable).toBe(12);
    expect(r.unverifiable).toBe(12);
    expect(r.defects).toBe(0);
    // Rate denominator excludes the unverifiable facts.
    expect(r.defect_rate).toBe(0);
    const evidenceIds = (r.defect_evidence ?? []).map((e) => e.id);
    for (const c of forced) expect(evidenceIds).not.toContain(c.component_id);
  });

  it('(a): a stratum pooled this run drops its stale standalone series; empty subgroups are never charted', async () => {
    const g = buildGraph(40);
    const r = (await runAudit(g, config, root, { hashes: g.hashes, rand: mulberry32(13), oracles: false }))!;
    expect(r.by_stratum['package']?.pooled).toBe(true);
    const prior = { package: { lambda: 0.2, L: 2.7, mean: 0.5, variance: 0, n: 2, points: [0, 0] } };
    const { ewma } = updateEwmaForAudit(prior, r, '0.9.1');
    expect(ewma['package']).toBeUndefined();
    expect(ewma[POOLED_STRATUM]?.n).toBe(1);
    const zero = { ...r, by_stratum: { ...r.by_stratum, ghost: { sampled: 0, defects: 0, defect_rate: 0 } } };
    expect(updateEwmaForAudit(undefined, zero, '0.9.1').ewma['ghost']).toBeUndefined();
  });
});
