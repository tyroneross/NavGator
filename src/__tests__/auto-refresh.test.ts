/**
 * R6 auto-refresh: read entrypoints should run an incremental scan when
 * the on-disk graph is stale.
 *
 * Verified-stale evidence (atomize-ai, 2026-05): graph last scanned
 * 2026-04-13 stayed stale across dozens of MCP read calls — callers got
 * a graph that didn't reflect any source change in 30+ days. The fix
 * wires `autoRefreshIfStale` into MCP `status` and CLI `status`; this
 * test locks in the helper's contract.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { autoRefreshIfStale, scan } from '../scanner.js';
import { getStoragePath } from '../config.js';
import { markDirty, readDirty } from '../freshness/dirty-ledger.js';
import { drain } from '../freshness/drainer.js';
import { loadAllConnections } from '../storage.js';
import type { NavGatorConfig } from '../types.js';

function tmpProjectRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-r6-auto-'));
}

function baseConfig(): NavGatorConfig {
  return {
    storageMode: 'local',
    storagePath: '.navgator/architecture',
    autoScan: false,
    healthCheckEnabled: false,
    scanDepth: 'shallow',
    defaultConfidenceThreshold: 0.6,
    maxResultsPerQuery: 20,
  };
}

function writeStubIndex(root: string, lastScanMs: number): void {
  const dir = getStoragePath(baseConfig(), root);
  fs.mkdirSync(dir, { recursive: true });
  const index = {
    schema_version: '1.1.0',
    last_scan: lastScanMs,
    last_full_scan: lastScanMs,
    incrementals_since_full: 0,
    stats: {
      total_components: 0,
      total_connections: 0,
      components_by_type: {},
      components_by_layer: {},
      outdated_count: 0,
      vulnerable_count: 0,
    },
  };
  fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify(index, null, 2));
}

function writeImportFixture(root: string): void {
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ name: 'auto-refresh-fixture', version: '0.0.0', dependencies: {} }),
  );
  fs.writeFileSync(
    path.join(root, 'src', 'a.ts'),
    `import { fromB } from './b';\nexport const fromA = () => fromB();\n`,
  );
  fs.writeFileSync(
    path.join(root, 'src', 'b.ts'),
    `export const fromB = () => 1;\n`,
  );
}

describe('R6 — autoRefreshIfStale', () => {
  let root: string;

  beforeEach(() => {
    root = tmpProjectRoot();
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('returns reason=no-index when nothing has ever been scanned', async () => {
    const spy = vi.fn();
    const result = await autoRefreshIfStale(root, {
      // Provide a typed cast; we never invoke this because the no-index branch
      // short-circuits before reaching the scanner.
      scanImpl: spy as unknown as typeof scan,
    });

    expect(result.refreshed).toBe(false);
    expect(result.reason).toBe('no-index');
    expect(spy).not.toHaveBeenCalled();
  });

  it('returns reason=fresh and does NOT scan when index is fresh', async () => {
    writeStubIndex(root, Date.now() - 30_000); // 30 seconds ago — fresh
    const spy = vi.fn();
    const result = await autoRefreshIfStale(root, {
      staleAfterMinutes: 5,
      scanImpl: spy as unknown as typeof scan,
    });

    expect(result.refreshed).toBe(false);
    expect(result.reason).toBe('fresh');
    expect(spy).not.toHaveBeenCalled();
  });

  it('dispatches incremental scan when index is stale', async () => {
    writeStubIndex(root, Date.now() - 10 * 60 * 1000); // 10 minutes ago — stale
    const spy = vi
      .fn()
      .mockResolvedValue({
        status: 'completed',
        retryable: false,
        components: [],
        connections: [],
        warnings: [],
        fileChanges: { added: ['src/new.ts'], modified: ['src/changed.ts'], removed: [], unchanged: [] },
        stats: {
          scan_duration_ms: 1,
          files_scanned: 0,
          components_found: 0,
          connections_found: 0,
          warnings_count: 0,
        },
      } as never);

    const result = await autoRefreshIfStale(root, {
      staleAfterMinutes: 5,
      scanImpl: spy as unknown as typeof scan,
    });

    expect(result.refreshed).toBe(true);
    expect(result.reason).toBe('stale');
    expect(result.filesChanged).toBe(2);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(
      root,
      expect.objectContaining({
        mode: 'auto',
        _beforeLeaseRelease: expect.any(Function),
      }),
    );
    expect(result.message).toContain('refreshed');
  });

  it('reports 0 file changes when stale-but-nothing-actually-moved', async () => {
    writeStubIndex(root, Date.now() - 10 * 60 * 1000);
    const spy = vi
      .fn()
      .mockResolvedValue({
        components: [],
        connections: [],
        warnings: [],
        // No fileChanges field — no-changes fast path.
        stats: {
          scan_duration_ms: 1,
          files_scanned: 0,
          components_found: 0,
          connections_found: 0,
          warnings_count: 0,
        },
      } as never);

    const result = await autoRefreshIfStale(root, {
      staleAfterMinutes: 5,
      scanImpl: spy as unknown as typeof scan,
    });

    expect(result.refreshed).toBe(true);
    expect(result.filesChanged).toBe(0);
    expect(result.message).toContain('no file changes');
  });

  it('honours opt-out via enabled=false (programmatic)', async () => {
    writeStubIndex(root, Date.now() - 10 * 60 * 1000); // stale
    const spy = vi.fn();
    const result = await autoRefreshIfStale(root, {
      enabled: false,
      scanImpl: spy as unknown as typeof scan,
    });

    expect(result.refreshed).toBe(false);
    expect(result.reason).toBe('disabled');
    expect(spy).not.toHaveBeenCalled();
  });

  it('honours opt-out via env NAVGATOR_AUTO_REFRESH=false', async () => {
    writeStubIndex(root, Date.now() - 10 * 60 * 1000);
    const prev = process.env['NAVGATOR_AUTO_REFRESH'];
    process.env['NAVGATOR_AUTO_REFRESH'] = 'false';
    try {
      const spy = vi.fn();
      const result = await autoRefreshIfStale(root, {
        scanImpl: spy as unknown as typeof scan,
      });
      expect(result.refreshed).toBe(false);
      expect(result.reason).toBe('disabled');
      expect(spy).not.toHaveBeenCalled();
    } finally {
      if (prev === undefined) delete process.env['NAVGATOR_AUTO_REFRESH'];
      else process.env['NAVGATOR_AUTO_REFRESH'] = prev;
    }
  });

  it('programmatic enabled=true overrides env opt-out', async () => {
    writeStubIndex(root, Date.now() - 10 * 60 * 1000);
    const prev = process.env['NAVGATOR_AUTO_REFRESH'];
    process.env['NAVGATOR_AUTO_REFRESH'] = 'false';
    try {
      const spy = vi
        .fn()
        .mockResolvedValue({
          components: [],
          connections: [],
          warnings: [],
          stats: {
            scan_duration_ms: 1,
            files_scanned: 0,
            components_found: 0,
            connections_found: 0,
            warnings_count: 0,
          },
        } as never);
      const result = await autoRefreshIfStale(root, {
        enabled: true,
        scanImpl: spy as unknown as typeof scan,
      });
      expect(result.refreshed).toBe(true);
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      if (prev === undefined) delete process.env['NAVGATOR_AUTO_REFRESH'];
      else process.env['NAVGATOR_AUTO_REFRESH'] = prev;
    }
  });

  it('does not throw when scan fails — returns reason=error', async () => {
    writeStubIndex(root, Date.now() - 10 * 60 * 1000);
    const spy = vi.fn().mockRejectedValue(new Error('disk full'));
    const result = await autoRefreshIfStale(root, {
      scanImpl: spy as unknown as typeof scan,
    });
    expect(result.refreshed).toBe(false);
    expect(result.reason).toBe('error');
    expect(result.message).toContain('disk full');
  });

  it('reports retryable busy without clearing the dirty ledger', async () => {
    writeStubIndex(root, Date.now() - 10 * 60 * 1000);
    markDirty(['src/pending.ts'], root);
    const spy = vi.fn().mockResolvedValue({
      status: 'busy',
      retryable: true,
      message: 'Scan already in progress (pid 42)',
      components: [],
      connections: [],
      warnings: [],
      stats: {
        scan_duration_ms: 1,
        files_scanned: 0,
        files_changed: 0,
        components_found: 0,
        connections_found: 0,
        warnings_count: 0,
      },
    } as never);

    const result = await autoRefreshIfStale(root, {
      staleAfterMinutes: 5,
      scanImpl: spy as unknown as typeof scan,
    });

    expect(result).toMatchObject({ refreshed: false, reason: 'busy' });
    expect(result.message).toContain('Scan already in progress');
    expect(readDirty(root)).toEqual(['src/pending.ts']);
  });

  it('forces captured dirty paths when hashes already contain a late edit', async () => {
    writeImportFixture(root);
    await scan(root, { mode: 'full' });
    markDirty(['src/a.ts'], root);
    let injectLateEdit = true;

    const first = await drain(root, {
      minIntervalMs: 0,
      scanFn: async (scanRoot, changed, lifecycle) => scan(scanRoot, {
        mode: 'incremental',
        _forcedChangedFiles: changed,
        _onLeaseAcquired: lifecycle.onLeaseAcquired,
        _beforeLeaseRelease: lifecycle.beforeLeaseRelease,
        _onLeaseFailureBeforeRelease: lifecycle.onLeaseFailureBeforeRelease,
        _beforeHashSave: injectLateEdit
          ? async () => {
              injectLateEdit = false;
              fs.writeFileSync(
                path.join(root, 'src', 'a.ts'),
                `export const fromA = () => 2;\n`,
              );
              markDirty(['src/a.ts'], root);
            }
          : undefined,
      }),
    });

    expect(first.status).toBe('drained');
    expect(readDirty(root)).toEqual(['src/a.ts']);
    expect((await loadAllConnections(undefined, root)).some(
      (connection) =>
        connection.connection_type === 'imports' &&
        connection.code_reference?.file === 'src/a.ts' &&
        connection.code_reference?.symbol === './b',
    )).toBe(true);

    const refreshed = await autoRefreshIfStale(root, { staleAfterMinutes: 0 });

    expect(refreshed).toMatchObject({ refreshed: true, reason: 'stale' });
    expect(readDirty(root)).toEqual([]);
    expect((await loadAllConnections(undefined, root)).some(
      (connection) =>
        connection.connection_type === 'imports' &&
        connection.code_reference?.file === 'src/a.ts' &&
        connection.code_reference?.symbol === './b',
    )).toBe(false);
  });

  it('uses auto mode so stale refresh honors tsconfig full-scan triggers', async () => {
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({ name: 'auto-alias-fixture', version: '0.0.0', dependencies: {} }),
    );
    fs.writeFileSync(
      path.join(root, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@/*': ['src/*'] } } }),
    );
    fs.writeFileSync(path.join(root, 'src', 'b.ts'), 'export const b = 1;\n');
    fs.writeFileSync(
      path.join(root, 'src', 'a.ts'),
      "import { b } from '@/b';\nexport const a = b;\n",
    );
    await scan(root, { mode: 'full' });
    expect((await loadAllConnections(undefined, root)).some(
      (connection) =>
        connection.connection_type === 'imports' &&
        connection.code_reference?.symbol === '@/b',
    )).toBe(true);

    fs.writeFileSync(
      path.join(root, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '#/*': ['src/*'] } } }),
    );
    markDirty(['tsconfig.json'], root);
    const refreshed = await autoRefreshIfStale(root, { staleAfterMinutes: 0 });

    expect(refreshed).toMatchObject({ refreshed: true, reason: 'stale' });
    expect(readDirty(root)).toEqual([]);
    expect((await loadAllConnections(undefined, root)).some(
      (connection) =>
        connection.connection_type === 'imports' &&
        connection.code_reference?.symbol === '@/b',
    )).toBe(false);
  });

  // f3: in-process debounce — a second call within staleAfterMs of the FIRST
  // ATTEMPT must not dispatch a second scan even if the index age still reads
  // as stale (the first scan hasn't completed / written a new index yet).
  it('f3 debounce: second immediate call with stale index invokes scanImpl exactly once', async () => {
    writeStubIndex(root, Date.now() - 10 * 60 * 1000); // 10 min stale

    let resolveScan!: () => void;
    const scanStarted = new Promise<void>((r) => { resolveScan = r; });
    const spy = vi.fn().mockImplementation(async () => {
      resolveScan();
      // Simulate scan taking a while — but we won't await completion in this test.
      return {
        components: [], connections: [], warnings: [],
        stats: { scan_duration_ms: 1, files_scanned: 0, components_found: 0, connections_found: 0, warnings_count: 0 },
      };
    });

    // Fire both calls without waiting; both see the stale index.
    const [r1, r2] = await Promise.all([
      autoRefreshIfStale(root, { staleAfterMinutes: 5, scanImpl: spy as unknown as typeof scan }),
      autoRefreshIfStale(root, { staleAfterMinutes: 5, scanImpl: spy as unknown as typeof scan }),
    ]);

    // One call scans; the other sees the debounce and returns 'fresh' (in-flight guard).
    const scanCount = spy.mock.calls.length;
    expect(scanCount).toBe(1);
    // The debounced call must not claim it refreshed.
    const debounced = [r1, r2].find((r) => !r.refreshed);
    expect(debounced).toBeDefined();
    expect(debounced!.reason).toBe('fresh');
  });
});
