/**
 * deep-map ingest — `src/deep-map/ingest.ts`.
 *
 * The load-bearing test in this file is the hallucination probe: a result
 * naming a `component_id` tier 0 never produced must be rejected, contribute
 * zero findings, and be counted. Every other test guards one clause of the
 * validation contract the module documents (evidence grounding, size caps,
 * sanitization, determinism).
 *
 * Also carries the security-review regression tests for SEC-004, SEC-002,
 * SEC-003, SEC-008, and SEC-007 (2026-08-05 review) — grouped here per the
 * fix plan rather than split across per-module test files, since the shared
 * `projectRoot` + `config` fixtures below already cover ingest, store, load,
 * and filter.
 *
 * Uses `projectRoot` + `storageMode: 'local'` rather than `$HOME`, so results
 * live entirely under a per-test `mkdtemp` directory independent of the
 * suite-wide home redirect in `__tests__/setup/home-redirect.ts`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { ingestRun, validateResultPayload } from '../deep-map/ingest.js';
import { generateRunId, getRunPath, resultPathFor, writePacket } from '../deep-map/store.js';
import { readFindings } from '../deep-map/store.js';
import { resolveProvenance } from '../deep-map/load.js';
import { globToRegExp } from '../deep-map/filter.js';
import { DEEP_MAP_LIMITS, DEEP_MAP_SCHEMA_VERSION, type DeepMapPacket, type DeepMapTier } from '../deep-map/types.js';
import type { NavGatorConfig } from '../types.js';

// SEC-002 regression: `resolveProvenance` must fail CLOSED (untrusted: true)
// when the project registry cannot be read, not fail open to `local`. Mocked
// at module scope (vitest hoists `vi.mock`) because only this one test needs
// the registry read to throw; every other test in this file never touches
// `../projects.js`.
vi.mock('../projects.js', () => ({
  listProjects: vi.fn(async () => {
    throw new Error('registry unreadable (mocked for SEC-002 regression test)');
  }),
}));

let projectRoot: string;
let config: NavGatorConfig;

beforeEach(() => {
  projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-deepmap-ingest-'));
  config = {
    storageMode: 'local',
    storagePath: '.navgator/architecture',
    autoScan: false,
    healthCheckEnabled: false,
    scanDepth: 'shallow',
    defaultConfidenceThreshold: 0.6,
    maxResultsPerQuery: 20,
  };
});

afterEach(() => {
  fs.rmSync(projectRoot, { recursive: true, force: true });
});

const knownComponentIds = new Map<string, string>([
  ['COMP_alpha', 'Alpha Service'],
  ['COMP_beta', 'Beta Widget'],
]);
const knownFilePaths = new Set<string>(['src/alpha.ts', 'src/beta.ts']);

function makePacket(opts: {
  packet_id: string;
  run_id: string;
  tier: DeepMapTier;
  component_ids: string[];
}): DeepMapPacket {
  return {
    schema_version: DEEP_MAP_SCHEMA_VERSION,
    packet_id: opts.packet_id,
    run_id: opts.run_id,
    tier: opts.tier,
    group_label: 'test-group',
    component_ids: opts.component_ids,
    components: opts.component_ids.map((id) => ({
      component_id: id,
      name: knownComponentIds.get(id) ?? id,
      type: 'component',
      layer: 'backend',
      files: [`src/${id.toLowerCase()}.ts`],
    })),
    edges: [],
    prompt: 'test prompt',
    response_schema: {},
    estimated_input_tokens: 10,
    provenance: { project_path: projectRoot, origin: 'local', untrusted: false },
  };
}

function writeResultRaw(runId: string, packetId: string, contents: string): void {
  const target = resultPathFor(runId, packetId, config, projectRoot);
  if (!target) throw new Error(`could not resolve result path for ${packetId}`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
}

function writeResult(runId: string, packetId: string, payload: unknown): void {
  writeResultRaw(runId, packetId, JSON.stringify(payload));
}

function validFinding(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    component_id: 'COMP_alpha',
    kind: 'purpose',
    text: 'Handles alpha responsibilities.',
    evidence: ['src/alpha.ts'],
    confidence: 0.8,
    ...overrides,
  };
}

describe('deep-map ingest', () => {
  // -------------------------------------------------------------------------
  // 1. Hallucination probe — the load-bearing test.
  // -------------------------------------------------------------------------
  it('rejects a hallucinated component_id, contributes zero findings, and counts it', () => {
    // Tier 3 deliberately: it skips the packet-scope check, so this isolates
    // the global `knownComponentIds` join — the one guard that can catch a
    // fully invented component_id when no packet-scope check applies.
    const runId = generateRunId();
    const packet = makePacket({ packet_id: 'DMP_t3_000', run_id: runId, tier: 3, component_ids: ['COMP_alpha'] });
    writePacket(packet, config, projectRoot);
    writeResult(runId, packet.packet_id, {
      findings: [validFinding({ component_id: 'COMP_component_totally_fake_9999' })],
    });

    const { report, findings } = ingestRun({
      runId,
      knownComponentIds,
      knownFilePaths,
      config,
      projectRoot,
      persist: false,
    });

    expect(findings).toHaveLength(0);
    expect(report.accepted).toBe(0);
    expect(report.rejected).toBe(1);
    expect(report.rejections).toHaveLength(1);
    expect(report.rejections[0]?.reason).toBe('unknown_component');
    expect(report.rejections[0]?.packet_id).toBe(packet.packet_id);
  });

  // -------------------------------------------------------------------------
  // 2. Real component, wrong packet's scope (tier 1).
  // -------------------------------------------------------------------------
  it('rejects a real component outside the packet scope at tier 1', () => {
    const result = validateResultPayload(
      { findings: [validFinding({ component_id: 'COMP_beta' })] },
      { packet_id: 'DMP_t1_000', tier: 1, run_id: 'DM_run', component_ids: ['COMP_alpha'] },
      { knownComponentIds, knownFilePaths }
    );

    expect(result.findings).toHaveLength(0);
    expect(result.rejections).toHaveLength(1);
    expect(result.rejections[0]?.reason).toBe('unknown_component');
    expect(result.rejections[0]?.detail).toMatch(/outside packet/);
  });

  // -------------------------------------------------------------------------
  // 3. Tier 3 may reference any known component.
  // -------------------------------------------------------------------------
  it('allows a tier-3 finding to reference a known component outside its own scope', () => {
    const result = validateResultPayload(
      { findings: [validFinding({ component_id: 'COMP_beta', evidence: ['src/beta.ts'] })] },
      { packet_id: 'DMP_t3_000', tier: 3, run_id: 'DM_run', component_ids: ['COMP_alpha'] },
      { knownComponentIds, knownFilePaths }
    );

    expect(result.rejections).toHaveLength(0);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.component_id).toBe('COMP_beta');
  });

  // -------------------------------------------------------------------------
  // 4. Evidence grounded in nothing real.
  // -------------------------------------------------------------------------
  it('rejects evidence that references no real file path', () => {
    const result = validateResultPayload(
      { findings: [validFinding({ evidence: ['totally/made/up/path.ts'] })] },
      { packet_id: 'DMP_t1_000', tier: 1, run_id: 'DM_run', component_ids: ['COMP_alpha'] },
      { knownComponentIds, knownFilePaths }
    );

    expect(result.findings).toHaveLength(0);
    expect(result.rejections[0]?.reason).toBe('missing_evidence');
  });

  // -------------------------------------------------------------------------
  // 5. Evidence in `path:symbol` form is accepted.
  // -------------------------------------------------------------------------
  it('accepts evidence in path:symbolName form when the path is known', () => {
    const result = validateResultPayload(
      { findings: [validFinding({ evidence: ['src/alpha.ts:doThing'] })] },
      { packet_id: 'DMP_t1_000', tier: 1, run_id: 'DM_run', component_ids: ['COMP_alpha'] },
      { knownComponentIds, knownFilePaths }
    );

    expect(result.rejections).toHaveLength(0);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.evidence).toEqual(['src/alpha.ts:doThing']);
  });

  // -------------------------------------------------------------------------
  // 6. Oversized result file — rejected and never parsed.
  // -------------------------------------------------------------------------
  it('rejects an oversized result file without parsing it', () => {
    const runId = generateRunId();
    const packet = makePacket({ packet_id: 'DMP_t1_000', run_id: runId, tier: 1, component_ids: ['COMP_alpha'] });
    writePacket(packet, config, projectRoot);
    // Deliberately invalid JSON: if the module parsed this it would fail with
    // malformed_json instead, so a passing test proves the size check runs
    // BEFORE any parse attempt.
    const oversized = '{"findings": [' + 'x'.repeat(DEEP_MAP_LIMITS.resultBytes + 1024) + ']';
    writeResultRaw(runId, packet.packet_id, oversized);

    const { report, findings } = ingestRun({
      runId,
      knownComponentIds,
      knownFilePaths,
      config,
      projectRoot,
      persist: false,
    });

    expect(findings).toHaveLength(0);
    expect(report.rejections[0]?.reason).toBe('oversized_result');
    expect(report.output_bytes).toBeGreaterThan(DEEP_MAP_LIMITS.resultBytes);
  });

  // -------------------------------------------------------------------------
  // 7. Malformed JSON.
  // -------------------------------------------------------------------------
  it('rejects malformed JSON', () => {
    const runId = generateRunId();
    const packet = makePacket({ packet_id: 'DMP_t1_000', run_id: runId, tier: 1, component_ids: ['COMP_alpha'] });
    writePacket(packet, config, projectRoot);
    writeResultRaw(runId, packet.packet_id, '{not valid json');

    const { report, findings } = ingestRun({
      runId,
      knownComponentIds,
      knownFilePaths,
      config,
      projectRoot,
      persist: false,
    });

    expect(findings).toHaveLength(0);
    expect(report.rejections[0]?.reason).toBe('malformed_json');
  });

  // -------------------------------------------------------------------------
  // 8. Over the findings-per-packet cap.
  // -------------------------------------------------------------------------
  it('caps findings at the per-packet limit and records one rejection', () => {
    const overCount = DEEP_MAP_LIMITS.findingsPerPacket + 5;
    const payload = {
      findings: Array.from({ length: overCount }, () => validFinding()),
    };

    const result = validateResultPayload(
      payload,
      { packet_id: 'DMP_t1_000', tier: 1, run_id: 'DM_run', component_ids: ['COMP_alpha'] },
      { knownComponentIds, knownFilePaths }
    );

    expect(result.findings).toHaveLength(DEEP_MAP_LIMITS.findingsPerPacket);
    const tooMany = result.rejections.filter((r) => r.reason === 'too_many_findings');
    expect(tooMany).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // 9. Control characters stripped from stored text.
  // -------------------------------------------------------------------------
  it('strips control characters from stored text', () => {
    const dirty = 'Handles alpha\x07 responsibilities\x1B.';
    const result = validateResultPayload(
      { findings: [validFinding({ text: dirty })] },
      { packet_id: 'DMP_t1_000', tier: 1, run_id: 'DM_run', component_ids: ['COMP_alpha'] },
      { knownComponentIds, knownFilePaths }
    );

    expect(result.rejections).toHaveLength(0);
    expect(result.findings[0]?.text).toBe('Handles alpha responsibilities.');
    expect(result.findings[0]?.text).not.toMatch(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/);
  });

  // -------------------------------------------------------------------------
  // 10. Text over the length cap is truncated, not rejected.
  // -------------------------------------------------------------------------
  it('truncates text over the length cap instead of rejecting it', () => {
    const longText = 'a'.repeat(DEEP_MAP_LIMITS.textLength + 500);
    const result = validateResultPayload(
      { findings: [validFinding({ text: longText })] },
      { packet_id: 'DMP_t1_000', tier: 1, run_id: 'DM_run', component_ids: ['COMP_alpha'] },
      { knownComponentIds, knownFilePaths }
    );

    expect(result.rejections).toHaveLength(0);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.text).toHaveLength(DEEP_MAP_LIMITS.textLength);
  });

  // -------------------------------------------------------------------------
  // 11. Determinism: same fixtures twice -> identical finding_ids.
  // -------------------------------------------------------------------------
  it('produces identical finding_ids across repeat ingests of the same fixtures', () => {
    const runId = generateRunId();
    const packet = makePacket({ packet_id: 'DMP_t1_000', run_id: runId, tier: 1, component_ids: ['COMP_alpha'] });
    writePacket(packet, config, projectRoot);
    writeResult(runId, packet.packet_id, {
      findings: [validFinding(), validFinding({ text: 'A second, distinct finding.' })],
    });

    const first = ingestRun({ runId, knownComponentIds, knownFilePaths, config, projectRoot, persist: false });
    const second = ingestRun({ runId, knownComponentIds, knownFilePaths, config, projectRoot, persist: false });

    expect(first.findings.map((f) => f.finding_id)).toEqual(second.findings.map((f) => f.finding_id));
    expect(first.findings.map((f) => f.finding_id)).toEqual(['DMP_t1_000_0', 'DMP_t1_000_1']);
  });

  // -------------------------------------------------------------------------
  // Extra: an unknown packet id result file is rejected and not confused
  // with a legitimate result (guards the directory-walk path, not just the
  // dispatched-packet list).
  // -------------------------------------------------------------------------
  it('rejects a result file whose packet id was never dispatched', () => {
    const runId = generateRunId();
    const packet = makePacket({ packet_id: 'DMP_t1_000', run_id: runId, tier: 1, component_ids: ['COMP_alpha'] });
    writePacket(packet, config, projectRoot);
    // No packet DMP_t1_099 was ever dispatched.
    writeResultRaw(runId, 'DMP_t1_099', JSON.stringify({ findings: [] }));

    const { report } = ingestRun({ runId, knownComponentIds, knownFilePaths, config, projectRoot, persist: false });

    const unknown = report.rejections.filter((r) => r.reason === 'unknown_packet');
    expect(unknown).toHaveLength(1);
    expect(unknown[0]?.packet_id).toBe('DMP_t1_099');
  });
});

// =============================================================================
// Security review regressions (2026-08-05)
// =============================================================================

describe('SEC-004 — evidence grounding rejects open-ended prefix matches', () => {
  it('accepts an exact known-path match and a path:symbol match', () => {
    const exact = validateResultPayload(
      { findings: [validFinding({ evidence: ['src/alpha.ts'] })] },
      { packet_id: 'DMP_t1_000', tier: 1, run_id: 'DM_run', component_ids: ['COMP_alpha'] },
      { knownComponentIds, knownFilePaths }
    );
    expect(exact.rejections).toHaveLength(0);
    expect(exact.findings).toHaveLength(1);

    const withSymbol = validateResultPayload(
      { findings: [validFinding({ evidence: ['src/alpha.ts:handler'] })] },
      { packet_id: 'DMP_t1_000', tier: 1, run_id: 'DM_run', component_ids: ['COMP_alpha'] },
      { knownComponentIds, knownFilePaths }
    );
    expect(withSymbol.rejections).toHaveLength(0);
    expect(withSymbol.findings).toHaveLength(1);
  });

  it('rejects a known path used as a bare string prefix for fabricated text', () => {
    // Before the fix, `evidence.startsWith(knownPath)` accepted this: any
    // known file path being a literal prefix of the evidence string grounded
    // arbitrary trailing text, letting a short root file (or `src/alpha.ts`
    // here) launder a fabricated claim as "grounded".
    const result = validateResultPayload(
      { findings: [validFinding({ evidence: ['src/alpha.ts and also nonsense'] })] },
      { packet_id: 'DMP_t1_000', tier: 1, run_id: 'DM_run', component_ids: ['COMP_alpha'] },
      { knownComponentIds, knownFilePaths }
    );
    expect(result.findings).toHaveLength(0);
    expect(result.rejections).toHaveLength(1);
    expect(result.rejections[0]?.reason).toBe('missing_evidence');
  });
});

describe('SEC-002 — resolveProvenance fails closed on a registry read error', () => {
  it('returns origin: unknown, untrusted: true when listProjects throws', async () => {
    const provenance = await resolveProvenance(projectRoot);
    expect(provenance.origin).toBe('unknown');
    expect(provenance.untrusted).toBe(true);
  });
});

describe('SEC-003 — readFindings validates shape before trusting a stored line', () => {
  it('drops a line missing `kind` and a line whose `evidence` is a string, keeping the one valid line', () => {
    const runId = generateRunId();
    const runDir = getRunPath(runId, config, projectRoot);
    fs.mkdirSync(runDir, { recursive: true });

    const goodFinding = {
      finding_id: 'DMP_t1_000_0',
      run_id: runId,
      packet_id: 'DMP_t1_000',
      tier: 1,
      component_id: 'COMP_alpha',
      component_name: 'Alpha Service',
      kind: 'purpose',
      text: 'Handles alpha responsibilities.',
      evidence: ['src/alpha.ts'],
      confidence: 0.8,
      source: 'llm',
      ingested_at: 1700000000000,
    };
    const missingKind = { ...goodFinding, finding_id: 'DMP_t1_000_1' } as Record<string, unknown>;
    delete missingKind['kind'];
    const stringEvidence = {
      ...goodFinding,
      finding_id: 'DMP_t1_000_2',
      evidence: 'src/alpha.ts', // string, not an array — malformed
    };

    const lines = [JSON.stringify(goodFinding), JSON.stringify(missingKind), JSON.stringify(stringEvidence)];
    fs.writeFileSync(path.join(runDir, 'findings.jsonl'), lines.join('\n') + '\n');

    const findings = readFindings(runId, config, projectRoot);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.finding_id).toBe('DMP_t1_000_0');
  });
});

describe('SEC-008 — ingest refuses a symlinked result file', () => {
  it('rejects a symlinked *.result.json with path_escape instead of parsing it', () => {
    const runId = generateRunId();
    const packet = makePacket({ packet_id: 'DMP_t1_000', run_id: runId, tier: 1, component_ids: ['COMP_alpha'] });
    writePacket(packet, config, projectRoot);

    const resultPath = resultPathFor(runId, packet.packet_id, config, projectRoot);
    if (!resultPath) throw new Error('could not resolve result path');
    fs.mkdirSync(path.dirname(resultPath), { recursive: true });

    // Target lives entirely outside the run's packets directory, but even a
    // symlink pointing INSIDE it must be rejected — the fix rejects on
    // symlink-ness, not on where the link points.
    const outsideTarget = path.join(projectRoot, 'outside-result.json');
    fs.writeFileSync(outsideTarget, JSON.stringify({ findings: [validFinding()] }));
    fs.symlinkSync(outsideTarget, resultPath);

    const { report, findings } = ingestRun({
      runId,
      knownComponentIds,
      knownFilePaths,
      config,
      projectRoot,
      persist: false,
    });

    expect(findings).toHaveLength(0);
    const escapeRejections = report.rejections.filter((r) => r.reason === 'path_escape');
    expect(escapeRejections).toHaveLength(1);
    expect(escapeRejections[0]?.packet_id).toBe(packet.packet_id);
  });
});

describe('SEC-007 — glob complexity cap', () => {
  it('throws on a pattern with more than 4 `**` segments', () => {
    const evilPattern = Array.from({ length: 6 }, (_, i) => `seg${i}`).join('/**/');
    expect(() => globToRegExp(evilPattern)).toThrow(/\*\*/);
  });

  it('still compiles and matches a normal exclude pattern', () => {
    const re = globToRegExp('web/runtime/**');
    expect(re.test('web/runtime/packages/semver/index.js')).toBe(true);
    expect(re.test('web/other/index.js')).toBe(false);
  });
});

describe('schema bounds that had no test until an audit mutated them', () => {
  it('rejects a finding whose kind is not one of the six', () => {
    // Mutating this guard to `if (false)` previously left the whole suite
    // green, so the enum was enforced in code and unverified in test.
    const result = validateResultPayload(
      { findings: [validFinding({ kind: 'arbitrary-kind' })] },
      { packet_id: 'DMP_t1_000', tier: 1, run_id: 'DM_run', component_ids: ['COMP_alpha'] },
      { knownComponentIds, knownFilePaths }
    );
    expect(result.findings).toHaveLength(0);
    expect(result.rejections).toHaveLength(1);
    expect(result.rejections[0]?.reason).toBe('schema_violation');
  });

  it('keeps only the first evidencePerFinding entries', () => {
    const tooMany = Array.from(
      { length: DEEP_MAP_LIMITS.evidencePerFinding + 4 },
      () => 'src/alpha.ts'
    );
    const result = validateResultPayload(
      { findings: [validFinding({ evidence: tooMany })] },
      { packet_id: 'DMP_t1_000', tier: 1, run_id: 'DM_run', component_ids: ['COMP_alpha'] },
      { knownComponentIds, knownFilePaths }
    );
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]!.evidence).toHaveLength(DEEP_MAP_LIMITS.evidencePerFinding);
  });
});
