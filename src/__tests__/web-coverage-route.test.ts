import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { loadArchitectureRecords } from '../../web/lib/server/architecture-storage.js';
import {
  computeCoverage as webComputeCoverage,
  isRegisteredProjectPath,
  setBoundedCacheEntry,
} from '../../web/lib/server/coverage.js';
import { computeCoverage as cliComputeCoverage } from '../coverage.js';
import { rejectNonLoopback, rejectUnsafeMutation } from '../../web/lib/server/request-guard.js';
import type { ArchitectureComponent, ArchitectureConnection } from '../types.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('web coverage computation mirrors src/coverage.ts', () => {
  it('produces numerically identical reports from the same consolidated storage', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-web-coverage-'));
    roots.push(root);

    // Real source files: two mapped, one intentionally left unmapped.
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src', 'app.ts'), 'export const app = 1;\n');
    fs.writeFileSync(path.join(root, 'src', 'db.ts'), 'export const db = 1;\n');
    fs.writeFileSync(path.join(root, 'src', 'orphan-file.ts'), 'export const of_ = 1;\n');

    const architecture = path.join(root, '.navgator', 'architecture');
    fs.mkdirSync(architecture, { recursive: true });

    const components = [
      {
        component_id: 'COMP_web',
        name: 'Web',
        type: 'service',
        role: { purpose: 'UI', layer: 'frontend', critical: true },
        source: { detection_method: 'auto', config_files: [], confidence: 1 },
        connects_to: [],
        connected_from: [],
        status: 'active',
        tags: [],
      },
      {
        component_id: 'COMP_db',
        name: 'Database',
        type: 'database',
        role: { purpose: 'Storage', layer: 'database', critical: true },
        source: { detection_method: 'auto', config_files: [], confidence: 1 },
        connects_to: [],
        connected_from: [],
        status: 'active',
        tags: [],
      },
      {
        component_id: 'COMP_orphan',
        name: 'Orphan',
        type: 'service',
        role: { purpose: 'Unused', layer: 'backend', critical: false },
        source: { detection_method: 'auto', config_files: [], confidence: 1 },
        connects_to: [],
        connected_from: [],
        status: 'active',
        tags: [],
      },
    ];

    const connections = [
      {
        connection_id: 'CONN_web_db_high',
        from: { component_id: 'COMP_web', location: { file: 'src/app.ts' } },
        to: { component_id: 'COMP_db' },
        connection_type: 'db-query',
        code_reference: { file: 'src/app.ts', symbol: 'query', line_start: 1 },
        semantic: { classification: 'production', confidence: 0.9 },
        detected_from: 'test-fixture',
        confidence: 0.9,
      },
      {
        connection_id: 'CONN_web_db_low',
        from: { component_id: 'COMP_web', location: { file: 'src/app.ts' } },
        to: { component_id: 'COMP_db' },
        connection_type: 'db-query',
        code_reference: { file: 'src/app.ts', symbol: 'query2', line_start: 2 },
        semantic: { classification: 'production', confidence: 0.2 },
        detected_from: 'test-fixture',
        confidence: 0.2,
      },
    ];

    fs.writeFileSync(
      path.join(architecture, 'components.full.jsonl'),
      components.map((c) => JSON.stringify(c)).join('\n') + '\n',
    );
    fs.writeFileSync(
      path.join(architecture, 'connections.full.jsonl'),
      connections.map((c) => JSON.stringify(c)).join('\n') + '\n',
    );
    fs.writeFileSync(
      path.join(architecture, 'file_map.json'),
      JSON.stringify({
        schema_version: '1.1.0',
        generated_at: Date.now(),
        files: { 'src/app.ts': 'COMP_web', 'src/db.ts': 'COMP_db' },
      }),
    );

    const records = await loadArchitectureRecords(root);
    expect(records.components).toHaveLength(3);
    expect(records.connections).toHaveLength(2);
    expect(records.fileMap).toEqual({ 'src/app.ts': 'COMP_web', 'src/db.ts': 'COMP_db' });

    const webReport = await webComputeCoverage(
      records.components,
      records.connections,
      root,
      records.fileMap,
    );
    const cliReport = await cliComputeCoverage(
      records.components as unknown as ArchitectureComponent[],
      records.connections as unknown as ArchitectureConnection[],
      root,
      records.fileMap,
    );

    // Parity contract: the web computation must equal the CLI computation
    // numerically on the same inputs.
    expect(webReport.component_coverage.coverage_percent).toBe(
      cliReport.component_coverage.coverage_percent,
    );
    expect(webReport.component_coverage.total_files_in_project).toBe(
      cliReport.component_coverage.total_files_in_project,
    );
    expect(webReport.component_coverage.files_mapped_to_components).toBe(
      cliReport.component_coverage.files_mapped_to_components,
    );
    expect(webReport.connection_coverage.by_confidence).toEqual(
      cliReport.connection_coverage.by_confidence,
    );
    expect(new Set(webReport.gaps.map((g) => g.type))).toEqual(
      new Set(cliReport.gaps.map((g) => g.type)),
    );

    // Full-shape parity: cover every CoverageReport field, not just the
    // subset above. overall_confidence, total_connections, and
    // by_classification are asserted directly since they're deterministic
    // numbers/objects with no ordering concern. Gap entries are compared
    // as a sorted-by-(type,target) array rather than positionally: both
    // implementations iterate the same inputs in the same order in this
    // single-process test, but pinning to a normalized (sorted) form avoids
    // coupling the parity contract to iteration-order details (e.g. glob's
    // result order) that aren't semantically part of "the same report".
    expect(webReport.overall_confidence).toBe(cliReport.overall_confidence);
    expect(webReport.connection_coverage.total_connections).toBe(
      cliReport.connection_coverage.total_connections,
    );
    expect(webReport.connection_coverage.by_classification).toEqual(
      cliReport.connection_coverage.by_classification,
    );
    const sortGaps = (gaps: { type: string; target: string; message: string }[]) =>
      [...gaps].sort((a, b) =>
        a.type === b.type ? a.target.localeCompare(b.target) : a.type.localeCompare(b.type),
      );
    expect(sortGaps(webReport.gaps)).toEqual(sortGaps(cliReport.gaps));

    // Concrete expectations pinning the mirrored math, not just parity.
    expect(webReport.component_coverage.total_files_in_project).toBe(3);
    expect(webReport.component_coverage.files_mapped_to_components).toBe(2);
    expect(webReport.component_coverage.coverage_percent).toBe(67);
    expect(webReport.connection_coverage.by_confidence).toEqual({ high: 1, medium: 0, low: 1 });
    expect(new Set(webReport.gaps.map((g) => g.type))).toEqual(
      new Set(['unmapped-file', 'zero-consumers', 'no-outgoing', 'low-confidence-connection']),
    );
  });

  it('reports coverage_percent 0 and no unmapped-file gaps when fileMap is undefined', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-web-coverage-'));
    roots.push(root);
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src', 'app.ts'), 'export const app = 1;\n');

    const architecture = path.join(root, '.navgator', 'architecture');
    fs.mkdirSync(architecture, { recursive: true });
    fs.writeFileSync(path.join(architecture, 'components.full.jsonl'), '');
    fs.writeFileSync(path.join(architecture, 'connections.full.jsonl'), '');

    const records = await loadArchitectureRecords(root);
    expect(records.fileMap).toBeUndefined();

    const webReport = await webComputeCoverage(
      records.components,
      records.connections,
      root,
      records.fileMap,
    );
    const cliReport = await cliComputeCoverage(
      records.components as unknown as ArchitectureComponent[],
      records.connections as unknown as ArchitectureConnection[],
      root,
      records.fileMap,
    );

    expect(webReport.component_coverage.coverage_percent).toBe(0);
    expect(webReport.gaps.some((g) => g.type === 'unmapped-file')).toBe(false);
    expect(webReport.component_coverage).toEqual(cliReport.component_coverage);
  });
});

// SEC-003: /api/coverage's loopback guard, project-path allowlist, and
// cache bound. The route handler itself (web/app/api/coverage/route.ts)
// imports "@/lib/types" via bundler-only alias resolution that isn't
// configured for this vitest project, so it can't be imported directly from
// src/__tests__ (the same constraint documented at the top of
// web/lib/server/coverage.ts, which is why the guard and the allowlist/cache
// logic it uses are both alias-free helpers exercised here instead).
//
// The `next` package itself is only installed under web/node_modules (no npm
// workspace hoisting to the repo root), so it's resolvable from
// web/lib/server/request-guard.ts's own location but not from a direct
// `next/server` import written in this src/__tests__ file. rejectNonLoopback
// and rejectUnsafeMutation only read `request.headers.get(...)` and
// `request.nextUrl.{hostname,protocol,host}`, so a minimal duck-typed object
// exercises the real guard logic without needing NextRequest's type.
type FakeRequest = {
  headers: { get(name: string): string | null };
  nextUrl: { hostname: string; protocol: string; host: string };
};

function fakeRequest(host: string, extraHeaders: Record<string, string> = {}): FakeRequest {
  const headers = new Map<string, string>(
    Object.entries({ host, ...extraHeaders }).map(([k, v]) => [k.toLowerCase(), v]),
  );
  const hostname = host.split(':')[0];
  return {
    headers: { get: (name: string) => headers.get(name.toLowerCase()) ?? null },
    nextUrl: { hostname, protocol: 'http:', host },
  };
}

describe('coverage route security guards (SEC-003)', () => {
  it('rejects a GET whose Host header is not loopback', () => {
    const req = fakeRequest('evil.example.com');
    const rejection = rejectNonLoopback(req as unknown as Parameters<typeof rejectNonLoopback>[0]);
    expect(rejection).not.toBeNull();
    expect(rejection?.status).toBe(403);
  });

  it('allows a GET whose Host header is loopback', () => {
    const req = fakeRequest('localhost:3000');
    expect(rejectNonLoopback(req as unknown as Parameters<typeof rejectNonLoopback>[0])).toBeNull();
  });

  it('rejectUnsafeMutation still rejects non-loopback hosts (existing 4 mutation callers unaffected)', () => {
    const req = fakeRequest('evil.example.com', { 'content-type': 'application/json' });
    const rejection = rejectUnsafeMutation(req as unknown as Parameters<typeof rejectUnsafeMutation>[0]);
    expect(rejection).not.toBeNull();
    expect(rejection?.status).toBe(403);
  });

  it('rejects a path that is not in the registered-projects allowlist', () => {
    const registryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-registry-'));
    roots.push(registryDir);
    const registryPath = path.join(registryDir, 'projects.json');
    const registeredProject = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-registered-'));
    roots.push(registeredProject);
    fs.writeFileSync(
      registryPath,
      JSON.stringify({
        version: 2,
        projects: [{ path: registeredProject, name: 'Registered', addedAt: 0, lastScan: null }],
      }),
    );

    const unregistered = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-unregistered-'));
    roots.push(unregistered);

    expect(isRegisteredProjectPath(unregistered, registryPath)).toBe(false);
    // Full-filesystem paths (the SEC-003 `?path=/` case) must never match.
    expect(isRegisteredProjectPath('/', registryPath)).toBe(false);
  });

  it('accepts a path that is in the registered-projects allowlist', async () => {
    const registryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-registry-'));
    roots.push(registryDir);
    const registryPath = path.join(registryDir, 'projects.json');
    const registeredProject = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-registered-'));
    roots.push(registeredProject);
    fs.writeFileSync(
      registryPath,
      JSON.stringify({
        version: 2,
        projects: [{ path: registeredProject, name: 'Registered', addedAt: 0, lastScan: null }],
      }),
    );

    expect(isRegisteredProjectPath(registeredProject, registryPath)).toBe(true);

    // And a registered project still produces a correct coverage report
    // through the normal computation path (loadArchitectureRecords ->
    // computeCoverage), the same path the route handler takes once the
    // allowlist check above passes.
    const architecture = path.join(registeredProject, '.navgator', 'architecture');
    fs.mkdirSync(path.join(registeredProject, 'src'), { recursive: true });
    fs.writeFileSync(path.join(registeredProject, 'src', 'app.ts'), 'export const app = 1;\n');
    fs.mkdirSync(architecture, { recursive: true });
    fs.writeFileSync(path.join(architecture, 'components.full.jsonl'), '');
    fs.writeFileSync(path.join(architecture, 'connections.full.jsonl'), '');

    const records = await loadArchitectureRecords(registeredProject);
    const report = await webComputeCoverage(
      records.components,
      records.connections,
      registeredProject,
      records.fileMap,
    );
    expect(report.component_coverage.total_files_in_project).toBe(1);
    expect(report.component_coverage.coverage_percent).toBe(0);
    expect(report.gaps).toEqual([]);
  });

  it('missing or malformed registry rejects everything rather than throwing', () => {
    const registryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-registry-'));
    roots.push(registryDir);
    const missingPath = path.join(registryDir, 'does-not-exist.json');
    expect(isRegisteredProjectPath('/anywhere', missingPath)).toBe(false);

    const malformedPath = path.join(registryDir, 'malformed.json');
    fs.writeFileSync(malformedPath, '{ not valid json');
    expect(isRegisteredProjectPath('/anywhere', malformedPath)).toBe(false);
  });

  it('bounds the coverage cache by entry count, evicting the oldest entry', () => {
    const cache = new Map<string, { data: number; timestamp: number }>();
    for (let i = 0; i < 5; i++) {
      setBoundedCacheEntry(cache, `key-${i}`, i, 3);
    }
    expect(cache.size).toBe(3);
    // The first two inserted keys should have been evicted; the last three remain.
    expect(cache.has('key-0')).toBe(false);
    expect(cache.has('key-1')).toBe(false);
    expect(cache.has('key-2')).toBe(true);
    expect(cache.has('key-3')).toBe(true);
    expect(cache.has('key-4')).toBe(true);
  });

  it('re-setting an existing key does not evict to make room for itself', () => {
    const cache = new Map<string, { data: number; timestamp: number }>();
    setBoundedCacheEntry(cache, 'a', 1, 2);
    setBoundedCacheEntry(cache, 'b', 2, 2);
    setBoundedCacheEntry(cache, 'a', 3, 2);
    expect(cache.size).toBe(2);
    expect(cache.get('a')?.data).toBe(3);
    expect(cache.has('b')).toBe(true);
  });
});
