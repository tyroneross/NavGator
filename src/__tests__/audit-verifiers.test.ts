/**
 * NavGator audit verifiers tests — Run 2 / D6
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type {
  ArchitectureComponent,
  ArchitectureConnection,
  NavHashes,
} from '../types.js';
import {
  type VerifierContext,
  verifyDedupCollision,
  verifyHallucinatedComponent,
  verifyHallucinatedEdge,
  verifyMissedEdge,
  verifyStaleReference,
  verifyWrongEndpoint,
} from '../audit/verifiers.js';

// ============================================================================
// FIXTURES
// ============================================================================

let workDir: string;

beforeEach(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-audit-test-'));
});

afterEach(() => {
  fs.rmSync(workDir, { recursive: true, force: true });
});

function makeComponent(overrides: Partial<ArchitectureComponent> = {}): ArchitectureComponent {
  return {
    component_id: 'COMP_npm_x_1234',
    name: 'x',
    type: 'npm',
    role: { purpose: 'pkg', layer: 'backend', critical: false },
    source: { detection_method: 'auto', config_files: ['package.json'], confidence: 1 },
    ...overrides,
  } as ArchitectureComponent;
}

function makeConnection(overrides: Partial<ArchitectureConnection> = {}): ArchitectureConnection {
  return {
    connection_id: 'CONN_imports_abc',
    from: { component_id: 'COMP_a', location: { file: 'a.ts', line: 1 } as never },
    to: { component_id: 'COMP_b', location: { file: 'b.ts', line: 1 } as never },
    connection_type: 'imports',
    code_reference: { file: 'a.ts', symbol: 'foo', line_start: 1, line_end: 1 },
    detected_from: 'test',
    confidence: 0.9,
    timestamp: 0,
    last_verified: 0,
    ...overrides,
  } as ArchitectureConnection;
}

function ctxFor(overrides: Partial<VerifierContext> = {}): VerifierContext {
  return {
    projectRoot: workDir,
    hashes: null,
    componentById: new Map<string, ArchitectureComponent>(),
    isMcpMode: false,
    ...overrides,
  };
}

// ============================================================================
// V1 — HALLUCINATED_COMPONENT
// ============================================================================

describe('verifyHallucinatedComponent', () => {
  it('positive case: config file does not exist on disk → defect', async () => {
    const comp = makeComponent({ component_id: 'COMP_npm_ghost', source: { detection_method: 'auto', config_files: ['does-not-exist.json'], confidence: 1 } });
    const out = await verifyHallucinatedComponent([comp], ctxFor());
    expect(out.defectCount).toBe(1);
    expect(out.samples[0]!.ok).toBe(false);
  });

  it('negative case: config file exists → clean', async () => {
    fs.writeFileSync(path.join(workDir, 'package.json'), '{}');
    const comp = makeComponent();
    const out = await verifyHallucinatedComponent([comp], ctxFor());
    expect(out.defectCount).toBe(0);
    expect(out.samples[0]!.ok).toBe(true);
  });
});

// ============================================================================
// V2 — HALLUCINATED_EDGE
// ============================================================================

describe('verifyHallucinatedEdge', () => {
  it('positive case: from/to component_ids unresolved → defect', () => {
    const conn = makeConnection({
      from: { component_id: 'GHOST_FROM', location: { file: 'a.ts', line: 1 } as never },
      to: { component_id: 'GHOST_TO' },
    });
    const out = verifyHallucinatedEdge([conn], ctxFor());
    expect(out.defectCount).toBe(1);
    expect(out.samples[0]!.reason).toContain('both endpoints unresolved');
  });

  it('negative case: both endpoints resolve → clean', () => {
    const a = makeComponent({ component_id: 'COMP_a' });
    const b = makeComponent({ component_id: 'COMP_b' });
    const map = new Map<string, ArchitectureComponent>();
    map.set('COMP_a', a);
    map.set('COMP_b', b);
    const out = verifyHallucinatedEdge([makeConnection()], ctxFor({ componentById: map }));
    expect(out.defectCount).toBe(0);
  });
});

// ============================================================================
// V3 — WRONG_ENDPOINT
// ============================================================================

describe('verifyWrongEndpoint', () => {
  it('positive case: file present but symbol absent → defect', async () => {
    fs.writeFileSync(path.join(workDir, 'a.ts'), '// nothing relevant here');
    const target = makeComponent({ component_id: 'COMP_b', name: 'targetThingDef' });
    const map = new Map<string, ArchitectureComponent>([['COMP_b', target]]);
    const conn = makeConnection({ code_reference: { file: 'a.ts', symbol: 'fooMissingSymbol' } });
    const out = await verifyWrongEndpoint([conn], ctxFor({ componentById: map }));
    expect(out.defectCount).toBe(1);
  });

  it('negative case: symbol present in file → clean', async () => {
    fs.writeFileSync(path.join(workDir, 'a.ts'), 'export function foo() {}');
    const target = makeComponent({ component_id: 'COMP_b', name: 'foo' });
    const map = new Map<string, ArchitectureComponent>([['COMP_b', target]]);
    const conn = makeConnection({ code_reference: { file: 'a.ts', symbol: 'foo' } });
    const out = await verifyWrongEndpoint([conn], ctxFor({ componentById: map }));
    expect(out.defectCount).toBe(0);
  });
});

// ============================================================================
// V4 — STALE_REFERENCE
// ============================================================================

describe('verifyStaleReference', () => {
  it('positive case: hash mismatch → defect', async () => {
    const file = path.join(workDir, 'src/foo.ts');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'current content');
    const recorded = crypto.createHash('sha256').update('OLD content').digest('hex');
    const hashes: NavHashes = {
      version: '1.0',
      generatedAt: 0,
      projectPath: workDir,
      files: { 'src/foo.ts': { hash: recorded, lastScanned: 0, size: 0 } },
    };
    const out = await verifyStaleReference(['src/foo.ts'], ctxFor({ hashes }));
    expect(out.defectCount).toBe(1);
    expect(out.samples[0]!.reason).toContain('hash mismatch');
  });

  it('positive case: file deleted → defect', async () => {
    const recorded = crypto.createHash('sha256').update('was here').digest('hex');
    const hashes: NavHashes = {
      version: '1.0',
      generatedAt: 0,
      projectPath: workDir,
      files: { 'gone.ts': { hash: recorded, lastScanned: 0, size: 0 } },
    };
    const out = await verifyStaleReference(['gone.ts'], ctxFor({ hashes }));
    expect(out.defectCount).toBe(1);
  });

  it('negative case: hash matches → clean', async () => {
    const file = path.join(workDir, 'foo.ts');
    fs.writeFileSync(file, 'stable content');
    const recorded = crypto.createHash('sha256').update('stable content').digest('hex');
    const hashes: NavHashes = {
      version: '1.0',
      generatedAt: 0,
      projectPath: workDir,
      files: { 'foo.ts': { hash: recorded, lastScanned: 0, size: 0 } },
    };
    const out = await verifyStaleReference(['foo.ts'], ctxFor({ hashes }));
    expect(out.defectCount).toBe(0);
  });

  it('handles missing hashes.json (no defect)', async () => {
    const out = await verifyStaleReference(['x.ts'], ctxFor({ hashes: null }));
    expect(out.defectCount).toBe(0);
  });
});

// ============================================================================
// V5 — DEDUP_COLLISION
// ============================================================================

describe('verifyDedupCollision', () => {
  it('positive case: duplicate (type,name,primary-config) triple → defect', () => {
    const a = makeComponent({ component_id: 'COMP_1', type: 'npm', name: 'react', source: { detection_method: 'auto', config_files: ['package.json'], confidence: 1 } });
    const b = makeComponent({ component_id: 'COMP_2', type: 'npm', name: 'react', source: { detection_method: 'auto', config_files: ['package.json'], confidence: 1 } });
    const out = verifyDedupCollision([a, b]);
    expect(out.defectCount).toBe(1);
    expect(out.samples[0]!.reason).toContain('dedup-key collision');
  });

  it('negative case: same name, different type → clean', () => {
    const a = makeComponent({ component_id: 'COMP_1', type: 'npm', name: 'prisma' });
    const b = makeComponent({ component_id: 'COMP_2', type: 'database', name: 'prisma' });
    const out = verifyDedupCollision([a, b]);
    expect(out.defectCount).toBe(0);
  });

  it('negative case: same name + type, different file → clean', () => {
    const a = makeComponent({ component_id: 'COMP_1', source: { detection_method: 'auto', config_files: ['app/proxy.ts'], confidence: 1 } });
    const b = makeComponent({ component_id: 'COMP_2', source: { detection_method: 'auto', config_files: ['lib/proxy.ts'], confidence: 1 } });
    const out = verifyDedupCollision([a, b]);
    expect(out.defectCount).toBe(0);
  });
});

// ============================================================================
// V6 — MISSED_EDGE (LLM-judge)
// ============================================================================

describe('verifyMissedEdge', () => {
  it('CLI mode: returns llm_skipped=true with zero defects', () => {
    const out = verifyMissedEdge(['foo.ts'], [], ctxFor({ isMcpMode: false }));
    expect(out.llm_skipped).toBe(true);
    expect(out.defectCount).toBe(0);
  });

  it('MCP mode: returns structured llm_payload with recorded edges', () => {
    const conn = makeConnection({
      connection_id: 'CONN_abc',
      code_reference: { file: 'src/index.ts', symbol: 'doThing' },
    });
    const out = verifyMissedEdge(['src/index.ts'], [conn], ctxFor({ isMcpMode: true }));
    expect(out.llm_skipped).toBeUndefined();
    expect(out.llm_payload).toBeDefined();
    const payload = out.llm_payload as { files: Array<{ path: string; recorded_outgoing_edges: unknown[] }> };
    expect(payload.files[0]!.path).toBe('src/index.ts');
    expect(payload.files[0]!.recorded_outgoing_edges.length).toBe(1);
  });
});
