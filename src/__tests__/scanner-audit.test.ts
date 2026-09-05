/**
 * NavGator scanner ↔ audit integration test — Run 2 / D6
 *
 * End-to-end: run a scan on a tiny tmp-fixture project, assert that the
 * timeline entry's `audit` block is populated with a plan, sample size,
 * defect counts, and a verdict.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { scan } from '../scanner.js';
import { loadIndex } from '../storage.js';
import type { ArchitectureIndex } from '../types.js';

let workDir: string;
let origCwd: string;

beforeEach(() => {
  origCwd = process.cwd();
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-audit-int-'));
  fs.mkdirSync(path.join(workDir, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(workDir, 'package.json'),
    JSON.stringify({ name: 'audit-fixture', version: '0.0.0', dependencies: {} }, null, 2)
  );
  fs.writeFileSync(
    path.join(workDir, 'src', 'a.ts'),
    `import { fromB } from './b';\nexport function fromA() { return fromB(); }\n`
  );
  fs.writeFileSync(
    path.join(workDir, 'src', 'b.ts'),
    `export function fromB() { return 1; }\n`
  );
  process.chdir(workDir);
});

afterEach(() => {
  process.chdir(origCwd);
  fs.rmSync(workDir, { recursive: true, force: true });
});

describe('scanner ↔ audit integration', () => {
  it('full scan emits audit block on timeline entry', async () => {
    const result = await scan(workDir, { mode: 'full', verbose: false });
    expect(result.timelineEntry).toBeDefined();
    const audit = result.timelineEntry?.audit;
    expect(audit).toBeDefined();
    if (!audit) return;
    expect(['AQL', 'SPRT', 'Cochran']).toContain(audit.plan);
    expect(audit.n).toBeGreaterThan(0);
    expect(audit.sampled).toBeGreaterThanOrEqual(0);
    expect(audit.defects).toBeGreaterThanOrEqual(0);
    expect(['accept', 'reject', 'continue']).toContain(audit.verdict);
    // CLI mode (no MCP context propagated) → llm_skipped should be true.
    expect(audit.llm_skipped).toBe(true);
    expect(audit.timestamp).toBeGreaterThan(0);
  }, 30000);

  it('--no-audit skips audit block', async () => {
    const result = await scan(workDir, { mode: 'full', noAudit: true });
    expect(result.timelineEntry?.audit).toBeUndefined();
  }, 30000);

  it('persists EWMA + audit_history_count on the index', async () => {
    await scan(workDir, { mode: 'full' });
    const index = (await loadIndex()) as ArchitectureIndex | null;
    expect(index).not.toBeNull();
    if (!index) return;
    expect(index.audit_history_count).toBeGreaterThanOrEqual(1);
    expect(index.ewma).toBeDefined();
  }, 30000);

  it('explicit --audit-plan=cochran picks Cochran', async () => {
    const result = await scan(workDir, { mode: 'full', auditPlan: 'cochran' });
    expect(result.timelineEntry?.audit?.plan).toBe('Cochran');
  }, 30000);
});

// ============================================================================
// Run 4 fix2 — #1 scip forwarding, #4 FILE: path aliases, #2a Task spawn sites
// ============================================================================

import { normalizeEndpointPath, resolveFileEndpoints } from '../scanner.js';
import type { ArchitectureComponent, ArchitectureConnection } from '../types.js';

describe('fix2 #1: `scan --scip` reaches the imports oracle', () => {
  it('runs (or times out) the SCIP oracle instead of reporting skipped when scip is requested', async () => {
    fs.writeFileSync(
      path.join(workDir, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { target: 'es2020', module: 'esnext', moduleResolution: 'node', strict: true }, include: ['src'] })
    );
    const result = await scan(workDir, { mode: 'full', scip: true });
    const oracle = result.timelineEntry?.audit?.oracles?.find((o) => o.oracle === 'imports-scip');
    expect(oracle).toBeDefined();
    expect(oracle!.notes.join(' ')).not.toContain('skipped');
    expect(oracle!.oracle_strength === 'independent' || /timed out/.test(oracle!.notes.join(' '))).toBe(true);
  }, 120000);

  it('reports the SCIP oracle as skipped when scip is not requested', async () => {
    const result = await scan(workDir, { mode: 'full' });
    const oracle = result.timelineEntry?.audit?.oracles?.find((o) => o.oracle === 'imports-scip');
    expect(oracle?.oracle_strength).toBe('none');
    expect(oracle?.notes[0]).toContain('skipped');
  }, 30000);
});

describe('fix2 #4: FILE: endpoint aliases normalize to one key', () => {
  it('normalizeEndpointPath collapses ./ prefixes, duplicate separators and backslashes', () => {
    expect(normalizeEndpointPath('./src/a.ts')).toBe('src/a.ts');
    expect(normalizeEndpointPath('src//a.ts')).toBe('src/a.ts');
    expect(normalizeEndpointPath('././src/./a.ts')).toBe('src/a.ts');
    expect(normalizeEndpointPath('src\\a.ts')).toBe('src/a.ts');
  });

  function mkComp(id: string, file: string): ArchitectureComponent {
    return {
      component_id: id, name: id, type: 'component',
      role: { purpose: '', layer: 'backend', critical: false },
      source: { detection_method: 'auto', config_files: [file], confidence: 1 },
      connects_to: [], connected_from: [], status: 'active', tags: [], timestamp: 0, last_updated: 0,
    };
  }
  function mkConn(id: string, from: string, to: string): ArchitectureConnection {
    return {
      connection_id: id, from: { component_id: from, location: { file: 'x', line: 1 } }, to: { component_id: to },
      connection_type: 'imports', code_reference: { file: 'x', symbol: 'y' }, detected_from: 't', confidence: 1, timestamp: 0, last_verified: 0,
    };
  }

  it('an aliased FILE: ref finds the owner component, and two aliases of an unclaimed file share one node', () => {
    const comps = [mkComp('C_a', 'src/a.ts')];
    const conns = [
      mkConn('X1', 'FILE:./src/a.ts', 'FILE:src//b.ts'),
      mkConn('X2', 'FILE:src/a.ts', 'FILE:./src/b.ts'),
    ];
    resolveFileEndpoints(comps, conns, workDir); // workDir has src/a.ts and src/b.ts from beforeEach
    expect(conns[0]!.from.component_id).toBe('C_a');
    expect(conns[1]!.from.component_id).toBe('C_a');
    const fileNodes = comps.filter((c) => c.tags.includes('file-node'));
    expect(fileNodes).toHaveLength(1);
    expect(fileNodes[0]!.source.config_files).toEqual(['src/b.ts']);
    expect(conns[0]!.to.component_id).toBe(fileNodes[0]!.component_id);
    expect(conns[1]!.to.component_id).toBe(fileNodes[0]!.component_id);
  });
});

describe('fix2 #2a: Swift Task sites attach to the enclosing type, never a path:line component', () => {
  it('records spawns on the owner type and uses the file node at file scope', async () => {
    const swiftDir = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-swift-task-'));
    try {
      fs.mkdirSync(path.join(swiftDir, 'Sources', 'App'), { recursive: true });
      fs.writeFileSync(path.join(swiftDir, 'Package.swift'), 'let package = Package(name: "Demo")\n');
      fs.writeFileSync(
        path.join(swiftDir, 'Sources', 'App', 'MomentBoxView.swift'),
        [
          'import SwiftUI',
          '',
          'struct MomentBoxView: View {',
          '  var body: some View {',
          '    Button("go") {',
          '      Task {',
          '        await load()',
          '      }',
          '    }',
          '  }',
          '}',
          '',
          'Task.detached {',
          '  print("file scope")',
          '}',
          '',
        ].join('\n')
      );
      process.chdir(swiftDir);
      const result = await scan(swiftDir, { mode: 'full' });
      const bogus = result.components.filter((c) => /^task(_spawn)?_.*:\d+$/.test(c.name));
      expect(bogus).toEqual([]);
      const owner = result.components.find((c) => c.name === 'MomentBoxView' && c.type === 'component');
      expect(owner).toBeDefined();
      // The spawn is attached to the OWNER TYPE as a self-edge ("Task spawning in body").
      // metadata.spawns[] is also written by the code scanner, but scan-level
      // dedup may keep the SwiftUI scanner's copy of the same type, so the
      // durable record is the edge.
      const ownerSpawnEdges = result.connections.filter(
        (c) => c.from.component_id === owner!.component_id && /Task spawning/.test(c.description ?? '')
      );
      expect(ownerSpawnEdges.length).toBeGreaterThanOrEqual(1);
      const fileNode = result.components.find((c) => c.tags.includes('file-node') && c.source.config_files.includes('Sources/App/MomentBoxView.swift'));
      expect(fileNode).toBeDefined();
      expect(result.connections.some((c) => c.from.component_id === fileNode!.component_id && /Task spawning/.test(c.description ?? ''))).toBe(true);
      const ids = new Set(result.components.map((c) => c.component_id));
      const taskEdges = result.connections.filter((c) => /Task spawning|\.task modifier/.test(c.description ?? ''));
      expect(taskEdges.length).toBeGreaterThanOrEqual(2);
      for (const e of taskEdges) {
        expect(ids.has(e.from.component_id)).toBe(true);
        expect(ids.has(e.to.component_id)).toBe(true);
      }
      const hc = result.timelineEntry?.audit?.by_class.HALLUCINATED_COMPONENT;
      expect(hc?.defects ?? 0).toBe(0);
    } finally {
      process.chdir(origCwd);
      fs.rmSync(swiftDir, { recursive: true, force: true });
    }
  }, 60000);
});
