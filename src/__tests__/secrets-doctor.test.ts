import { describe, it, expect } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import {
  buildDoctorReport,
  ALL_SECRET_CLASSES,
  DETECTOR_DEGENERACY_SHARE,
  DETECTOR_DEGENERACY_ABSOLUTE,
  type DoctorInput,
} from '../secrets/doctor.js';
import type { EngineCapability, ScanDiagnostic, SecretClass, SecretFinding } from '../secrets/types.js';

// ---------------------------------------------------------------------------
// Fixture builders. No real credentials anywhere — previews and hashes below
// are obviously-fake placeholder strings, never a working secret shape tied
// to a live provider.
// ---------------------------------------------------------------------------

type Finding = SecretFinding & { foundBy?: string[] };

let fixtureCounter = 0;

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  fixtureCounter += 1;
  return {
    hash: `fakehash${String(fixtureCounter).padStart(4, '0')}`,
    preview: 'FAKE-PREVIEW',
    secretClass: 'aws_key',
    specificity: 'structured',
    engine: 'native',
    engineDetector: 'FakeDetector',
    locations: [{ file: '/repo/src/config.ts', line: 1, corpus: 'repo' }],
    occurrences: 1,
    liveness: 'unverified',
    disposition: 'pending',
    ...overrides,
  };
}

function makeEngine(overrides: Partial<EngineCapability> = {}): EngineCapability {
  return {
    id: 'native',
    available: true,
    classes: ['aws_key', 'github_token'],
    corpora: ['repo', 'other'],
    canVerifyLiveness: false,
    ...overrides,
  };
}

function diagnosticsOfKind(diags: ScanDiagnostic[], kind: ScanDiagnostic['kind']): ScanDiagnostic[] {
  return diags.filter(d => d.kind === kind);
}

// A coverage set that declares every real SecretClass (excludes the
// 'unknown' sentinel) so tests targeting one diagnostic kind don't
// accidentally trip uncovered_class / single_engine_class as noise.
const ALL_REAL_CLASSES: SecretClass[] = ALL_SECRET_CLASSES.filter(c => c !== 'unknown');

function omniEnginePair(): EngineCapability[] {
  return [
    makeEngine({ id: 'engine-a', classes: [...ALL_REAL_CLASSES], corpora: ['repo', 'other', 'claude_transcripts', 'codex_transcripts'] }),
    makeEngine({ id: 'engine-b', classes: [...ALL_REAL_CLASSES], corpora: ['repo', 'other', 'claude_transcripts', 'codex_transcripts'] }),
  ];
}

// ---------------------------------------------------------------------------
// 1. engine_unavailable
// ---------------------------------------------------------------------------

describe('engine_unavailable', () => {
  it('fires warn and names the lost classes when an unavailable engine has unique coverage', () => {
    const engines: EngineCapability[] = [
      makeEngine({ id: 'native', classes: ['github_token'], corpora: ['repo'] }),
      makeEngine({ id: 'trufflehog', available: false, unavailableReason: 'binary not on PATH', classes: ['stripe_key'], corpora: ['repo'] }),
    ];
    const report = buildDoctorReport({ findings: [], engines, scannedPaths: [] });
    const diags = diagnosticsOfKind(report.diagnostics, 'engine_unavailable');
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe('warn');
    expect(diags[0].subjects).toContain('stripe_key');
    expect(diags[0].remedy).toMatch(/trufflehog/);
  });

  it('downgrades to info when the unavailable engine loses no unique coverage', () => {
    const engines: EngineCapability[] = [
      makeEngine({ id: 'native', classes: ['github_token'], corpora: ['repo'] }),
      makeEngine({ id: 'trufflehog', available: false, classes: ['github_token'], corpora: ['repo'] }),
    ];
    const report = buildDoctorReport({ findings: [], engines, scannedPaths: [] });
    const diags = diagnosticsOfKind(report.diagnostics, 'engine_unavailable');
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe('info');
  });

  it('does not fire when every engine is available', () => {
    const engines: EngineCapability[] = [makeEngine({ id: 'native' })];
    const report = buildDoctorReport({ findings: [], engines, scannedPaths: [] });
    expect(diagnosticsOfKind(report.diagnostics, 'engine_unavailable')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 2. corpus_blind_spot
// ---------------------------------------------------------------------------

describe('corpus_blind_spot', () => {
  it('fires when Secrets Vault (claude_transcripts only) sees a codex-sessions path', () => {
    const engines: EngineCapability[] = [
      makeEngine({ id: 'vault', classes: ['aws_key'], corpora: ['claude_transcripts'] }),
    ];
    const report = buildDoctorReport({
      findings: [],
      engines,
      // Built from the real home dir: classifyCorpus resolves against the actual
      // transcript roots, so a hard-coded /Users/fakeuser path is NOT a codex
      // corpus. That strictness is the point — an arbitrary path containing the
      // substring '.codex/sessions' must not be treated as transcript data.
      scannedPaths: [path.join(os.homedir(), '.codex', 'sessions', '2026', 'fake.jsonl')],
    });
    const diags = diagnosticsOfKind(report.diagnostics, 'corpus_blind_spot');
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe('warn');
    expect(diags[0].subjects).toContain('vault');
    expect(diags[0].subjects).toContain('codex_transcripts');
  });

  it('does not fire when the engine declares the corpus of every scanned path', () => {
    const engines: EngineCapability[] = [
      makeEngine({ id: 'native', classes: ['aws_key'], corpora: ['repo'] }),
    ];
    const report = buildDoctorReport({
      findings: [],
      engines,
      // A path inside this checkout, so the git-root walk really finds one.
      // '/repo/src/index.ts' does not exist and classifies as 'other'.
      scannedPaths: [path.join(process.cwd(), 'package.json')],
    });
    expect(diagnosticsOfKind(report.diagnostics, 'corpus_blind_spot')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 3. single_engine_class
// ---------------------------------------------------------------------------

describe('single_engine_class', () => {
  it('fires and names a class covered by exactly one available engine', () => {
    const engines: EngineCapability[] = [
      makeEngine({ id: 'native', classes: ['aws_key', 'stripe_key'] }),
      makeEngine({ id: 'trufflehog', classes: ['aws_key'] }), // both cover aws_key; only native covers stripe_key
    ];
    const report = buildDoctorReport({ findings: [], engines, scannedPaths: [] });
    const diags = diagnosticsOfKind(report.diagnostics, 'single_engine_class');
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe('info');
    expect(diags[0].subjects).toContain('stripe_key');
    expect(diags[0].subjects).not.toContain('aws_key'); // aws_key has two engines, not single-covered
  });

  it('does not fire when every declared class has two or more covering engines', () => {
    const engines: EngineCapability[] = [
      makeEngine({ id: 'native', classes: ['aws_key'] }),
      makeEngine({ id: 'trufflehog', classes: ['aws_key'] }),
    ];
    const report = buildDoctorReport({ findings: [], engines, scannedPaths: [] });
    expect(diagnosticsOfKind(report.diagnostics, 'single_engine_class')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 4. uncovered_class
// ---------------------------------------------------------------------------

describe('uncovered_class', () => {
  it('fires error and lists classes no available engine declares', () => {
    const engines: EngineCapability[] = [makeEngine({ id: 'native', classes: ['aws_key', 'github_token'] })];
    const report = buildDoctorReport({ findings: [], engines, scannedPaths: [] });
    const diags = diagnosticsOfKind(report.diagnostics, 'uncovered_class');
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe('error');
    expect(diags[0].subjects).toContain('stripe_key');
    expect(diags[0].subjects).not.toContain('aws_key');
    expect(diags[0].subjects).not.toContain('unknown'); // sentinel excluded, not a real coverage gap
  });

  it('does not fire when available engines jointly cover every real class', () => {
    const report = buildDoctorReport({ findings: [], engines: omniEnginePair(), scannedPaths: [] });
    expect(diagnosticsOfKind(report.diagnostics, 'uncovered_class')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 5. engine_disagreement
// ---------------------------------------------------------------------------

describe('engine_disagreement', () => {
  it('fires when a capable available engine did not find what another engine found', () => {
    const engines: EngineCapability[] = [
      makeEngine({ id: 'native', classes: ['github_token'], corpora: ['repo'] }),
      makeEngine({ id: 'trufflehog', classes: ['github_token'], corpora: ['repo'] }),
    ];
    const findings: Finding[] = [
      makeFinding({ secretClass: 'github_token', engine: 'native', foundBy: ['native'], locations: [{ file: '/repo/a.ts', corpus: 'repo' }] }),
    ];
    const report = buildDoctorReport({ findings, engines, scannedPaths: [] });
    const diags = diagnosticsOfKind(report.diagnostics, 'engine_disagreement');
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe('warn');
    expect(diags[0].subjects).toEqual(['github_token', 'trufflehog']);
    expect(diags[0].count).toBe(1);
  });

  it('collapses multiple disagreeing findings of the same (class, missing-engine) into one diagnostic with a count', () => {
    const engines: EngineCapability[] = [
      makeEngine({ id: 'native', classes: ['github_token'], corpora: ['repo'] }),
      makeEngine({ id: 'trufflehog', classes: ['github_token'], corpora: ['repo'] }),
    ];
    const findings: Finding[] = [
      makeFinding({ secretClass: 'github_token', foundBy: ['native'], locations: [{ file: '/repo/a.ts', corpus: 'repo' }] }),
      makeFinding({ secretClass: 'github_token', foundBy: ['native'], locations: [{ file: '/repo/b.ts', corpus: 'repo' }] }),
      makeFinding({ secretClass: 'github_token', foundBy: ['native'], locations: [{ file: '/repo/c.ts', corpus: 'repo' }] }),
    ];
    const report = buildDoctorReport({ findings, engines, scannedPaths: [] });
    const diags = diagnosticsOfKind(report.diagnostics, 'engine_disagreement');
    expect(diags).toHaveLength(1);
    expect(diags[0].count).toBe(3);
  });

  it('does NOT fire when the missing engine could never have been capable (wrong corpus)', () => {
    const engines: EngineCapability[] = [
      makeEngine({ id: 'native', classes: ['github_token'], corpora: ['repo'] }),
      // trufflehog declares the class but only reads a corpus this finding was never in.
      makeEngine({ id: 'trufflehog', classes: ['github_token'], corpora: ['claude_transcripts'] }),
    ];
    const findings: Finding[] = [
      makeFinding({ secretClass: 'github_token', foundBy: ['native'], locations: [{ file: '/repo/a.ts', corpus: 'repo' }] }),
    ];
    const report = buildDoctorReport({ findings, engines, scannedPaths: [] });
    expect(diagnosticsOfKind(report.diagnostics, 'engine_disagreement')).toHaveLength(0);
  });

  it('does NOT fire when the missing engine never declares the class at all', () => {
    const engines: EngineCapability[] = [
      makeEngine({ id: 'native', classes: ['github_token'], corpora: ['repo'] }),
      // trufflehog reads the right corpus but does not declare github_token.
      makeEngine({ id: 'trufflehog', classes: ['aws_key'], corpora: ['repo'] }),
    ];
    const findings: Finding[] = [
      makeFinding({ secretClass: 'github_token', foundBy: ['native'], locations: [{ file: '/repo/a.ts', corpus: 'repo' }] }),
    ];
    const report = buildDoctorReport({ findings, engines, scannedPaths: [] });
    expect(diagnosticsOfKind(report.diagnostics, 'engine_disagreement')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 6. detector_degeneracy
// ---------------------------------------------------------------------------

function buildDegeneracyFixture(dominantCount: number, total: number): Finding[] {
  const findings: Finding[] = [];
  for (let i = 0; i < dominantCount; i++) {
    findings.push(makeFinding({ engine: 'trufflehog', engineDetector: 'Refiner', secretClass: 'high_entropy' }));
  }
  // Spread the remainder across many distinct detectors (one finding each) so
  // no other single detector crosses either threshold and only 'Refiner' is
  // under test.
  for (let i = 0; i < total - dominantCount; i++) {
    findings.push(makeFinding({ engine: 'trufflehog', engineDetector: `Other-${i}`, secretClass: 'high_entropy' }));
  }
  return findings;
}

describe('detector_degeneracy', () => {
  it('fires at 31% share (just above the 30% threshold)', () => {
    const findings = buildDegeneracyFixture(31, 100);
    const report = buildDoctorReport({ findings, engines: [makeEngine()], scannedPaths: [] });
    const diags = diagnosticsOfKind(report.diagnostics, 'detector_degeneracy');
    expect(diags).toHaveLength(1);
    expect(diags[0].subjects).toContain('Refiner');
    expect(diags[0].count).toBe(31);
  });

  it('does not fire at 29% share', () => {
    const findings = buildDegeneracyFixture(29, 100);
    const report = buildDoctorReport({ findings, engines: [makeEngine()], scannedPaths: [] });
    expect(diagnosticsOfKind(report.diagnostics, 'detector_degeneracy')).toHaveLength(0);
  });

  it('fires at 501 absolute even when share is under 30%', () => {
    const findings = buildDegeneracyFixture(501, 2000); // share = 25.05%
    const report = buildDoctorReport({ findings, engines: [makeEngine()], scannedPaths: [] });
    const diags = diagnosticsOfKind(report.diagnostics, 'detector_degeneracy');
    expect(diags).toHaveLength(1);
    expect(diags[0].count).toBe(501);
  });

  it('does not fire at 499 absolute when share is also under 30%', () => {
    const findings = buildDegeneracyFixture(499, 2000); // share = 24.95%
    const report = buildDoctorReport({ findings, engines: [makeEngine()], scannedPaths: [] });
    expect(diagnosticsOfKind(report.diagnostics, 'detector_degeneracy')).toHaveLength(0);
  });

  it('sanity-checks the exported thresholds match the spec', () => {
    expect(DETECTOR_DEGENERACY_SHARE).toBe(0.3);
    expect(DETECTOR_DEGENERACY_ABSOLUTE).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// 7. unmapped_class
// ---------------------------------------------------------------------------

describe('unmapped_class', () => {
  it('fires and groups unknown-class findings by engineDetector with counts', () => {
    const findings: Finding[] = [
      makeFinding({ secretClass: 'unknown', engineDetector: 'HighEntropyString' }),
      makeFinding({ secretClass: 'unknown', engineDetector: 'HighEntropyString' }),
      makeFinding({ secretClass: 'unknown', engineDetector: 'GenericMatch' }),
    ];
    const report = buildDoctorReport({ findings, engines: [makeEngine()], scannedPaths: [] });
    const diags = diagnosticsOfKind(report.diagnostics, 'unmapped_class');
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe('info');
    expect(diags[0].count).toBe(3);
    expect(diags[0].subjects).toContain('HighEntropyString');
    expect(diags[0].subjects).toContain('GenericMatch');
  });

  it('does not fire when no finding has secretClass unknown', () => {
    const findings: Finding[] = [makeFinding({ secretClass: 'aws_key' })];
    const report = buildDoctorReport({ findings, engines: [makeEngine()], scannedPaths: [] });
    expect(diagnosticsOfKind(report.diagnostics, 'unmapped_class')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 8. disposition_debt
// ---------------------------------------------------------------------------

describe('disposition_debt', () => {
  it('fires warn and scales the message when pending findings exist', () => {
    const findings: Finding[] = [
      makeFinding({ disposition: 'pending' }),
      makeFinding({ disposition: 'pending' }),
    ];
    const report = buildDoctorReport({ findings, engines: [makeEngine()], scannedPaths: [] });
    const diags = diagnosticsOfKind(report.diagnostics, 'disposition_debt');
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe('warn');
    expect(diags[0].count).toBe(2);
  });

  it('scales the remedy wording for large debt (>50 pending)', () => {
    const findings: Finding[] = Array.from({ length: 60 }, () => makeFinding({ disposition: 'pending' }));
    const report = buildDoctorReport({ findings, engines: [makeEngine()], scannedPaths: [] });
    const diags = diagnosticsOfKind(report.diagnostics, 'disposition_debt');
    expect(diags[0].count).toBe(60);
    expect(diags[0].remedy).not.toEqual(
      diagnosticsOfKind(
        buildDoctorReport({ findings: [makeFinding({ disposition: 'pending' })], engines: [makeEngine()], scannedPaths: [] }).diagnostics,
        'disposition_debt'
      )[0].remedy
    );
  });

  it('does not fire when no finding is pending', () => {
    const findings: Finding[] = [
      makeFinding({ disposition: 'rotated' }),
      makeFinding({ disposition: 'false_positive' }),
    ];
    const report = buildDoctorReport({ findings, engines: [makeEngine()], scannedPaths: [] });
    expect(diagnosticsOfKind(report.diagnostics, 'disposition_debt')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 9. liveness_unknown
// ---------------------------------------------------------------------------

describe('liveness_unknown', () => {
  it('fires warn for an unverified high-consequence class (aws_key)', () => {
    const findings: Finding[] = [makeFinding({ secretClass: 'aws_key', liveness: 'unverified' })];
    const report = buildDoctorReport({ findings, engines: [makeEngine()], scannedPaths: [] });
    const diags = diagnosticsOfKind(report.diagnostics, 'liveness_unknown');
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe('warn');
    expect(diags[0].remedy).toMatch(/shape|verif/i);
  });

  it('does not fire for an unverified but low-consequence class (high_entropy)', () => {
    const findings: Finding[] = [makeFinding({ secretClass: 'high_entropy', liveness: 'unverified' })];
    const report = buildDoctorReport({ findings, engines: [makeEngine()], scannedPaths: [] });
    expect(diagnosticsOfKind(report.diagnostics, 'liveness_unknown')).toHaveLength(0);
  });

  it('does not fire for a high-consequence class once liveness is known', () => {
    const findings: Finding[] = [makeFinding({ secretClass: 'aws_key', liveness: 'dead' })];
    const report = buildDoctorReport({ findings, engines: [makeEngine()], scannedPaths: [] });
    expect(diagnosticsOfKind(report.diagnostics, 'liveness_unknown')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// worstSeverity
// ---------------------------------------------------------------------------

describe('worstSeverity', () => {
  it('resolves to error when an error-severity diagnostic is present alongside warn and info', () => {
    const engines: EngineCapability[] = [
      makeEngine({ id: 'native', classes: ['aws_key'] }), // leaves everything else uncovered -> error
      makeEngine({ id: 'trufflehog', available: false, classes: ['stripe_key'] }), // -> warn (lost coverage)
    ];
    const findings: Finding[] = [makeFinding({ secretClass: 'unknown', engineDetector: 'X' })]; // -> info
    const report = buildDoctorReport({ findings, engines, scannedPaths: [] });
    expect(report.worstSeverity).toBe('error');
  });

  it('resolves to none when there are no diagnostics', () => {
    const report = buildDoctorReport({ findings: [], engines: omniEnginePair(), scannedPaths: [] });
    expect(report.diagnostics).toHaveLength(0);
    expect(report.worstSeverity).toBe('none');
  });

  it('sorts diagnostics by severity descending, then kind ascending', () => {
    const engines: EngineCapability[] = [
      makeEngine({ id: 'native', classes: ['aws_key'] }),
      makeEngine({ id: 'trufflehog', available: false, classes: ['stripe_key'] }),
    ];
    const findings: Finding[] = [makeFinding({ secretClass: 'unknown', engineDetector: 'X' })];
    const report = buildDoctorReport({ findings, engines, scannedPaths: [] });
    const ranks: Record<string, number> = { error: 3, warn: 2, info: 1 };
    for (let i = 1; i < report.diagnostics.length; i++) {
      const prev = report.diagnostics[i - 1];
      const cur = report.diagnostics[i];
      const prevRank = ranks[prev.severity];
      const curRank = ranks[cur.severity];
      expect(prevRank >= curRank).toBe(true);
      if (prevRank === curRank) {
        expect(prev.kind.localeCompare(cur.kind) <= 0).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// determinism
// ---------------------------------------------------------------------------

describe('determinism', () => {
  it('produces deep-equal (byte-identical) output on identical input across two calls', () => {
    const input: DoctorInput = {
      findings: [
        makeFinding({ secretClass: 'aws_key', liveness: 'unverified', disposition: 'pending' }),
        makeFinding({ secretClass: 'unknown', engineDetector: 'Weird' }),
        makeFinding({ secretClass: 'github_token', foundBy: ['native'] }),
      ],
      engines: [
        makeEngine({ id: 'native', classes: ['aws_key', 'github_token'], corpora: ['repo'] }),
        makeEngine({ id: 'trufflehog', classes: ['github_token', 'stripe_key'], corpora: ['repo'] }),
        makeEngine({ id: 'vault', available: false, unavailableReason: 'not installed', classes: ['stripe_key'], corpora: ['claude_transcripts'] }),
      ],
      scannedPaths: ['/repo/src/index.ts', '/Users/fakeuser/.codex/sessions/x.jsonl'],
    };
    const reportA = buildDoctorReport(input);
    const reportB = buildDoctorReport(input);
    expect(reportA).toEqual(reportB);
    expect(JSON.stringify(reportA)).toEqual(JSON.stringify(reportB));
  });
});

// ---------------------------------------------------------------------------
// coverage / breakdown fields
// ---------------------------------------------------------------------------

describe('report scaffolding fields', () => {
  it('populates coverageMatrix for every SecretClass including unknown (empty array)', () => {
    const engines: EngineCapability[] = [makeEngine({ id: 'native', classes: ['aws_key'] })];
    const report = buildDoctorReport({ findings: [], engines, scannedPaths: [] });
    expect(Object.keys(report.coverageMatrix).sort()).toEqual([...ALL_SECRET_CLASSES].sort());
    expect(report.coverageMatrix['aws_key']).toEqual(['native']);
    expect(report.coverageMatrix['unknown']).toEqual([]);
    expect(report.coverageMatrix['github_token']).toEqual([]);
  });

  it('tallies specificityBreakdown and totalFindings', () => {
    const findings: Finding[] = [
      makeFinding({ specificity: 'structured' }),
      makeFinding({ specificity: 'structured' }),
      makeFinding({ specificity: 'heuristic' }),
      makeFinding({ specificity: 'entropy' }),
    ];
    const report = buildDoctorReport({ findings, engines: [makeEngine()], scannedPaths: [] });
    expect(report.specificityBreakdown).toEqual({ structured: 2, heuristic: 1, entropy: 1 });
    expect(report.totalFindings).toBe(4);
  });

  it('never emits a credential value — subjects only carry classes, engine ids, and paths', () => {
    const findings: Finding[] = [makeFinding({ preview: 'FAKE-NOT-A-REAL-SECRET' })];
    const report = buildDoctorReport({ findings, engines: [makeEngine()], scannedPaths: [] });
    for (const d of report.diagnostics) {
      for (const s of d.subjects) {
        expect(s).not.toContain('FAKE-NOT-A-REAL-SECRET');
      }
    }
  });
});
