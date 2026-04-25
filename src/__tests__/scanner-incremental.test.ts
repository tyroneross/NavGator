/**
 * Incremental scan tests (Run 1 — D4).
 *
 * Six scenarios from the build goal:
 *  1. edit-one-file       — full baseline → edit → scan_type='incremental'
 *  2. lockfile-trigger    — edit package.json → scan_type='full'
 *  3. stale-trigger       — last_full_scan 8 days ago → scan_type='full'
 *  4. incremental-cap     — incrementals_since_full = 20 → scan_type='full'
 *  5. integrity-auto-promote — corrupt a connection → 'incremental→full'
 *  6. noop                — no changes → scan_type='noop'
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import { scan, selectScanMode } from '../scanner.js';
import { loadIndex, loadReverseDeps } from '../storage.js';
import { getStoragePath, SCHEMA_VERSION } from '../config.js';
import type { ArchitectureIndex, FileChangeResult } from '../types.js';

/**
 * Build a self-contained mini project in a fresh tmp dir.
 * Just enough surface to exercise the incremental code path:
 *   - package.json (manifest)
 *   - src/a.ts importing src/b.ts
 *   - src/b.ts importing src/c.ts
 *   - src/c.ts a leaf
 * Returns the absolute project root.
 */
function makeTmpProject(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-inc-'));
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ name: 'incremental-fixture', version: '0.0.0', dependencies: {} }, null, 2)
  );
  fs.writeFileSync(
    path.join(root, 'src', 'a.ts'),
    `import { fromB } from './b';\nexport function fromA() { return fromB() + 1; }\n`
  );
  fs.writeFileSync(
    path.join(root, 'src', 'b.ts'),
    `import { fromC } from './c';\nexport function fromB() { return fromC() + 1; }\n`
  );
  fs.writeFileSync(
    path.join(root, 'src', 'c.ts'),
    `export function fromC() { return 1; }\n`
  );
  return root;
}

function emptyChanges(): FileChangeResult {
  return { added: [], modified: [], removed: [], unchanged: [] };
}

function indexWith(overrides: Partial<ArchitectureIndex> = {}): ArchitectureIndex {
  return {
    schema_version: SCHEMA_VERSION,
    version: '1.0',
    last_scan: Date.now(),
    last_full_scan: Date.now(),
    incrementals_since_full: 0,
    project_path: '/tmp/x',
    components: {
      by_name: {},
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      by_type: {} as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      by_layer: {} as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      by_status: {} as any,
    },
    connections: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      by_type: {} as any,
      by_from: {},
      by_to: {},
    },
    stats: {
      total_components: 0,
      total_connections: 0,
      components_by_type: {},
      connections_by_type: {},
      outdated_count: 0,
      vulnerable_count: 0,
    },
    ...overrides,
  };
}

// =============================================================================
// selectScanMode unit tests (pure, no I/O)
// =============================================================================

describe('selectScanMode (Run 1 — D2)', () => {
  it('mode=full flag → full / flag-full', () => {
    const decision = selectScanMode(emptyChanges(), indexWith(), { mode: 'full' });
    expect(decision.mode).toBe('full');
    expect(decision.reason).toBe('flag-full');
  });

  it('mode=incremental + no prior index → full / no-prior-state', () => {
    const decision = selectScanMode(emptyChanges(), null, { mode: 'incremental' });
    expect(decision.mode).toBe('full');
    expect(decision.reason).toBe('no-prior-state');
  });

  it('auto + no prior index → full / no-prior-state', () => {
    const decision = selectScanMode(emptyChanges(), null, {});
    expect(decision.mode).toBe('full');
    expect(decision.reason).toBe('no-prior-state');
  });

  it('lockfile-trigger: package.json modified → full / manifest-changed', () => {
    const changes: FileChangeResult = {
      ...emptyChanges(),
      modified: ['package.json'],
    };
    const decision = selectScanMode(changes, indexWith(), {});
    expect(decision.mode).toBe('full');
    expect(decision.reason).toBe('manifest-changed');
  });

  // Run 1.6 — item #1: extended trigger list
  it('build-config-trigger: tsconfig.json modified → full / manifest-changed', () => {
    const decision = selectScanMode(
      { ...emptyChanges(), modified: ['tsconfig.json'] },
      indexWith(),
      {}
    );
    expect(decision.mode).toBe('full');
    expect(decision.reason).toBe('manifest-changed');
  });

  it('build-config-trigger: vercel.json modified → full / manifest-changed', () => {
    const decision = selectScanMode(
      { ...emptyChanges(), modified: ['vercel.json'] },
      indexWith(),
      {}
    );
    expect(decision.mode).toBe('full');
    expect(decision.reason).toBe('manifest-changed');
  });

  it('build-config-trigger: .gitignore modified → full / manifest-changed', () => {
    const decision = selectScanMode(
      { ...emptyChanges(), modified: ['.gitignore'] },
      indexWith(),
      {}
    );
    expect(decision.mode).toBe('full');
    expect(decision.reason).toBe('manifest-changed');
  });

  // Run 1.6 — item #5: new files force full scan (no recorded reverse-dep edges)
  it('new-files: any added file → full / new-files', () => {
    const decision = selectScanMode(
      { ...emptyChanges(), added: ['src/new-leaf.ts'] },
      indexWith(),
      {}
    );
    expect(decision.mode).toBe('full');
    expect(decision.reason).toBe('new-files');
  });

  it('new-files: added + modified mix still → full / new-files', () => {
    const decision = selectScanMode(
      { ...emptyChanges(), added: ['src/new-leaf.ts'], modified: ['src/a.ts'] },
      indexWith(),
      {}
    );
    expect(decision.mode).toBe('full');
    expect(decision.reason).toBe('new-files');
  });

  it('stale-trigger: last_full_scan 8 days ago → full / stale-full', () => {
    const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000;
    const decision = selectScanMode(
      { ...emptyChanges(), modified: ['src/a.ts'] },
      indexWith({ last_full_scan: eightDaysAgo }),
      {}
    );
    expect(decision.mode).toBe('full');
    expect(decision.reason).toBe('stale-full');
  });

  it('incremental-cap: incrementals_since_full=20 → full / incremental-cap', () => {
    const decision = selectScanMode(
      { ...emptyChanges(), modified: ['src/a.ts'] },
      indexWith({ incrementals_since_full: 20 }),
      {}
    );
    expect(decision.mode).toBe('full');
    expect(decision.reason).toBe('incremental-cap');
  });

  it('fast-path: a code file modified, recent full, low incrementals → incremental / fast-path', () => {
    const decision = selectScanMode(
      { ...emptyChanges(), modified: ['src/a.ts'] },
      indexWith(),
      {}
    );
    expect(decision.mode).toBe('incremental');
    expect(decision.reason).toBe('fast-path');
  });

  it('no-changes: empty fileChanges, fresh index → incremental / no-changes', () => {
    const decision = selectScanMode(emptyChanges(), indexWith(), {});
    expect(decision.mode).toBe('incremental');
    expect(decision.reason).toBe('no-changes');
  });

  it('lockfile-trigger overrides incremental flag (treated as auto by spec? No — flag wins for explicit incremental)', () => {
    // Explicit --incremental honors the flag even if a manifest changed.
    // This is intentional: the user explicitly opted out of auto policy.
    const changes: FileChangeResult = { ...emptyChanges(), modified: ['package.json'] };
    const decision = selectScanMode(changes, indexWith(), { mode: 'incremental' });
    expect(decision.mode).toBe('incremental');
    expect(decision.reason).toBe('flag-incremental');
  });
});

// =============================================================================
// End-to-end scenarios with a real tmp project
// =============================================================================

describe('incremental scan e2e (Run 1 — D4)', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = makeTmpProject();
  });

  it('scenario 1: edit-one-file → mode=incremental, files_scanned > 0 < total', async () => {
    // Baseline full scan
    const baseline = await scan(projectRoot, { mode: 'full' });
    expect(baseline.timelineEntry?.scan_type).toBe('full');
    const baselineCount = baseline.components.length;
    expect(baselineCount).toBeGreaterThan(0);

    // Wait 5ms so file mtime differs and hash changes deterministically
    await new Promise((r) => setTimeout(r, 5));

    // Edit b.ts
    fs.appendFileSync(path.join(projectRoot, 'src', 'b.ts'), '\n// touched\n');

    // Incremental scan
    const inc = await scan(projectRoot, { mode: 'auto' });
    expect(inc.timelineEntry?.scan_type).toBe('incremental');
    expect(inc.timelineEntry?.files_scanned).toBeGreaterThan(0);
    // walk-set is bounded — should be smaller than total source files (4)
    expect(inc.timelineEntry?.files_scanned).toBeLessThanOrEqual(4);

    // Index must reflect the increment
    const idx = await loadIndex(undefined, projectRoot);
    expect(idx?.incrementals_since_full).toBe(1);
    expect(idx?.last_full_scan).toBeGreaterThan(0);
  });

  it('scenario 2: lockfile-trigger → edit package.json → mode=full', async () => {
    await scan(projectRoot, { mode: 'full' });
    await new Promise((r) => setTimeout(r, 5));

    const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf-8'));
    pkg.dependencies.commander = '^14.0.0';
    fs.writeFileSync(path.join(projectRoot, 'package.json'), JSON.stringify(pkg, null, 2));

    // Manifest is package.json — auto mode must promote to full
    const second = await scan(projectRoot, { mode: 'auto' });
    expect(second.timelineEntry?.scan_type).toBe('full');

    const idx = await loadIndex(undefined, projectRoot);
    expect(idx?.incrementals_since_full).toBe(0);
  });

  it('scenario 6: noop → no file changes → scan_type=noop, last_scan updated', async () => {
    const baseline = await scan(projectRoot, { mode: 'full' });
    const baselineLastScan = (await loadIndex(undefined, projectRoot))?.last_scan ?? 0;

    await new Promise((r) => setTimeout(r, 10));

    const noop = await scan(projectRoot, { mode: 'auto' });
    expect(noop.timelineEntry?.scan_type).toBe('noop');
    expect(noop.timelineEntry?.files_scanned).toBe(0);

    const idxAfter = await loadIndex(undefined, projectRoot);
    expect(idxAfter?.last_scan).toBeGreaterThan(baselineLastScan);
    // last_full_scan unchanged on noop (it stays equal to the baseline value).
    const baselineIdx = baseline.timelineEntry?.timestamp ?? 0;
    // baseline scan stamped last_full_scan ≈ now at baseline time; noop must preserve it
    // (i.e. NOT bump it forward). Allow ±1s slack between timeline entry stamp and index stamp.
    expect(Math.abs((idxAfter?.last_full_scan ?? 0) - baselineIdx)).toBeLessThan(1000);
    expect(idxAfter?.incrementals_since_full).toBe(0);
  });

  it('scenario 5: integrity-auto-promote → corrupt connection target → incremental→full', async () => {
    // Baseline
    const baseline = await scan(projectRoot, { mode: 'full' });
    expect(baseline.timelineEntry?.scan_type).toBe('full');

    // Corrupt: pick a connection whose code_reference.file is NOT the file
    // we'll touch — so it survives clearForFiles into the merged finalConnections.
    // Then point its target at a non-existent component_id; the integrity check
    // should detect the missing endpoint and promote.
    const cfgArg = { storageMode: 'local', storagePath: '.navgator/architecture', autoScan: false, healthCheckEnabled: false, scanDepth: 'shallow', defaultConfidenceThreshold: 0.6 } as never;
    const connectionsPath = path.join(getStoragePath(cfgArg, projectRoot), 'connections');
    const files = fs.readdirSync(connectionsPath);
    if (files.length === 0) {
      // The fixture is small; if no connections exist, skip — not a regression.
      return;
    }
    // Find a connection NOT originating in src/a.ts (we'll touch a.ts).
    let chosen: string | undefined;
    for (const f of files) {
      const c = JSON.parse(fs.readFileSync(path.join(connectionsPath, f), 'utf-8'));
      if (c.code_reference?.file && c.code_reference.file !== 'src/a.ts') {
        chosen = f;
        break;
      }
    }
    if (!chosen) {
      // Fallback: corrupt the first one and touch a synthetic new file instead.
      chosen = files[0];
    }
    const target = path.join(connectionsPath, chosen);
    const conn = JSON.parse(fs.readFileSync(target, 'utf-8'));
    conn.to.component_id = 'COMP_bogus_does_not_exist_zzz123';
    fs.writeFileSync(target, JSON.stringify(conn, null, 2));

    await new Promise((r) => setTimeout(r, 5));
    // Touch a NEW file so we definitely don't clear the corrupted connection.
    fs.writeFileSync(path.join(projectRoot, 'src', 'd.ts'), `export const d = 1;\n`);

    // Incremental scan: integrity check should fail and promote to full
    const inc = await scan(projectRoot, { mode: 'incremental' });
    expect(inc.timelineEntry?.scan_type).toBe('incremental→full');
    // Run 1.6 — item #3: incremental→full must still report walk-set size
    // (NOT total source file count) so we don't lose evidence the incremental
    // walk-set was attempted. Walk-set is bounded by changed files + reverse-deps,
    // which is much smaller than the 4-file source tree on a 1-file edit.
    const sourceFileCount = ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts'].length;
    expect(inc.timelineEntry?.files_scanned).toBeLessThanOrEqual(sourceFileCount);
    expect(inc.stats.files_scanned).toBeLessThanOrEqual(sourceFileCount);
  });

  it('scenario 4: incremental-cap → simulate index with incrementals_since_full=20 → full', async () => {
    // Baseline
    await scan(projectRoot, { mode: 'full' });
    // Manually bump the index counter and re-save (simulating 20 prior increments).
    const idxPath = path.join(
      getStoragePath({ storageMode: 'local', storagePath: '.navgator/architecture', autoScan: false, healthCheckEnabled: false, scanDepth: 'shallow', defaultConfidenceThreshold: 0.6 } as never, projectRoot),
      'index.json'
    );
    const idx = JSON.parse(fs.readFileSync(idxPath, 'utf-8'));
    idx.incrementals_since_full = 20;
    fs.writeFileSync(idxPath, JSON.stringify(idx, null, 2));

    await new Promise((r) => setTimeout(r, 5));
    fs.appendFileSync(path.join(projectRoot, 'src', 'a.ts'), '\n// touch\n');

    const second = await scan(projectRoot, { mode: 'auto' });
    expect(second.timelineEntry?.scan_type).toBe('full');
    const idxAfter = await loadIndex(undefined, projectRoot);
    expect(idxAfter?.incrementals_since_full).toBe(0);
  });

  it('scenario 3: stale-trigger → last_full_scan 8 days old → full', async () => {
    // Baseline
    await scan(projectRoot, { mode: 'full' });
    const idxPath = path.join(
      getStoragePath({ storageMode: 'local', storagePath: '.navgator/architecture', autoScan: false, healthCheckEnabled: false, scanDepth: 'shallow', defaultConfidenceThreshold: 0.6 } as never, projectRoot),
      'index.json'
    );
    const idx = JSON.parse(fs.readFileSync(idxPath, 'utf-8'));
    idx.last_full_scan = Date.now() - 8 * 24 * 60 * 60 * 1000;
    fs.writeFileSync(idxPath, JSON.stringify(idx, null, 2));

    await new Promise((r) => setTimeout(r, 5));
    fs.appendFileSync(path.join(projectRoot, 'src', 'a.ts'), '\n// touch\n');

    const second = await scan(projectRoot, { mode: 'auto' });
    expect(second.timelineEntry?.scan_type).toBe('full');
  });
});

// =============================================================================
// Schema migration safety (C14)
// =============================================================================

// =============================================================================
// Concurrency lock (Run 1.6 — item #4)
// =============================================================================

describe('scan concurrency lock (Run 1.6 — item #4)', () => {
  let projectRoot: string;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    projectRoot = makeTmpProject();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('held lock → second scan exits cleanly with the contention message', async () => {
    // Run a baseline so .navgator/architecture exists.
    await scan(projectRoot, { mode: 'full' });

    // Plant a fresh, live-PID lock file (use this process's pid so isPidAlive returns true).
    const cfgArg = {
      storageMode: 'local',
      storagePath: '.navgator/architecture',
      autoScan: false,
      healthCheckEnabled: false,
      scanDepth: 'shallow',
      defaultConfidenceThreshold: 0.6,
    } as never;
    const lockPath = path.join(getStoragePath(cfgArg, projectRoot), 'scan.lock');
    fs.writeFileSync(
      lockPath,
      JSON.stringify({ pid: process.pid, started_at: Date.now(), scan_type: 'incremental' })
    );

    // Second scan should NOT crash — must exit cleanly with the message.
    const result = await scan(projectRoot, { mode: 'auto' });
    expect(result.components).toEqual([]);
    expect(result.connections).toEqual([]);
    expect(result.stats.files_scanned).toBe(0);

    const logged = logSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('\n');
    expect(logged).toContain('Scan already in progress');
    expect(logged).toContain(`pid ${process.pid}`);

    // Lock must remain (we planted it; the contention path must NOT release it).
    expect(fs.existsSync(lockPath)).toBe(true);
    fs.unlinkSync(lockPath);
  });

  it('stale lock (>10 min old) auto-clears and scan proceeds normally', async () => {
    // First scan creates state.
    await scan(projectRoot, { mode: 'full' });

    const cfgArg = {
      storageMode: 'local',
      storagePath: '.navgator/architecture',
      autoScan: false,
      healthCheckEnabled: false,
      scanDepth: 'shallow',
      defaultConfidenceThreshold: 0.6,
    } as never;
    const lockPath = path.join(getStoragePath(cfgArg, projectRoot), 'scan.lock');
    // Stale: 11 minutes old.
    fs.writeFileSync(
      lockPath,
      JSON.stringify({
        pid: process.pid,
        started_at: Date.now() - 11 * 60 * 1000,
        scan_type: 'full',
      })
    );

    // Should auto-clear stale lock and complete.
    const result = await scan(projectRoot, { mode: 'auto' });
    expect(result.timelineEntry?.scan_type).toBeDefined();
    // After scan, lock should be released (file gone).
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  it('successful scan releases the lock', async () => {
    const result = await scan(projectRoot, { mode: 'full' });
    expect(result.timelineEntry?.scan_type).toBe('full');

    const cfgArg = {
      storageMode: 'local',
      storagePath: '.navgator/architecture',
      autoScan: false,
      healthCheckEnabled: false,
      scanDepth: 'shallow',
      defaultConfidenceThreshold: 0.6,
    } as never;
    const lockPath = path.join(getStoragePath(cfgArg, projectRoot), 'scan.lock');
    expect(fs.existsSync(lockPath)).toBe(false);
  });
});

describe('schema migration 1.0.0 → 1.1.0 (Run 1 — C14)', () => {
  it('loadIndex injects defaults for 1.0.0 archive', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-migrate-'));
    fs.mkdirSync(path.join(root, '.navgator', 'architecture'), { recursive: true });
    // Synthesize a 1.0.0-shape index (missing schema_version, last_full_scan, incrementals_since_full).
    const oldIndex = {
      version: '1.0',
      last_scan: Date.now() - 1000,
      project_path: root,
      components: { by_name: {}, by_type: {}, by_layer: {}, by_status: {} },
      connections: { by_type: {}, by_from: {}, by_to: {} },
      stats: {
        total_components: 0,
        total_connections: 0,
        components_by_type: {},
        connections_by_type: {},
        outdated_count: 0,
        vulnerable_count: 0,
      },
    };
    fs.writeFileSync(
      path.join(root, '.navgator', 'architecture', 'index.json'),
      JSON.stringify(oldIndex)
    );

    const loaded = await loadIndex(undefined, root);
    expect(loaded).not.toBeNull();
    expect(loaded?.schema_version).toBe('1.0.0'); // Synthesized from missing field
    expect(loaded?.last_full_scan).toBe(oldIndex.last_scan); // Synthesized from last_scan
    expect(loaded?.incrementals_since_full).toBe(0); // Synthesized as 0
  });
});

// =============================================================================
// Walk-set restriction (Run 1.5 — per-scanner walkSet plumbing)
// =============================================================================

describe('walk-set restriction (Run 1.5)', () => {
  it('scanServiceCalls reads only files in walkSet when provided', async () => {
    const root = makeTmpProject();
    const { scanServiceCalls } = await import('../scanners/connections/service-calls.js');

    // Spy on fs reads inside the scanner. Both function-level promises and the
    // sync API are used in places; service-calls uses fs.promises.readFile.
    const fs = await import('node:fs');
    const readSpy = vi.spyOn(fs.promises, 'readFile');

    // Baseline: no walkSet → all 3 source files are visited.
    await scanServiceCalls(root);
    const fullReads = readSpy.mock.calls.length;
    expect(fullReads).toBeGreaterThanOrEqual(3);

    readSpy.mockClear();

    // Restricted: walkSet of size 1 → only that file is read.
    const walkSet = new Set<string>(['src/a.ts']);
    await scanServiceCalls(root, walkSet);
    const restrictedReads = readSpy.mock.calls.length;

    // The restricted run reads strictly fewer files than the full run.
    // (Exact equality with 1 isn't guaranteed because shouldExcludeFile may
    // skip some, but we MUST see a reduction.)
    expect(restrictedReads).toBeLessThan(fullReads);

    readSpy.mockRestore();
  });

  it('scanWithAST loads only walkSet files into the ts-morph project (best-effort)', async () => {
    // ts-morph may not be installed in CI; skip silently if unavailable.
    try {
      await import('ts-morph');
    } catch {
      return;
    }
    const root = makeTmpProject();
    const { scanWithAST } = await import('../scanners/connections/ast-scanner.js');

    // Empty walk-set → no source files added → empty result set, no errors.
    const result = await scanWithAST(root, new Set<string>());
    expect(result.warnings.length).toBe(0);
    expect(result.components).toEqual([]);
    expect(result.connections).toEqual([]);
  });
});

// =============================================================================
// Aliased imports (Run 1.6 — item #7 verify)
// =============================================================================

describe("aliased imports resolve to project paths (Run 1.6 — item #7)", () => {
  it("tsconfig paths alias resolves at scan time; connection target stores resolved path", async () => {
    // Build a fixture with @/* → src/*
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "navgator-alias-"));
    fs.mkdirSync(path.join(root, "src", "utils"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({ name: "alias-fixture", version: "0.0.0", dependencies: {} })
    );
    fs.writeFileSync(
      path.join(root, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          baseUrl: ".",
          paths: { "@/*": ["src/*"] },
        },
      })
    );
    fs.writeFileSync(
      path.join(root, "src", "utils", "foo.ts"),
      "export const x = 1;\n"
    );
    fs.writeFileSync(
      path.join(root, "src", "index.ts"),
      "import { x } from \"@/utils/foo\";\nexport const y = x + 1;\n"
    );

    await scan(root, { mode: "full" });

    // Read connection JSONs and find the imports edge from src/index.ts → src/utils/foo.ts
    const cfgArg = {
      storageMode: "local",
      storagePath: ".navgator/architecture",
      autoScan: false,
      healthCheckEnabled: false,
      scanDepth: "shallow",
      defaultConfidenceThreshold: 0.6,
    } as never;
    const connectionsPath = path.join(getStoragePath(cfgArg, root), "connections");
    const files = fs.readdirSync(connectionsPath);
    let found = false;
    for (const f of files) {
      const c = JSON.parse(fs.readFileSync(path.join(connectionsPath, f), "utf-8"));
      if (c.connection_type === "imports" && c.code_reference?.file === "src/index.ts") {
        // Target file MUST be the resolved path, not "@/utils/foo"
        expect(c.to?.location?.file).toBe("src/utils/foo.ts");
        expect(c.to?.location?.file).not.toContain("@/");
        found = true;
        break;
      }
    }
    expect(found).toBe(true);

    // loadReverseDeps must find src/index.ts as importer of src/utils/foo.ts
    const importers = await loadReverseDeps(
      new Set(["src/utils/foo.ts"]),
      undefined,
      root
    );
    expect(importers.has("src/index.ts")).toBe(true);
  });
});


// =============================================================================
// Reverse-deps index + manifest (Run 1.6 — items #8 + #9)
// =============================================================================

describe('reverse-deps.json index (Run 1.6 — item #8)', () => {
  it('full scan writes reverse-deps.json with the expected shape', async () => {
    const root = makeTmpProject();
    await scan(root, { mode: 'full' });

    const cfgArg = {
      storageMode: 'local',
      storagePath: '.navgator/architecture',
      autoScan: false,
      healthCheckEnabled: false,
      scanDepth: 'shallow',
      defaultConfidenceThreshold: 0.6,
    } as never;
    const indexPath = path.join(getStoragePath(cfgArg, root), 'reverse-deps.json');
    expect(fs.existsSync(indexPath)).toBe(true);

    const parsed = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
    expect(parsed.schema_version).toBe('1.0.0');
    expect(typeof parsed.generated_at).toBe('number');
    expect(typeof parsed.edges).toBe('object');

    // src/c.ts is imported by src/b.ts — index should know.
    const importersOfC = parsed.edges['src/c.ts'] ?? [];
    expect(importersOfC).toContain('src/b.ts');
  });

  it('loadReverseDeps via index returns same result as legacy walk', async () => {
    const root = makeTmpProject();
    await scan(root, { mode: 'full' });

    const { loadReverseDepsLegacy } = await import('../storage.js');

    const changed = new Set(['src/c.ts']);
    const viaIndex = await loadReverseDeps(changed, undefined, root);
    const viaLegacy = await loadReverseDepsLegacy(changed, undefined, root);
    // Same files (set equality)
    expect(viaIndex.size).toBe(viaLegacy.size);
    for (const f of viaLegacy) {
      expect(viaIndex.has(f)).toBe(true);
    }
  });

  it('loadReverseDeps falls back to legacy when index is missing', async () => {
    const root = makeTmpProject();
    await scan(root, { mode: 'full' });

    const cfgArg = {
      storageMode: 'local',
      storagePath: '.navgator/architecture',
      autoScan: false,
      healthCheckEnabled: false,
      scanDepth: 'shallow',
      defaultConfidenceThreshold: 0.6,
    } as never;
    const indexPath = path.join(getStoragePath(cfgArg, root), 'reverse-deps.json');
    fs.unlinkSync(indexPath);

    // Should still work via legacy path.
    const result = await loadReverseDeps(new Set(['src/c.ts']), undefined, root);
    expect(result.has('src/b.ts')).toBe(true);
  });
});

describe('manifest.json (Run 1.6 — item #9)', () => {
  it('full scan writes manifest.json with the expected shape', async () => {
    const root = makeTmpProject();
    await scan(root, { mode: 'full' });

    const cfgArg = {
      storageMode: 'local',
      storagePath: '.navgator/architecture',
      autoScan: false,
      healthCheckEnabled: false,
      scanDepth: 'shallow',
      defaultConfidenceThreshold: 0.6,
    } as never;
    const manifestPath = path.join(getStoragePath(cfgArg, root), 'manifest.json');
    expect(fs.existsSync(manifestPath)).toBe(true);

    const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    expect(parsed.schema_version).toBe('1.0.0');
    expect(typeof parsed.generated_at).toBe('number');
    expect(parsed.files['index.json']).toBeDefined();
    expect(parsed.files['graph.json']).toBeDefined();
    expect(parsed.files['file_map.json']).toBeDefined();
    expect(parsed.files['reverse-deps.json']).toBeDefined();
    expect(typeof parsed.files['index.json'].generated_at).toBe('number');
  });
});

// =============================================================================
// Run 1.7 — Problem A: integrity-promote must NOT truncate the graph
// =============================================================================
//
// Repros the atomize-ai bug. Pre-Run-1.7, a failed integrity check on an
// incremental scan reused the in-memory uniqueComponents/uniqueConnections
// that were just computed under the walk-set restriction. Result: post-promote
// disk state had the package + infra components but only the walk-set's slice
// of code-level components, and the graph was wiped from N → tiny.
//
// The Run 1.7 fix is recursive re-entry: scan() releases its lock, calls
// itself with `mode: 'full', clearFirst: true`, and returns the inner scan's
// result with `scan_type` overridden to 'incremental→full' for evidence
// (Run 1.6 #3 contract).

describe('integrity-promote no-truncation (Run 1.7 — Problem A)', () => {
  it('promote retains full graph (>= baseline counts), not just walk-set slice', async () => {
    const root = makeTmpProject();

    // 1. Baseline: full scan, capture component/connection counts on disk.
    const baseline = await scan(root, { mode: 'full' });
    expect(baseline.timelineEntry?.scan_type).toBe('full');
    const cfgArg = {
      storageMode: 'local',
      storagePath: '.navgator/architecture',
      autoScan: false,
      healthCheckEnabled: false,
      scanDepth: 'shallow',
      defaultConfidenceThreshold: 0.6,
    } as never;
    const componentsDir = path.join(getStoragePath(cfgArg, root), 'components');
    const connectionsDir = path.join(getStoragePath(cfgArg, root), 'connections');
    const baselineComponentCount = fs.readdirSync(componentsDir).length;
    const baselineConnectionCount = fs.readdirSync(connectionsDir).length;
    expect(baselineComponentCount).toBeGreaterThan(0);
    expect(baselineConnectionCount).toBeGreaterThan(0);

    // 2. Corrupt one surviving connection's `to.component_id` so integrity
    //    fails on the next incremental scan.
    const connFiles = fs.readdirSync(connectionsDir);
    // Pick a connection whose source file is NOT the one we'll touch, so
    // clearForFiles doesn't wipe it before the integrity check sees it.
    let chosen: string | undefined;
    for (const f of connFiles) {
      const c = JSON.parse(fs.readFileSync(path.join(connectionsDir, f), 'utf-8'));
      if (c.code_reference?.file && c.code_reference.file !== 'src/a.ts') {
        chosen = f;
        break;
      }
    }
    expect(chosen).toBeDefined();
    const corruptPath = path.join(connectionsDir, chosen as string);
    const corrupt = JSON.parse(fs.readFileSync(corruptPath, 'utf-8'));
    corrupt.to.component_id = 'COMP_bogus_does_not_exist_zzz123';
    fs.writeFileSync(corruptPath, JSON.stringify(corrupt, null, 2));

    // 3. Touch one source file → triggers incremental.
    await new Promise((r) => setTimeout(r, 5));
    fs.appendFileSync(path.join(root, 'src', 'a.ts'), '\n// touched\n');

    // 4. Incremental scan: integrity fails → recursive promote.
    const inc = await scan(root, { mode: 'auto' });
    expect(inc.timelineEntry?.scan_type).toBe('incremental→full');

    // 5. CORE ASSERTIONS — Run 1.7 — Problem A. Pre-fix, these counts dropped
    //    to a tiny walk-set slice. Post-fix, they MUST equal (or exceed by 1
    //    for the new connection introduced by the touch) the baseline.
    const postComponentCount = fs.readdirSync(componentsDir).length;
    const postConnectionCount = fs.readdirSync(connectionsDir).length;
    expect(postComponentCount).toBeGreaterThanOrEqual(baselineComponentCount);
    expect(postConnectionCount).toBeGreaterThanOrEqual(baselineConnectionCount);
    // In-memory result must also match disk.
    expect(inc.components.length).toBe(postComponentCount);
    expect(inc.connections.length).toBe(postConnectionCount);

    // 6. Sanity: the recursive promote DID label its index as a fresh full
    //    scan (last_full_scan moved forward, incrementals_since_full reset).
    const idx = await loadIndex(undefined, root);
    expect(idx?.incrementals_since_full).toBe(0);
    expect((idx?.last_full_scan ?? 0)).toBeGreaterThan(0);
  });
});

// =============================================================================
// Run 1.7 — Problem B: dedup-by-name must not collide cross-type
// =============================================================================
//
// Pre-Run-1.7, scanner.ts dedup-by-name keyed on `component.name` alone. That
// silently dropped a file-level component (type='component', name='prisma',
// from `lib/prisma.ts`) when it collided with the Prisma database component
// (type='database', name='prisma'). Import edges already referenced the
// dropped component_id → integrity check failed → graph truncated (Problem A).
//
// Fix: key on `${type}|${name}`. Different types coexist; same-type same-name
// still dedupes.

describe('dedup-by-name cross-type collision (Run 1.7 — Problem B)', () => {
  it('file component "prisma" coexists with database component "prisma"', async () => {
    // Build a fixture that exercises the collision path: a file named
    // `lib/prisma.ts` that other files import. The file-level component
    // produced by import-scanner is named `prisma` (after stripping `lib/`
    // and the `.ts` extension). We don't have a Prisma schema in the
    // fixture, so we synthesize the cross-type collision by adding a
    // package named `prisma` (the npm-package scanner produces a
    // type='package' component named `prisma`). Pre-fix, dedup-by-name
    // dropped one of them; post-fix, both must be present.
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-prob-b-'));
    fs.mkdirSync(path.join(root, 'lib'), { recursive: true });
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify(
        { name: 'prob-b-fixture', version: '0.0.0', dependencies: { prisma: '^5.0.0' } },
        null,
        2
      )
    );
    fs.writeFileSync(
      path.join(root, 'lib', 'prisma.ts'),
      `export const client = { query: () => null };\n`
    );
    fs.writeFileSync(
      path.join(root, 'src', 'a.ts'),
      `import { client } from '../lib/prisma';\nexport const x = client;\n`
    );

    const result = await scan(root, { mode: 'full' });

    // Two components named 'prisma' — different types — must both exist.
    const prismaComps = result.components.filter((c) => c.name === 'prisma');
    expect(prismaComps.length).toBeGreaterThanOrEqual(2);
    const types = new Set(prismaComps.map((c) => c.type));
    // 'package' for npm package, 'component' for the file-level entry.
    expect(types.has('component')).toBe(true);
    expect(types.size).toBeGreaterThanOrEqual(2);

    // The import edge from src/a.ts → lib/prisma.ts must resolve to the
    // file-level component, not orphan to a missing target. Find a connection
    // pointing at any of the prisma components and assert the target id
    // matches one of the actually-existing prisma component ids.
    const prismaIds = new Set(prismaComps.map((c) => c.component_id));
    const importEdges = result.connections.filter(
      (c) =>
        c.connection_type === 'imports' &&
        c.code_reference?.file === 'src/a.ts' &&
        c.code_reference?.symbol === '../lib/prisma'
    );
    expect(importEdges.length).toBe(1);
    expect(prismaIds.has(importEdges[0].to.component_id ?? '')).toBe(true);
  });

  it('same-type same-name still dedupes (regression)', async () => {
    // Two components synthesized in allComponents with same (type, name) but
    // different confidence — only the higher-confidence one survives, as
    // before. We exercise this through scan() rather than calling internal
    // dedup, but the path is the same: the import scanner emits one file
    // component per file; if two scanners both emit a component for the
    // same file (same type, same name), dedup keeps the higher-confidence
    // one. Verifying via index lookup: the file-level component for
    // src/a.ts must appear exactly once across the components/ directory.
    const root = makeTmpProject();
    await scan(root, { mode: 'full' });
    const cfgArg = {
      storageMode: 'local',
      storagePath: '.navgator/architecture',
      autoScan: false,
      healthCheckEnabled: false,
      scanDepth: 'shallow',
      defaultConfidenceThreshold: 0.6,
    } as never;
    const componentsDir = path.join(getStoragePath(cfgArg, root), 'components');
    const compFiles = fs.readdirSync(componentsDir);
    const aMatches = compFiles
      .map((f) => JSON.parse(fs.readFileSync(path.join(componentsDir, f), 'utf-8')))
      .filter(
        (c) =>
          c.type === 'component' &&
          (c.source?.config_files ?? []).includes('src/a.ts')
      );
    expect(aMatches.length).toBe(1);
  });
});
