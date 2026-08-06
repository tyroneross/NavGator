/**
 * `navgator deep-map` CLI + report-builder tests.
 *
 * Follows the registration-check style of `cli-commands.test.ts`: build a
 * fresh `Command`, call the register function, assert no throw and no name
 * collision with the other command registrars.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { Command } from 'commander';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { isValidRunId } from '../deep-map/store.js';
import { ATTRIBUTION_NOTE, DEEP_MAP_SCHEMA_VERSION } from '../deep-map/types.js';
import type { DeepMapIngestReport, DeepMapManifest } from '../deep-map/types.js';

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

describe('deep-map command registration', () => {
  it('registerDeepMapCommand attaches without throwing and registers exactly four subcommands', async () => {
    const { registerDeepMapCommand } = await import('../cli/commands/deep-map.js');
    const program = new Command();

    expect(() => registerDeepMapCommand(program)).not.toThrow();

    const deepMap = program.commands.find((c) => c.name() === 'deep-map');
    expect(deepMap).toBeDefined();

    const subNames = (deepMap?.commands ?? []).map((c) => c.name()).sort();
    expect(subNames).toEqual(['ingest', 'plan', 'report', 'status']);
  });

  it('coexists with the other command registrars without a name collision', async () => {
    const [
      { registerDeepMapCommand },
      { registerScanCommand },
      { registerStatusCommand },
      { registerPortfolioCommand },
      { registerDoctorCommand },
      { registerArchDiffCommand },
    ] = await Promise.all([
      import('../cli/commands/deep-map.js'),
      import('../cli/commands/scan.js'),
      import('../cli/commands/status.js'),
      import('../cli/commands/portfolio.js'),
      import('../cli/commands/doctor.js'),
      import('../cli/commands/arch-diff.js'),
    ]);

    const program = new Command();
    expect(() => {
      registerScanCommand(program);
      registerStatusCommand(program);
      registerPortfolioCommand(program);
      registerDoctorCommand(program);
      registerArchDiffCommand(program);
      registerDeepMapCommand(program);
    }).not.toThrow();

    const names = program.commands.map((c) => c.name());
    const uniqueNames = new Set(names);
    expect(uniqueNames.size).toBe(names.length);
    expect(names).toContain('deep-map');
  });
});

// ---------------------------------------------------------------------------
// buildReport
// ---------------------------------------------------------------------------

describe('buildReport', () => {
  it('returns null for an unknown run id', async () => {
    const { buildReport } = await import('../deep-map/report.js');
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-deep-map-'));
    try {
      const result = buildReport('DM_20260101T000000Z_deadbeef', undefined, tmpRoot);
      expect(result).toBeNull();
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  describe('against a hand-written fixture run', () => {
    let tmpRoot: string;
    const runId = 'DM_20260102T030405Z_cafebabe';

    function writeFixture(): void {
      tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-deep-map-'));
      const runDir = path.join(tmpRoot, '.navgator', 'deep-map', 'runs', runId);
      fs.mkdirSync(runDir, { recursive: true });

      const manifest: DeepMapManifest = {
        schema_version: DEEP_MAP_SCHEMA_VERSION,
        run_id: runId,
        created_at: 1700000000000,
        project_path: tmpRoot,
        tiers_planned: [1],
        graph: {
          components: 10,
          internal_components: 8,
          connections: 12,
          communities: 2,
          metrics_suppressed: false,
        },
        partition: {
          unit: 'community',
          groups: 2,
          min_group: 3,
          max_nodes_per_packet: 60,
          residual_components: 0,
          reason: 'Louvain communities from metrics.json (fixed seed, reproducible)',
        },
        escalation: null,
        caps: { max_packets: 12, max_deep: 4, truncated: false },
        packets: [
          {
            packet_id: 'DMP_t1_001',
            tier: 1,
            group_label: 'community-0',
            components: 4,
            edges: 3,
            estimated_input_tokens: 500,
          },
        ],
        cost: { packets: 1, estimated_input_tokens: 500 },
        provenance: { project_path: tmpRoot, origin: 'local', untrusted: false },
      };
      fs.writeFileSync(path.join(runDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

      const ingest: DeepMapIngestReport = {
        schema_version: DEEP_MAP_SCHEMA_VERSION,
        run_id: runId,
        ingested_at: 1700000001000,
        packets_seen: 1,
        packets_with_results: 1,
        accepted: 2,
        rejected: 1,
        rejections: [{ packet_id: 'DMP_t1_001', reason: 'schema_violation', detail: 'bad shape' }],
        output_bytes: 1234,
      };
      fs.writeFileSync(path.join(runDir, 'ingest.json'), JSON.stringify(ingest, null, 2));

      const findings = [
        {
          finding_id: 'FIND_1',
          run_id: runId,
          packet_id: 'DMP_t1_001',
          tier: 1,
          component_id: 'COMP_component_a_1234',
          component_name: 'a',
          kind: 'purpose',
          text: 'Handles auth session refresh.',
          evidence: ['src/a.ts:10'],
          confidence: 0.8,
          source: 'llm',
          ingested_at: 1700000001000,
        },
        {
          finding_id: 'FIND_2',
          run_id: runId,
          packet_id: 'DMP_t1_001',
          tier: 1,
          component_id: 'COMP_cross_x_5678',
          component_name: 'cross-cutting',
          kind: 'cross-cutting',
          text: 'Two components duplicate retry logic.',
          evidence: ['src/a.ts:10', 'src/b.ts:20'],
          confidence: 0.6,
          source: 'llm',
          ingested_at: 1700000001000,
        },
      ];
      fs.writeFileSync(
        path.join(runDir, 'findings.jsonl'),
        findings.map((f) => JSON.stringify(f)).join('\n') + '\n'
      );
    }

    afterEach(() => {
      if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true });
    });

    it('joins manifest + ingest + findings into a report carrying the attribution note and matching cost numbers', async () => {
      writeFixture();
      const { buildReport } = await import('../deep-map/report.js');
      const report = buildReport(runId, undefined, tmpRoot);

      expect(report).not.toBeNull();
      expect(report!.note).toContain(ATTRIBUTION_NOTE);
      expect(report!.run_id).toBe(runId);
      expect(report!.cost).toEqual({
        packets_planned: 1,
        packets_returned: 1,
        estimated_input_tokens: 500,
        measured_output_bytes: 1234,
        findings_accepted: 2,
        findings_rejected: 1,
      });
      expect(report!.findings_by_component).toHaveLength(1);
      expect(report!.findings_by_component[0]!.component_id).toBe('COMP_component_a_1234');
      expect(report!.findings_by_component[0]!.findings).toHaveLength(1);
      expect(report!.cross_cutting).toHaveLength(1);
      expect(report!.cross_cutting[0]!.kind).toBe('cross-cutting');
      expect(report!.rejections).toHaveLength(1);
    });
  });
});

// ---------------------------------------------------------------------------
// --run validation mapping (USAGE vs NOT_FOUND)
// ---------------------------------------------------------------------------

describe('--run validation mapping', () => {
  it('a well-formed but unknown run id passes format validation but resolves to no manifest (NOT_FOUND path)', async () => {
    expect(isValidRunId('DM_20260101T000000Z_deadbeef')).toBe(true);

    const { buildReport } = await import('../deep-map/report.js');
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-deep-map-'));
    try {
      // Well-formed id, but no manifest was ever written for it — this is the
      // exact condition deep-map.ts's `runReport`/`runStatus`/`runIngest` map
      // to EXIT_CODES.NOT_FOUND.
      expect(buildReport('DM_20260101T000000Z_deadbeef', undefined, tmpRoot)).toBeNull();
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it('a malformed run id fails format validation (the USAGE path)', () => {
    expect(isValidRunId('not-a-run-id')).toBe(false);
    expect(isValidRunId('DM_bad_format')).toBe(false);
    expect(isValidRunId('')).toBe(false);
  });
});
