/**
 * deep-map core: component filtering, partitioning, escalation scoring, and the
 * run store's path guards.
 *
 * These are the tests that hold the design claims up. In particular:
 *   - the escalation `violations` signal must ignore degree-derived rules, or
 *     PageRank and the violation count become the same measurement wearing two
 *     weights;
 *   - an oversized group must split into CONNECTED parts, or the "isolated
 *     packet" property the split exists to preserve is gone;
 *   - `isContained` must reject a sibling-prefix escape, which a plain
 *     `startsWith` check accepts.
 */

import { describe, it, expect } from 'vitest';
import * as path from 'path';

import type {
  ArchitectureComponent,
  ArchitectureConnection,
  ComponentType,
} from '../types.js';
import type { MetricsReport } from '../metrics/pagerank-louvain.js';
import type { RuleViolation } from '../rules.js';
import { sanitizePath } from '../config.js';
import { globToRegExp, selectMappableComponents } from '../deep-map/filter.js';
import {
  commonPathPrefix,
  partitionComponents,
  splitConnected,
  buildPagerankIndex,
} from '../deep-map/partition.js';
import { percentileIndex, normalizeFileMap, scoreEscalation } from '../deep-map/escalate.js';
import { ESCALATION_WEIGHTS } from '../deep-map/types.js';
import {
  generateRunId,
  isContained,
  isValidPacketId,
  isValidRunId,
  makePacketId,
  resultPathFor,
} from '../deep-map/store.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function comp(
  name: string,
  files: string[],
  opts: { type?: ComponentType; layer?: ArchitectureComponent['role']['layer'] } = {}
): ArchitectureComponent {
  return {
    component_id: `COMP_${opts.type ?? 'component'}_${name.replace(/[^a-z0-9]/gi, '_')}_aaaa`,
    stable_id: `STABLE_${opts.type ?? 'component'}_${name}`,
    name,
    type: opts.type ?? 'component',
    role: { purpose: '', layer: opts.layer ?? 'backend', critical: false },
    source: { detection_method: 'auto', config_files: files, confidence: 1 },
    connects_to: [],
    connected_from: [],
    status: 'active',
    tags: [],
    timestamp: 0,
    last_updated: 0,
  };
}

function conn(
  from: ArchitectureComponent,
  to: ArchitectureComponent,
  type: ArchitectureConnection['connection_type'] = 'imports'
): ArchitectureConnection {
  return {
    connection_id: `CONN_${type}_${from.name}_${to.name}`,
    from: { component_id: from.component_id, location: { file: 'a.ts', line: 1 } },
    to: { component_id: to.component_id },
    connection_type: type,
    code_reference: { file: 'a.ts', symbol: 'x' },
    detected_from: 'test',
    confidence: 1,
    timestamp: 0,
    last_verified: 0,
  };
}

function metricsFor(
  components: ArchitectureComponent[],
  community: (c: ArchitectureComponent, i: number) => number,
  pagerank: (c: ArchitectureComponent, i: number) => number
): MetricsReport {
  return {
    schema_version: '1.0',
    generated_at: 0,
    node_count: components.length,
    edge_count: 0,
    community_count: 1,
    modularity: 0.5,
    suppressed: false,
    metrics: components.map((c, i) => ({
      stable_id: c.stable_id!,
      component_id: c.component_id,
      name: c.name,
      pagerank_score: pagerank(c, i),
      community_id: community(c, i),
    })),
  };
}

// ---------------------------------------------------------------------------
// filter.ts
// ---------------------------------------------------------------------------

describe('deep-map component filter', () => {
  it('matches a single star within one path segment and a double star across segments', () => {
    expect(globToRegExp('web/*').test('web/a')).toBe(true);
    // The bug this guards: `*` must not cross a separator, or `web/*` silently
    // excludes the entire web tree instead of its direct children.
    expect(globToRegExp('web/*').test('web/a/b')).toBe(false);
    expect(globToRegExp('web/**').test('web/a/b/c')).toBe(true);
    expect(globToRegExp('web/**').test('webbing/a')).toBe(false);
    expect(globToRegExp('a?c.ts').test('abc.ts')).toBe(true);
    expect(globToRegExp('a?c.ts').test('abbc.ts')).toBe(false);
  });

  it('requires the separator that `**/` stands for', () => {
    // `**/` means "zero or more whole directories". Compiling it to a bare `.*`
    // and swallowing the slash loses the boundary: `**/test` became `^.*test$`
    // and matched `mytest`, silently excluding a file the user never named.
    const m = globToRegExp('**/test');
    expect(m.test('test')).toBe(true);
    expect(m.test('a/b/test')).toBe(true);
    expect(m.test('mytest')).toBe(false);
    expect(globToRegExp('src/**/util.ts').test('src/aXutil.ts')).toBe(false);
    expect(globToRegExp('src/**/util.ts').test('src/a/util.ts')).toBe(true);
  });

  it('treats a regex metacharacter in a pattern as a literal', () => {
    expect(globToRegExp('src/a.b.ts').test('src/a.b.ts')).toBe(true);
    expect(globToRegExp('src/a.b.ts').test('src/axbxts')).toBe(false);
  });

  it('drops external packages and unambiguous vendor directories, keeps project code', () => {
    const components = [
      comp('app', ['src/app.ts']),
      comp('react', ['package.json'], { type: 'npm' }),
      comp('lodash-copy', ['node_modules/lodash/index.js']),
      comp('pods-thing', ['Pods/AFNetworking/AFN.m']),
    ];
    const result = selectMappableComponents(components);
    expect(result.kept.map((c) => c.name)).toEqual(['app']);
    expect(result.excluded_vendor).toBe(2);
  });

  it('excludes by caller-supplied glob and counts it separately from vendor exclusion', () => {
    const components = [comp('app', ['src/app.ts']), comp('gen', ['web/runtime/packages/semver/x.js'])];
    const result = selectMappableComponents(components, { exclude: ['web/runtime/**'] });
    expect(result.kept.map((c) => c.name)).toEqual(['app']);
    expect(result.excluded_glob).toBe(1);
    expect(result.excluded_vendor).toBe(0);
  });

  it('flags rather than removes code under a container directory named for a scanned package', () => {
    // A monorepo's own `packages/<name>` is a legitimate hit, so this stays a
    // report rather than an exclusion — the count is what makes it a decision.
    const components = [
      comp('react', ['package.json'], { type: 'npm' }),
      comp('vendored-react', ['web/runtime/packages/react/index.js']),
    ];
    const result = selectMappableComponents(components);
    expect(result.kept.map((c) => c.name)).toEqual(['vendored-react']);
    expect(result.suspect_vendored).toHaveLength(1);
  });

  it('keeps vendored code when the caller opts in', () => {
    const components = [comp('lodash-copy', ['node_modules/lodash/index.js'])];
    expect(selectMappableComponents(components, { includeVendored: true }).kept).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// partition.ts
// ---------------------------------------------------------------------------

describe('deep-map partitioning', () => {
  it('reports the longest common directory prefix, and empty for unrelated trees', () => {
    expect(commonPathPrefix(['web/runtime/packages/semver/a.js', 'web/runtime/packages/semver/b.js']))
      .toBe('web/runtime/packages/semver');
    expect(commonPathPrefix(['src/a.ts', 'web/b.ts'])).toBe('');
    expect(commonPathPrefix([])).toBe('');
  });

  it('splits an oversized group into parts that are each internally connected', () => {
    // A ten-node path graph, with PageRank deliberately ranking the even nodes
    // above every odd one. That ordering is what gives this test teeth: slicing
    // the rank order yields [n0,n2,n4,n6] — four mutually disconnected nodes —
    // while BFS growth yields [n0,n1,n2,n3]. With a rank order that happened to
    // follow the path, both algorithms agree and the test proves nothing.
    const nodes = Array.from({ length: 10 }, (_, i) => comp(`n${i}`, [`src/n${i}.ts`]));
    const edges = nodes.slice(1).map((n, i) => conn(nodes[i]!, n));
    const pagerank = buildPagerankIndex(
      metricsFor(nodes, () => 0, (_c, i) => (i % 2 === 0 ? 1 : 0.5) - i / 100)
    );

    const parts = splitConnected(nodes, edges, pagerank, 4);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.flat().sort()).toEqual(nodes.map((n) => n.component_id).sort());

    const adjacency = new Map<string, Set<string>>();
    for (const n of nodes) adjacency.set(n.component_id, new Set());
    for (const e of edges) {
      adjacency.get(e.from.component_id)!.add(e.to.component_id);
      adjacency.get(e.to.component_id)!.add(e.from.component_id);
    }
    for (const part of parts) {
      const inPart = new Set(part);
      const seen = new Set([part[0]!]);
      const queue = [part[0]!];
      while (queue.length) {
        for (const nb of adjacency.get(queue.shift()!)!) {
          if (inPart.has(nb) && !seen.has(nb)) {
            seen.add(nb);
            queue.push(nb);
          }
        }
      }
      expect(seen.size).toBe(part.length);
    }
  });

  it('folds communities below minGroup into one residual group', () => {
    const members = [comp('a', ['src/a.ts']), comp('b', ['src/b.ts']), comp('c', ['src/c.ts'])];
    const loners = [comp('x', ['src/x.ts']), comp('y', ['src/y.ts'])];
    const all = [...members, ...loners];
    const metrics = metricsFor(
      all,
      (c) => (members.includes(c) ? 1 : all.indexOf(c) + 10),
      () => 0.1
    );

    const result = partitionComponents(all, [], metrics, { minGroup: 3 });
    const residual = result.groups.filter((g) => g.residual);
    expect(residual).toHaveLength(1);
    expect(residual[0]!.component_ids).toHaveLength(2);
    expect(result.residual_components).toBe(2);
  });

  it('caps group count at maxPackets and reports how many were dropped', () => {
    const groups = Array.from({ length: 8 }, (_, g) =>
      Array.from({ length: 3 }, (_, i) => comp(`g${g}n${i}`, [`src/g${g}/n${i}.ts`]))
    );
    const all = groups.flat();
    const metrics = metricsFor(all, (c) => groups.findIndex((g) => g.includes(c)), () => 0.1);

    const result = partitionComponents(all, [], metrics, { minGroup: 3, maxPackets: 3 });
    expect(result.groups).toHaveLength(3);
    expect(result.truncated).toBe(5);
  });

  it('produces identical groups on a repeat run', () => {
    const all = Array.from({ length: 12 }, (_, i) => comp(`n${i}`, [`src/n${i}.ts`]));
    const edges = all.slice(1).map((n, i) => conn(all[i]!, n));
    const metrics = metricsFor(all, (_c, i) => i % 3, (_c, i) => (12 - i) / 12);

    const a = partitionComponents(all, edges, metrics, {});
    const b = partitionComponents([...all].reverse(), edges, metrics, {});
    expect(JSON.stringify(a.groups)).toBe(JSON.stringify(b.groups));
  });

  it('falls back to layers when metrics are suppressed, and says so', () => {
    const all = [
      comp('a', ['src/a.ts'], { layer: 'backend' }),
      comp('b', ['src/b.ts'], { layer: 'backend' }),
      comp('c', ['src/c.ts'], { layer: 'backend' }),
    ];
    const suppressed: MetricsReport = {
      schema_version: '1.0',
      generated_at: 0,
      node_count: 3,
      edge_count: 0,
      community_count: 0,
      modularity: null,
      suppressed: true,
      reason: 'graph too small (3 < 20 nodes)',
      metrics: [],
    };
    const result = partitionComponents(all, [], suppressed, { minGroup: 3 });
    expect(result.unit).toBe('layer');
    expect(result.reason).toContain('graph too small');
    expect(result.groups[0]!.label).toBe('layer-backend');
  });
});

// ---------------------------------------------------------------------------
// escalate.ts
// ---------------------------------------------------------------------------

describe('deep-map escalation scoring', () => {
  it('gives tied values an identical percentile', () => {
    const pct = percentileIndex(new Map([['a', 1], ['b', 1], ['c', 5]]));
    expect(pct.get('a')).toBe(pct.get('b'));
    expect(pct.get('c')).toBe(1);
  });

  it('reads both the wrapped and the legacy file-map shapes', () => {
    expect(normalizeFileMap({ files: { 'a.ts': 'COMP_1' } })).toEqual({ 'a.ts': 'COMP_1' });
    expect(normalizeFileMap({ 'a.ts': 'COMP_1' })).toEqual({ 'a.ts': 'COMP_1' });
    expect(normalizeFileMap(null)).toEqual({});
  });

  it('ignores degree-derived rule violations so degree is not counted twice', () => {
    // PageRank already carries degree. If `hotspot-module` (fan-in >= 5) also
    // fed the violations signal, one property would supply two weights and the
    // published weight table would be a fiction.
    const target = comp('hot', ['src/hot.ts']);
    const other = comp('other', ['src/other.ts']);
    const components = [target, other];
    const metrics = metricsFor(components, () => 0, () => 0.1);

    const degreeOnly: RuleViolation[] = [
      { rule_id: 'hotspot-module', severity: 'warning', component: 'hot', message: '' },
      { rule_id: 'high-fan-out', severity: 'warning', component: 'hot', message: '' },
      { rule_id: 'shallow-module', severity: 'info', component: 'hot', message: '' },
      { rule_id: 'single-point-of-failure', severity: 'warning', component: 'hot', message: '' },
    ];
    const structural: RuleViolation[] = [
      { rule_id: 'layer-violation', severity: 'error', component: 'hot', message: '' },
    ];

    const withDegree = scoreEscalation({
      components,
      connections: [],
      metrics,
      violations: degreeOnly,
      fileMap: {},
    });
    expect(withDegree.ranked.find((r) => r.name === 'hot')!.signals.violations).toBe(0);
    expect(withDegree.ranked.find((r) => r.name === 'hot')!.raw.structural_violations).toEqual([]);

    const withStructural = scoreEscalation({
      components,
      connections: [],
      metrics,
      violations: structural,
      fileMap: {},
    });
    expect(withStructural.ranked.find((r) => r.name === 'hot')!.signals.violations).toBeGreaterThan(0);
  });

  it('normalises the bridge signal by degree so it is not another degree measure', () => {
    // Two nodes, both with every edge leaving their community: one with two
    // edges, one with six. A degree-flavoured signal would rank them apart.
    const small = comp('small', ['src/small.ts']);
    const big = comp('big', ['src/big.ts']);
    const others = Array.from({ length: 8 }, (_, i) => comp(`o${i}`, [`src/o${i}.ts`]));
    const components = [small, big, ...others];
    const metrics = metricsFor(
      components,
      (c) => (c === small || c === big ? 0 : 1),
      () => 0.1
    );
    const connections = [
      conn(small, others[0]!),
      conn(small, others[1]!),
      ...others.slice(2).map((o) => conn(big, o)),
    ];

    const result = scoreEscalation({ components, connections, metrics, violations: [], fileMap: {} });
    const s = result.ranked.find((r) => r.name === 'small')!;
    const b = result.ranked.find((r) => r.name === 'big')!;
    expect(s.signals.bridge).toBe(1);
    expect(b.signals.bridge).toBe(1);
  });

  it('scores a one-edge node as no bridge at all', () => {
    const a = comp('a', ['src/a.ts']);
    const b = comp('b', ['src/b.ts']);
    const components = [a, b];
    const metrics = metricsFor(components, (c) => (c === a ? 0 : 1), () => 0.1);
    const result = scoreEscalation({
      components,
      connections: [conn(a, b)],
      metrics,
      violations: [],
      fileMap: {},
    });
    expect(result.ranked.find((r) => r.name === 'a')!.signals.bridge).toBe(0);
  });

  it('counts violations it cannot join to a component instead of dropping them', () => {
    const components = [comp('a', ['src/a.ts'])];
    const metrics = metricsFor(components, () => 0, () => 0.1);
    const result = scoreEscalation({
      components,
      connections: [],
      metrics,
      violations: [
        { rule_id: 'layer-violation', severity: 'error', component: 'ghost', message: '' },
        { rule_id: 'circular-dependency', severity: 'error', message: '' },
      ],
      fileMap: {},
    });
    expect(result.unresolved_violations).toBe(2);
  });

  it('escalates at most maxDeep components, and none below the floor', () => {
    const components = Array.from({ length: 10 }, (_, i) => comp(`n${i}`, [`src/n${i}.ts`]));
    const metrics = metricsFor(components, () => 0, (_c, i) => (10 - i) / 10);
    const result = scoreEscalation(
      { components, connections: [], metrics, violations: [], fileMap: {} },
      { maxDeep: 2, threshold: 0 }
    );
    expect(result.escalated).toHaveLength(2);

    const none = scoreEscalation(
      { components, connections: [], metrics, violations: [], fileMap: {} },
      { threshold: 1.1 }
    );
    expect(none.escalated).toHaveLength(0);
  });

  it('composes the score from the published weights, term by term', () => {
    // The audit that prompted this test zeroed each of the five terms in turn
    // and the whole suite stayed green — nothing verified that the published
    // weight vector was applied at all. Rank assertions were not enough,
    // because centrality dominates rank on a real graph. This asserts the
    // arithmetic, so removing or reweighting any term fails here.
    const a = comp('a', ['src/a.ts']);
    const b = comp('b', ['src/b.ts']);
    const c = comp('c', ['src/c.ts']);
    const llm = comp('openai', ['src/llm.ts'], { type: 'llm' });
    const components = [a, b, c, llm];
    // a and b in community 0, c in community 1 → a's edge to c crosses.
    const metrics = metricsFor(components, (x) => (x === c ? 1 : 0), (x) => (x === a ? 1 : 0.1));
    const connections = [
      conn(a, b),
      conn(a, c),
      conn(a, llm, 'service-call'),
    ];
    const result = scoreEscalation({
      components,
      connections,
      metrics,
      violations: [{ rule_id: 'layer-violation', severity: 'error', component: 'a', message: '' }],
      fileMap: {},
    });

    const scored = result.ranked.find((r) => r.name === 'a')!;
    // a: highest pagerank of 3 mappable → percentile 1.
    expect(scored.signals.centrality).toBe(1);
    // a has 2 internal edges (b, c); 1 of them crosses communities.
    expect(scored.raw.total_edges).toBe(2);
    expect(scored.raw.cross_community_edges).toBe(1);
    expect(scored.signals.bridge).toBeCloseTo(0.5, 10);
    // 1 structural violation, saturating at 3.
    expect(scored.signals.violations).toBeCloseTo(1 / 3, 10);
    // 1 service-call edge to an llm-typed component, saturating at 3.
    expect(scored.signals.llm_density).toBeCloseTo(1 / 3, 10);

    const w = ESCALATION_WEIGHTS;
    const expected =
      scored.signals.centrality * w.centrality +
      scored.signals.bridge * w.bridge +
      scored.signals.violations * w.violations +
      scored.signals.llm_density * w.llm_density;
    expect(scored.score).toBeCloseTo(expected, 10);
    // And the weights must still sum to 1, or the score stops being a 0..1 value.
    expect(w.centrality + w.bridge + w.violations + w.llm_density).toBeCloseTo(1, 10);
    // Every published weight must be able to fire. Summing to 1 does not catch a
    // zeroed term once the rest are renormalised, and the arithmetic assertion
    // above passes trivially when both sides are zero — so state it directly.
    // A signal not worth weighting should be deleted, as `size` was, not left in
    // the published table at zero where it reads as a contribution.
    for (const [key, weight] of Object.entries(w)) {
      expect(weight, `weight '${key}' is published but cannot contribute`).toBeGreaterThan(0);
    }
  });

  it('withholds a rule that fires on most components, and still discloses it', () => {
    // The measured failure: `transitively-dead` fired on 425 of 451 components
    // while carrying 0.30 of the weight vector. A flag present on nearly the
    // whole population cannot rank that population, so it must not feed the
    // score — but hiding it would trade one silent problem for another, so the
    // histogram still reports it and the manifest names the exclusion.
    const components = Array.from({ length: 24 }, (_, i) => comp(`n${i}`, [`src/n${i}.ts`]));
    const metrics = metricsFor(components, () => 0, () => 0.1);

    const violations: RuleViolation[] = [
      // Fires on 20 of 24 (83%) — degenerate.
      ...components.slice(0, 20).map((c) => ({
        rule_id: 'transitively-dead',
        severity: 'warning' as const,
        component: c.name,
        message: '',
      })),
      // Fires on 1 of 24 — discriminating.
      { rule_id: 'layer-violation', severity: 'error' as const, component: 'n23', message: '' },
    ];

    const result = scoreEscalation({ components, connections: [], metrics, violations, fileMap: {} });

    expect(result.degenerate_rules_excluded).toEqual(['transitively-dead']);
    expect(result.rule_degeneracy.degenerate[0]!.share_of_components).toBeCloseTo(20 / 24, 6);
    // Disclosed, not erased.
    expect(result.violation_rule_histogram['transitively-dead']).toBe(20);

    // A component the degenerate rule alone flagged scores no violation signal.
    const flooded = result.ranked.find((r) => r.name === 'n0')!;
    expect(flooded.signals.violations).toBe(0);
    expect(flooded.raw.structural_violations).toEqual([]);

    // The rule that still discriminates keeps its contribution.
    const real = result.ranked.find((r) => r.name === 'n23')!;
    expect(real.raw.structural_violations).toEqual(['layer-violation']);
    expect(real.signals.violations).toBeGreaterThan(0);
  });

  it('keeps feeding a rule that fires on a minority of components', () => {
    // The post-fix measurement: 89 of 451 is a finding, not a misconfiguration,
    // so the gate must not swallow it.
    const components = Array.from({ length: 24 }, (_, i) => comp(`n${i}`, [`src/n${i}.ts`]));
    const metrics = metricsFor(components, () => 0, () => 0.1);
    const violations: RuleViolation[] = components.slice(0, 5).map((c) => ({
      rule_id: 'transitively-dead',
      severity: 'warning' as const,
      component: c.name,
      message: '',
    }));

    const result = scoreEscalation({ components, connections: [], metrics, violations, fileMap: {} });

    expect(result.degenerate_rules_excluded).toEqual([]);
    expect(result.ranked.find((r) => r.name === 'n0')!.signals.violations).toBeGreaterThan(0);
  });

  it('keeps the bridge ratio independent of external package edges', () => {
    // The denominator must count internal edges only. Counting `uses-package`
    // links to npm would suppress the ratio for any component with many
    // external dependencies, making a signal that claims to be
    // degree-independent sensitive to external fan-out.
    const plain = comp('plain', ['src/plain.ts']);
    const heavy = comp('heavy', ['src/heavy.ts']);
    const far1 = comp('far1', ['src/far1.ts']);
    const far2 = comp('far2', ['src/far2.ts']);
    const pkgs = Array.from({ length: 20 }, (_, i) =>
      comp(`pkg${i}`, ['package.json'], { type: 'npm' })
    );
    const components = [plain, heavy, far1, far2, ...pkgs];
    const metrics = metricsFor(
      components,
      (x) => (x === far1 || x === far2 ? 1 : 0),
      () => 0.1
    );
    const connections = [
      conn(plain, far1),
      conn(plain, far2),
      conn(heavy, far1),
      conn(heavy, far2),
      ...pkgs.map((p) => conn(heavy, p, 'uses-package')),
    ];
    const result = scoreEscalation({ components, connections, metrics, violations: [], fileMap: {} });
    const p = result.ranked.find((r) => r.name === 'plain')!;
    const h = result.ranked.find((r) => r.name === 'heavy')!;
    expect(p.signals.bridge).toBe(1);
    expect(h.signals.bridge).toBe(1);
    expect(h.raw.total_edges).toBe(2);
  });

  it('states the numbers behind every reason it gives', () => {
    const target = comp('svc', ['src/svc.ts']);
    const components = [target, comp('other', ['src/other.ts'])];
    const metrics = metricsFor(components, () => 0, () => 0.5);
    const result = scoreEscalation({
      components,
      connections: [],
      metrics,
      violations: [{ rule_id: 'layer-violation', severity: 'error', component: 'svc', message: '' }],
      fileMap: { 'src/svc.ts': target.component_id },
    });
    const scored = result.ranked.find((r) => r.name === 'svc')!;
    expect(scored.reasons.some((r) => /layer-violation/.test(r))).toBe(true);
    expect(scored.raw.file_count).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// store.ts path guards
// ---------------------------------------------------------------------------

describe('deep-map run store guards', () => {
  it('rejects a sibling directory whose name merely starts with the root', () => {
    // `resolved.startsWith(root)` accepts this; the separator check is what
    // closes it, and `path.resolve(root, '../base-other')` is how it arrives.
    expect(isContained('/tmp/base', '/tmp/base/child')).toBe(true);
    expect(isContained('/tmp/base', '/tmp/base')).toBe(true);
    expect(isContained('/tmp/base', '/tmp/base-other/child')).toBe(false);
    expect(isContained('/tmp/base', path.resolve('/tmp/base', '../base-other'))).toBe(false);
  });

  it('accepts only its own run-id format', () => {
    const id = generateRunId(new Date('2026-08-05T12:00:00.000Z'));
    expect(isValidRunId(id)).toBe(true);
    expect(id.startsWith('DM_20260805T120000Z_')).toBe(true);
    expect(isValidRunId('../../etc/passwd')).toBe(false);
    expect(isValidRunId('DM_bogus')).toBe(false);
  });

  it('accepts only its own packet-id format', () => {
    expect(isValidPacketId(makePacketId(1, 7))).toBe(true);
    expect(makePacketId(1, 7)).toBe('DMP_t1_007');
    expect(isValidPacketId('../evil')).toBe(false);
    expect(isValidPacketId('DMP_t9_001')).toBe(false);
  });

  it('refuses to build a result path from a packet id that is not one', () => {
    const runId = generateRunId();
    expect(resultPathFor(runId, '../../etc/passwd')).toBeNull();
    expect(resultPathFor(runId, makePacketId(2, 1))).toContain('DMP_t2_001.result.json');
  });
});

// ---------------------------------------------------------------------------
// `sanitizePath` shares the containment primitive.
//
// It had its own `resolved.startsWith(basePath)` check, which accepts
// `/tmp/base-other` for a base of `/tmp/base`. It has no callers today, so this
// was a latent trap rather than a live hole — but a wrong guard sitting in a
// config module is worse than no guard, because the next caller will reach for
// it. Both now route through `isContainedPath`.
// ---------------------------------------------------------------------------

describe('sanitizePath containment', () => {
  it('refuses a sibling directory whose name starts with the base', () => {
    expect(sanitizePath('../base-other/secret', '/tmp/base')).toBeNull();
    expect(sanitizePath('../../etc/passwd', '/tmp/base')).toBeNull();
  });

  it('still resolves a legitimate path beneath the base', () => {
    expect(sanitizePath('child/file.json', '/tmp/base')).toBe(path.resolve('/tmp/base/child/file.json'));
    expect(sanitizePath('.', '/tmp/base')).toBe(path.resolve('/tmp/base'));
  });
});
