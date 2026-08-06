/**
 * Tests for deep-map packet construction (tiers 1-3).
 *
 * All fixtures are in-memory. Nothing here reads or writes `.navgator/`.
 */

import { describe, it, expect } from 'vitest';
import {
  buildTier1Packets,
  buildTier2Packets,
  buildTier3Packet,
  estimateInputTokens,
  type BuildPacketsInput,
} from '../deep-map/packets.js';
import type {
  DeepMapFinding,
  EscalationResult,
  EscalationScore,
  PartitionGroup,
  PartitionResult,
} from '../deep-map/types.js';
import { ESCALATION_WEIGHTS, DEGREE_DERIVED_RULE_IDS, UNTRUSTED_SOURCE_NOTE } from '../deep-map/types.js';
import { createMockComponent, createMockConnection } from './helpers.js';
import type { ArchitectureComponent, ArchitectureConnection } from '../types.js';

// ---------------------------------------------------------------------------
// Fixture factory — rebuilt fresh on every call so the determinism test
// exercises two genuinely independent object graphs, not one reused input.
// ---------------------------------------------------------------------------

function buildComponents(): ArchitectureComponent[] {
  return [
    createMockComponent({
      component_id: 'comp-a1',
      name: 'A1',
      type: 'service',
      role: { purpose: 'Handles A', layer: 'backend', critical: false },
    }),
    createMockComponent({
      component_id: 'comp-a2',
      name: 'A2',
      type: 'service',
      role: { purpose: 'Helps A1', layer: 'backend', critical: false },
    }),
    createMockComponent({
      component_id: 'comp-a3',
      name: 'A3',
      type: 'service',
      role: { purpose: 'Also helps A1', layer: 'backend', critical: false },
    }),
    createMockComponent({
      component_id: 'comp-b1',
      name: 'B1',
      type: 'service',
      role: { purpose: 'Orphaned singleton', layer: 'backend', critical: false },
    }),
    createMockComponent({
      component_id: 'comp-x',
      name: 'X',
      type: 'npm',
      role: { purpose: 'Unrelated external-ish package', layer: 'external', critical: false },
    }),
  ];
}

function buildConnections(): ArchitectureConnection[] {
  return [
    createMockConnection('comp-a1', 'comp-a2', { connection_id: 'CONN_1' }),
    createMockConnection('comp-a2', 'comp-a3', { connection_id: 'CONN_2' }),
    // Crosses the group A / residual boundary — must never show up in group A's edges.
    createMockConnection('comp-a1', 'comp-b1', { connection_id: 'CONN_3' }),
    // Touches a component outside every group entirely.
    createMockConnection('comp-a3', 'comp-x', { connection_id: 'CONN_4' }),
  ];
}

function buildGroupA(): PartitionGroup {
  return {
    label: 'community-0',
    unit: 'community',
    component_ids: ['comp-a1', 'comp-a2', 'comp-a3'],
    residual: false,
    path_prefix: 'src/a',
    suspect_vendored: 0,
  };
}

function buildResidualGroup(): PartitionGroup {
  return {
    label: 'residual',
    unit: 'community',
    component_ids: ['comp-b1'],
    residual: true,
    path_prefix: 'src/b',
    suspect_vendored: 0,
  };
}

function buildPartition(): PartitionResult {
  return {
    unit: 'community',
    groups: [buildGroupA(), buildResidualGroup()],
    considered: 5,
    residual_components: 1,
    truncated: 0,
    min_group: 3,
    max_nodes_per_packet: 60,
    reason: 'test fixture',
    filter: { excluded_vendor: 0, excluded_glob: 0, suspect_vendored: 0, patterns: [] },
  };
}

function buildEscalationScore(id: string, name: string, score: number): EscalationScore {
  return {
    component_id: id,
    name,
    score,
    signals: { centrality: 0.9, bridge: 0.5, violations: 0.3, llm_density: 0.1, size: 0.8 },
    raw: {
      pagerank: 0.05,
      pagerank_percentile: 0.9,
      cross_community_edges: 2,
      total_edges: 3,
      structural_violations: ['orphan-component'],
      llm_calls: 1,
      file_count: 4,
      file_count_percentile: 0.8,
    },
    reasons: [`centrality 90th percentile (pagerank 0.0500)`, `bridges 2 of 3 edges across communities`],
  };
}

function buildEscalation(): EscalationResult {
  const escalated = [buildEscalationScore('comp-a1', 'A1', 0.72), buildEscalationScore('comp-a2', 'A2', 0.55)];
  return {
    threshold: 0.4,
    weights: ESCALATION_WEIGHTS,
    considered: 5,
    escalated,
    ranked: escalated,
    degree_derived_rules_excluded: DEGREE_DERIVED_RULE_IDS,
    unresolved_violations: 0,
  };
}

function buildFileMap(): Record<string, string> {
  return {
    'src/a/a1.ts': 'comp-a1',
    'src/a/a1-helper.ts': 'comp-a1',
    'src/a/a2.ts': 'comp-a2',
    'src/a/a3.ts': 'comp-a3',
    'src/b/b1.ts': 'comp-b1',
    'src/x/x.ts': 'comp-x',
  };
}

function buildInput(overrides: Partial<BuildPacketsInput> = {}): BuildPacketsInput {
  return {
    runId: 'DM_20260805T000000Z_deadbeef',
    components: buildComponents(),
    connections: buildConnections(),
    partition: buildPartition(),
    escalation: buildEscalation(),
    fileMap: buildFileMap(),
    provenance: { project_path: '/repo', origin: 'local', untrusted: false },
    ...overrides,
  };
}

function buildFindings(): DeepMapFinding[] {
  return [
    {
      finding_id: 'FIND_2',
      run_id: 'DM_20260805T000000Z_deadbeef',
      packet_id: 'DMP_t1_002',
      tier: 1,
      component_id: 'comp-b1',
      component_name: 'B1',
      kind: 'concern',
      text: 'STRAGGLER: probably belongs with A',
      evidence: ['src/b/b1.ts'],
      confidence: 0.6,
      source: 'llm',
      ingested_at: 1001,
    },
    {
      finding_id: 'FIND_1',
      run_id: 'DM_20260805T000000Z_deadbeef',
      packet_id: 'DMP_t1_001',
      tier: 1,
      component_id: 'comp-a1',
      component_name: 'A1',
      kind: 'purpose',
      text: 'Handles A',
      evidence: ['src/a/a1.ts'],
      confidence: 0.8,
      source: 'llm',
      ingested_at: 1000,
    },
  ];
}

// ---------------------------------------------------------------------------

describe('deep-map packets', () => {
  it('1. is deterministic — identical input yields byte-identical packet JSON', () => {
    const tier1a = buildTier1Packets(buildInput());
    const tier1b = buildTier1Packets(buildInput());
    expect(JSON.stringify(tier1a)).toBe(JSON.stringify(tier1b));

    const tier2a = buildTier2Packets(buildInput());
    const tier2b = buildTier2Packets(buildInput());
    expect(JSON.stringify(tier2a)).toBe(JSON.stringify(tier2b));

    const tier3a = buildTier3Packet(buildInput(), buildFindings());
    const tier3b = buildTier3Packet(buildInput(), buildFindings());
    expect(JSON.stringify(tier3a)).toBe(JSON.stringify(tier3b));
  });

  it('2. packet ids are unique within a tier', () => {
    const tier1 = buildTier1Packets(buildInput());
    const tier1Ids = tier1.map((p) => p.packet_id);
    expect(new Set(tier1Ids).size).toBe(tier1Ids.length);
    expect(tier1Ids).toEqual(['DMP_t1_001', 'DMP_t1_002']);

    const tier2 = buildTier2Packets(buildInput());
    const tier2Ids = tier2.map((p) => p.packet_id);
    expect(new Set(tier2Ids).size).toBe(tier2Ids.length);
    expect(tier2Ids).toEqual(['DMP_t2_001', 'DMP_t2_002']);
  });

  it('3. tier-1 edges never reference a component outside the group', () => {
    const packets = buildTier1Packets(buildInput());
    for (const packet of packets) {
      const groupIds = new Set(packet.component_ids);
      for (const edge of packet.edges) {
        expect(groupIds.has(edge.f)).toBe(true);
        expect(groupIds.has(edge.t)).toBe(true);
      }
    }
    // Group A packet specifically must carry its two internal edges and
    // never the boundary-crossing CONN_3 (a1 -> b1) or CONN_4 (a3 -> x).
    const groupA = packets.find((p) => p.group_label === 'community-0')!;
    expect(groupA.edges.map((e) => e.id).sort()).toEqual(['CONN_1', 'CONN_2']);
  });

  it('4. residual group gets a materially different prompt than a normal group', () => {
    const packets = buildTier1Packets(buildInput());
    const groupA = packets.find((p) => p.group_label === 'community-0')!;
    const residual = packets.find((p) => p.group_label === 'residual')!;

    expect(residual.prompt).toContain('did NOT cluster together');
    expect(residual.prompt).toContain('STRAGGLER');
    expect(groupA.prompt).not.toContain('did NOT cluster together');
    expect(groupA.prompt).not.toContain('STRAGGLER');
  });

  it('5. tier 2 returns [] when escalation is null, one packet per escalated component otherwise', () => {
    const noEscalation = buildTier2Packets(buildInput({ escalation: null }));
    expect(noEscalation).toEqual([]);

    const withEscalation = buildTier2Packets(buildInput());
    expect(withEscalation).toHaveLength(2);
    expect(withEscalation.map((p) => p.component_ids)).toEqual([['comp-a1'], ['comp-a2']]);
  });

  it('6. tier 3 returns null on zero findings', () => {
    expect(buildTier3Packet(buildInput(), [])).toBeNull();
    expect(buildTier3Packet(buildInput(), buildFindings())).not.toBeNull();
  });

  it('7. untrusted provenance puts UNTRUSTED_SOURCE_NOTE at the start of the prompt', () => {
    const untrustedInput = buildInput({
      provenance: { project_path: '/repo', origin: 'remote', origin_url: 'https://example.com/x', untrusted: true },
    });

    const tier1 = buildTier1Packets(untrustedInput);
    for (const packet of tier1) {
      expect(packet.prompt.startsWith(UNTRUSTED_SOURCE_NOTE)).toBe(true);
    }

    const tier2 = buildTier2Packets(untrustedInput);
    for (const packet of tier2) {
      expect(packet.prompt.startsWith(UNTRUSTED_SOURCE_NOTE)).toBe(true);
    }

    const tier3 = buildTier3Packet(untrustedInput, buildFindings())!;
    expect(tier3.prompt.startsWith(UNTRUSTED_SOURCE_NOTE)).toBe(true);

    // Sanity check the trusted (default) fixture does NOT carry the note.
    const trusted = buildTier1Packets(buildInput());
    expect(trusted[0]!.prompt.startsWith(UNTRUSTED_SOURCE_NOTE)).toBe(false);
  });

  it('8. estimated_input_tokens matches Math.ceil(prompt.length / 4)', () => {
    const tier1 = buildTier1Packets(buildInput());
    for (const packet of tier1) {
      expect(packet.estimated_input_tokens).toBe(estimateInputTokens(packet.prompt));
      expect(packet.estimated_input_tokens).toBe(Math.ceil(packet.prompt.length / 4));
    }

    const tier2 = buildTier2Packets(buildInput());
    for (const packet of tier2) {
      expect(packet.estimated_input_tokens).toBe(Math.ceil(packet.prompt.length / 4));
    }

    const tier3 = buildTier3Packet(buildInput(), buildFindings())!;
    expect(tier3.estimated_input_tokens).toBe(Math.ceil(tier3.prompt.length / 4));
  });
});

// ---------------------------------------------------------------------------
// Induced-subgraph completeness.
//
// Building tier-1 edges by asking `extractSubgraph` for depth 1 and then
// filtering to group members loses edges: depth 1 pulls in every one-hop
// neighbour OUTSIDE the group, and the `maxNodes` truncation that follows can
// cut genuine group members before the filter ever runs. What a tier-1 packet
// wants is the induced subgraph on the group, which is a direct filter over
// connections and needs no traversal at all.
// ---------------------------------------------------------------------------

describe('tier-1 induced subgraph completeness', () => {
  it('keeps every edge between group members when the group has many outside neighbours', () => {
    const members = Array.from({ length: 4 }, (_, i) =>
      createMockComponent({
        component_id: `mem-${i}`,
        name: `Mem${i}`,
        type: 'service',
        role: { purpose: '', layer: 'backend', critical: false },
      })
    );
    // Each member also talks to several components outside the group, so a
    // depth-1 traversal collects far more nodes than the group holds.
    const outsiders = Array.from({ length: 12 }, (_, i) =>
      createMockComponent({
        component_id: `out-${i}`,
        name: `Out${i}`,
        type: 'service',
        role: { purpose: '', layer: 'backend', critical: false },
      })
    );

    const internalEdges = [
      createMockConnection('mem-0', 'mem-1'),
      createMockConnection('mem-1', 'mem-2'),
      createMockConnection('mem-2', 'mem-3'),
      createMockConnection('mem-3', 'mem-0'),
    ];
    const externalEdges = outsiders.map((o, i) =>
      createMockConnection(`mem-${i % 4}`, o.component_id)
    );

    const group: PartitionGroup = {
      label: 'community-0',
      unit: 'community',
      component_ids: members.map((m) => m.component_id),
      residual: false,
      path_prefix: 'src',
      suspect_vendored: 0,
    };

    const packets = buildTier1Packets({
      runId: 'DM_20260805T120000Z_abcdef01',
      // Outsiders FIRST. `extractSubgraph` filters in component-array order and
      // then slices to `maxNodes`, so ordering decides whether the truncation
      // keeps the group or the neighbours. With members first the bug is
      // invisible; this is the ordering that exposes it.
      components: [...outsiders, ...members],
      connections: [...internalEdges, ...externalEdges],
      partition: {
        unit: 'community',
        groups: [group],
        considered: members.length,
        residual_components: 0,
        truncated: 0,
        min_group: 3,
        max_nodes_per_packet: 60,
        reason: 'test fixture',
        filter: { excluded_vendor: 0, excluded_glob: 0, suspect_vendored: 0, patterns: [] },
      },
      escalation: null,
      fileMap: {},
      provenance: { project_path: '/tmp/p', origin: 'local', untrusted: false },
    });

    expect(packets).toHaveLength(1);
    // All four member-to-member edges must survive.
    expect(packets[0]!.edges).toHaveLength(internalEdges.length);
    // And no edge may reach outside the group.
    const ids = new Set(group.component_ids);
    for (const e of packets[0]!.edges) {
      expect(ids.has(e.f)).toBe(true);
      expect(ids.has(e.t)).toBe(true);
    }
  });
});
