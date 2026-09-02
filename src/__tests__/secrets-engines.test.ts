import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { NATIVE_CLASSES, NativeEngine } from '../secrets/engines/native.js';
import { TruffleHogEngine, mapDetectorName } from '../secrets/engines/trufflehog.js';
import { VaultEngine } from '../secrets/engines/vault.js';
import { mergeFindings, runSecretScan, type EngineFindingBatch, type MergedSecretFinding } from '../secrets/scan.js';
import type { SecretFinding } from '../secrets/types.js';

// ---------------------------------------------------------------------------
// Fixtures — every planted value below is an obviously fake, documented
// example or repeating-junk credential. None of these are real secrets.
// ---------------------------------------------------------------------------

// AWS's own published documentation example key ID (AKIA…EXAMPLE) — non-functional.
const PLANTED_AKIA = 'AKIAIOSFODNN7EXAMPLE';
const PLANTED_POSTGRES_URI = 'postgres://testuser:testpass123@localhost:5432/testdb';
const PLANTED_PEM_HEADER = '-----BEGIN PRIVATE KEY-----';
// Long, obviously-fake, repeating-pattern value (>12 chars) — used to prove
// preview truncation, since a <=12-char secret would trivially equal its
// own preview.
const PLANTED_LONG_SECRET = `sk-ant-${'FAKE1234567890'.repeat(4)}`;

// SendGrid format: "SG." + 22 chars + "." + 43 chars. Repeated-char, obviously fake.
const PLANTED_SENDGRID = `SG.${'F'.repeat(22)}.${'A'.repeat(43)}`;
// Twilio API Key Secret: "SK" + 32 hex digits. Obviously-fake hex.
const PLANTED_TWILIO = `SK${'a1b2c3d4'.repeat(4)}`;
// GCP service-account JSON key file marker.
const PLANTED_GCP_JSON = '{"type": "service_account", "project_id": "fake-project"}';
// Azure storage account key: 86 base64 chars + "==", keyed off AccountKey=.
const AZURE_BASE64_86 = (() => {
  const chars = 'AbCdEfGh0123456789+/';
  let out = '';
  while (out.length < 86) out += chars;
  return out.slice(0, 86);
})();
const PLANTED_AZURE_VALUE = `${AZURE_BASE64_86}==`;
const PLANTED_AZURE_CONN_STRING = `DefaultEndpointsProtocol=https;AccountName=fakestorage;AccountKey=${PLANTED_AZURE_VALUE};EndpointSuffix=core.windows.net`;

let fixtureDir: string;

beforeEach(() => {
  fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-secrets-test-'));
});

afterEach(() => {
  fs.rmSync(fixtureDir, { recursive: true, force: true });
});

function writeFixture(relPath: string, contents: string): string {
  const abs = path.join(fixtureDir, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, contents, 'utf8');
  return abs;
}

/** Recursively finds every path in `value` where a string equals `target`
 * exactly. This is a generic structural walk, not a fixed field list — if a
 * future field (e.g. a `value` on SecretFinding) ever held the full secret,
 * this walk would find it just the same. */
function findExactStringMatches(value: unknown, target: string, atPath: string[] = []): string[] {
  const hits: string[] = [];
  if (typeof value === 'string') {
    if (value === target) hits.push(atPath.join('.') || '(root)');
    return hits;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => hits.push(...findExactStringMatches(v, target, [...atPath, String(i)])));
    return hits;
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      hits.push(...findExactStringMatches(v, target, [...atPath, k]));
    }
  }
  return hits;
}

describe('NativeEngine', () => {
  it('finds a planted AKIA key, a planted postgres:// URI, and a planted PEM header', async () => {
    writeFixture(
      'creds.txt',
      [
        `aws_key = ${PLANTED_AKIA}`,
        `DATABASE_URL=${PLANTED_POSTGRES_URI}`,
        PLANTED_PEM_HEADER,
        'FAKEKEYBODYNOTAREALKEY==',
        '-----END PRIVATE KEY-----',
      ].join('\n'),
    );

    const engine = new NativeEngine();
    const findings = await engine.scan([fixtureDir]);

    const aws = findings.find((f) => f.secretClass === 'aws_key');
    const pg = findings.find((f) => f.secretClass === 'postgres_uri');
    const pem = findings.find((f) => f.secretClass === 'private_key');

    expect(aws).toBeDefined();
    expect(aws?.specificity).toBe('structured');
    expect(aws?.preview).toBe(PLANTED_AKIA.slice(0, 12));

    expect(pg).toBeDefined();
    expect(pg?.specificity).toBe('structured');

    expect(pem).toBeDefined();
    expect(pem?.specificity).toBe('structured');
  });

  it('sets specificity honestly: structured for vendor prefixes, heuristic for KEY=value, entropy for the catch-all', async () => {
    writeFixture(
      'mixed.txt',
      [
        `github_pat_${'A'.repeat(22)}`, // structured (vendor prefix)
        `client_secret = "${'x'.repeat(20)}"`, // heuristic (assignment shape)
      ].join('\n'),
    );

    const engine = new NativeEngine();
    const findings = await engine.scan([fixtureDir]);

    const gh = findings.find((f) => f.secretClass === 'github_token');
    const generic = findings.find((f) => f.secretClass === 'generic_assignment');

    expect(gh?.specificity).toBe('structured');
    expect(generic?.specificity).toBe('heuristic');
  });

  it('never stores the full secret value anywhere in the result (boundary test)', async () => {
    writeFixture('boundary.txt', `token = "${PLANTED_LONG_SECRET}"`);

    const engine = new NativeEngine();
    const findings = await engine.scan([fixtureDir]);

    const anthropic = findings.find((f) => f.secretClass === 'anthropic_key');
    expect(anthropic).toBeDefined();
    expect(anthropic!.preview.length).toBeLessThanOrEqual(12);
    expect(anthropic!.preview).not.toBe(PLANTED_LONG_SECRET);

    const hits = findExactStringMatches(findings, PLANTED_LONG_SECRET);
    expect(hits).toEqual([]);
  });

  it('returns no findings for a directory with no secrets', async () => {
    writeFixture('clean.txt', 'just some ordinary prose with nothing sensitive in it.\n');
    const engine = new NativeEngine();
    const findings = await engine.scan([fixtureDir]);
    expect(findings).toEqual([]);
  });

  it('includes the four new classes in NATIVE_CLASSES', () => {
    expect(NATIVE_CLASSES).toEqual(
      expect.arrayContaining(['sendgrid_key', 'twilio_key', 'gcp_key', 'azure_key']),
    );
  });

  it('finds a planted SendGrid key and rejects a wrong-segment-length lookalike', async () => {
    writeFixture('sendgrid-pos.txt', `SENDGRID_API_KEY=${PLANTED_SENDGRID}`);
    const engine = new NativeEngine();
    const findings = await engine.scan([fixtureDir]);

    const hit = findings.find((f) => f.secretClass === 'sendgrid_key');
    expect(hit).toBeDefined();
    expect(hit?.specificity).toBe('structured');
    expect(hit?.engineDetector).toBe('sendgrid_key');
  });

  it('does not match a SendGrid-prefixed string with wrong segment lengths', async () => {
    // First segment is 20 chars instead of the required 22.
    writeFixture('sendgrid-neg.txt', `SG.${'F'.repeat(20)}.${'A'.repeat(43)}`);
    const engine = new NativeEngine();
    const findings = await engine.scan([fixtureDir]);
    expect(findings.some((f) => f.secretClass === 'sendgrid_key')).toBe(false);
  });

  it('finds a planted Twilio API Key Secret (SK + 32 hex)', async () => {
    writeFixture('twilio-pos.txt', `TWILIO_API_KEY_SECRET=${PLANTED_TWILIO}`);
    const engine = new NativeEngine();
    const findings = await engine.scan([fixtureDir]);

    const hit = findings.find((f) => f.secretClass === 'twilio_key');
    expect(hit).toBeDefined();
    expect(hit?.specificity).toBe('structured');
    expect(hit?.engineDetector).toBe('twilio_key');
  });

  it('does not classify SK + 32 non-hex chars as twilio_key, and does not classify a stripe-style sk_live_ token as twilio_key', async () => {
    writeFixture(
      'twilio-neg.txt',
      [`SK${'g'.repeat(32)}`, `sk_live_${'A'.repeat(20)}`].join('\n'),
    );
    const engine = new NativeEngine();
    const findings = await engine.scan([fixtureDir]);

    expect(findings.some((f) => f.secretClass === 'twilio_key')).toBe(false);
    const stripe = findings.find((f) => f.secretClass === 'stripe_key');
    expect(stripe).toBeDefined();
    expect(stripe?.engineDetector).toBe('stripe_key');
  });

  it('finds the GCP service-account JSON marker', async () => {
    writeFixture('gcp-pos.json', PLANTED_GCP_JSON);
    const engine = new NativeEngine();
    const findings = await engine.scan([fixtureDir]);

    const hit = findings.find((f) => f.secretClass === 'gcp_key');
    expect(hit).toBeDefined();
    expect(hit?.specificity).toBe('structured');
    expect(hit?.engineDetector).toBe('gcp_key');
  });

  it('does not match "type": "user_account"', async () => {
    writeFixture('gcp-neg.json', '{"type": "user_account"}');
    const engine = new NativeEngine();
    const findings = await engine.scan([fixtureDir]);
    expect(findings.some((f) => f.secretClass === 'gcp_key')).toBe(false);
  });

  it('finds a planted Azure storage account key anchored on AccountKey=', async () => {
    writeFixture('azure-pos.txt', PLANTED_AZURE_CONN_STRING);
    const engine = new NativeEngine();
    const findings = await engine.scan([fixtureDir]);

    const hit = findings.find((f) => f.secretClass === 'azure_key');
    expect(hit).toBeDefined();
    expect(hit?.specificity).toBe('structured');
    expect(hit?.engineDetector).toBe('azure_key');
    // valueGroup isolates the base64 secret, not the "AccountKey=" keyword.
    expect(hit?.preview).toBe(PLANTED_AZURE_VALUE.slice(0, 12));
  });

  it('does not flag a bare 88-char base64 string with no AccountKey/SharedAccessKey keyword (false-positive flood case)', async () => {
    writeFixture('azure-neg.txt', `just a blob of base64 with no keyword: ${PLANTED_AZURE_VALUE}`);
    const engine = new NativeEngine();
    const findings = await engine.scan([fixtureDir]);
    expect(findings.some((f) => f.secretClass === 'azure_key')).toBe(false);
  });
});

describe('mapDetectorName (trufflehog)', () => {
  it('maps a known detector to its structured SecretClass', () => {
    expect(mapDetectorName('AWS')).toEqual({ secretClass: 'aws_key', specificity: 'structured' });
    expect(mapDetectorName('OpenAI')).toEqual({ secretClass: 'openai_key', specificity: 'structured' });
  });

  it('maps an unrecognized detector name to unknown/entropy rather than dropping it', () => {
    for (const unrecognized of ['Refiner', 'Box', 'TLy', 'Fmfw', 'RailwayApp', 'Aiven', 'Sirv', 'Qase', 'Wit', 'UnifyID', 'Juro', 'Imagga']) {
      expect(mapDetectorName(unrecognized)).toEqual({ secretClass: 'unknown', specificity: 'entropy' });
    }
  });
});

describe('engine availability', () => {
  it('TruffleHogEngine reports available:false and does not throw when the binary is absent', async () => {
    const engine = new TruffleHogEngine({ binaryPath: '/definitely/not/a/real/path/trufflehog-does-not-exist' });

    const capability = await engine.capability();
    expect(capability.available).toBe(false);
    expect(capability.unavailableReason).toBeTruthy();

    await expect(engine.scan([fixtureDir])).resolves.toEqual([]);
  });

  it('VaultEngine reports available:false and does not throw when the binary is absent', async () => {
    const engine = new VaultEngine({ binaryPath: '/definitely/not/a/real/path/vault-does-not-exist' });

    const capability = await engine.capability();
    expect(capability.available).toBe(false);
    expect(capability.unavailableReason).toBeTruthy();
    expect(capability.corpora).toEqual(['claude_transcripts']);

    await expect(engine.scan([fixtureDir])).resolves.toEqual([]);
  });

  it('VaultEngine never shells out for a scan whose paths do not touch the real claude_transcripts corpus, even if the binary exists', async () => {
    // Use the well-known default binary path as "available" without depending
    // on whether it actually exists on this machine: point at a fixture path,
    // which is guaranteed not to be ~/.claude/projects, and confirm no vault
    // process is even attempted (would otherwise touch real user data).
    const engine = new VaultEngine();
    const findings = await engine.scan([fixtureDir]);
    expect(findings).toEqual([]);
  });
});

describe('mergeFindings', () => {
  function makeFinding(overrides: Partial<SecretFinding> = {}): SecretFinding {
    return {
      hash: 'aaaaaaaaaaaa',
      preview: 'AKIAABCDEFGH',
      secretClass: 'aws_key',
      specificity: 'structured',
      engine: 'native',
      engineDetector: 'aws_access_key_id',
      locations: [{ file: '/fixture/a.txt', line: 1, corpus: 'other' }],
      occurrences: 1,
      liveness: 'unverified',
      disposition: 'pending',
      ...overrides,
    };
  }

  it('unions locations and records both engines in foundBy for the same hash', () => {
    const batches: EngineFindingBatch[] = [
      { engineId: 'native', findings: [makeFinding({ engine: 'native', specificity: 'structured' })] },
      {
        engineId: 'trufflehog',
        findings: [
          makeFinding({
            engine: 'trufflehog',
            engineDetector: 'AWS',
            specificity: 'structured',
            locations: [{ file: '/fixture/b.txt', line: 5, corpus: 'other' }],
            occurrences: 2,
          }),
        ],
      },
    ];

    const merged = mergeFindings(batches);
    expect(merged).toHaveLength(1);

    const finding: MergedSecretFinding = merged[0];
    expect(finding.foundBy).toEqual(['native', 'trufflehog']);
    expect(finding.locations).toHaveLength(2);
    expect(finding.locations.map((l) => l.file).sort()).toEqual(['/fixture/a.txt', '/fixture/b.txt']);
    expect(finding.occurrences).toBe(3);
  });

  it('keeps the more specific of two disagreeing specificities', () => {
    const batches: EngineFindingBatch[] = [
      { engineId: 'trufflehog', findings: [makeFinding({ engine: 'trufflehog', specificity: 'entropy' })] },
      { engineId: 'native', findings: [makeFinding({ engine: 'native', specificity: 'structured' })] },
    ];
    const merged = mergeFindings(batches);
    expect(merged[0].specificity).toBe('structured');
  });

  it('deduplicates an identical location reported twice by the same engine', () => {
    const loc = { file: '/fixture/a.txt', line: 1, corpus: 'other' as const };
    const batches: EngineFindingBatch[] = [
      { engineId: 'native', findings: [makeFinding({ locations: [loc] }), makeFinding({ locations: [loc] })] },
    ];
    const merged = mergeFindings(batches);
    expect(merged).toHaveLength(1);
    expect(merged[0].locations).toHaveLength(1);
  });

  it('sorts output by (secretClass, hash) for determinism', () => {
    const batches: EngineFindingBatch[] = [
      {
        engineId: 'native',
        findings: [
          makeFinding({ hash: 'zzzzzzzzzzzz', secretClass: 'github_token' }),
          makeFinding({ hash: 'aaaaaaaaaaaa', secretClass: 'aws_key' }),
          makeFinding({ hash: 'bbbbbbbbbbbb', secretClass: 'aws_key' }),
        ],
      },
    ];
    const merged = mergeFindings(batches);
    expect(merged.map((f) => [f.secretClass, f.hash])).toEqual([
      ['aws_key', 'aaaaaaaaaaaa'],
      ['aws_key', 'bbbbbbbbbbbb'],
      ['github_token', 'zzzzzzzzzzzz'],
    ]);
  });
});

describe('runSecretScan', () => {
  it('is deterministic: two runs over identical input produce byte-identical findings', async () => {
    writeFixture(
      'repeat.txt',
      [`aws_key = ${PLANTED_AKIA}`, `DATABASE_URL=${PLANTED_POSTGRES_URI}`, `client_secret = "${'y'.repeat(16)}"`].join('\n'),
    );

    // Restrict to the native engine so this test never depends on whether
    // trufflehog/vault happen to be installed in the environment running it.
    const first = await runSecretScan([fixtureDir], { engines: ['native'] });
    const second = await runSecretScan([fixtureDir], { engines: ['native'] });

    const strip = (r: typeof first) => ({ ...r, durationMs: 0 });
    expect(strip(first)).toEqual(strip(second));
  });

  it('runs only the requested engines and still reports capabilities for all requested ids', async () => {
    writeFixture('solo.txt', `aws_key = ${PLANTED_AKIA}`);
    const result = await runSecretScan([fixtureDir], { engines: ['native'] });

    expect(result.engines).toHaveLength(1);
    expect(result.engines[0].id).toBe('native');
    expect(result.findings.some((f) => f.secretClass === 'aws_key')).toBe(true);
    expect(result.filesScanned).toBeGreaterThan(0);
  });
});
