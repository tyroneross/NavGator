/**
 * Characterization tests for the three connection scanners (Wave 2 T9).
 *
 * These tests SNAPSHOT the current output of each scanner against the
 * `__tests__/fixtures/bench-repo` fixture. They are NOT correctness tests —
 * they lock the current behavior (including known imperfections) so that
 * subsequent SCIP integration work (T10/T11) reveals exactly what changed.
 *
 * If a scanner's output legitimately changes (e.g., a new heuristic catches
 * a previously-missed pattern), update the snapshot deliberately:
 *     vitest run -u src/__tests__/scanner-characterization.test.ts
 *
 * If a snapshot diff appears unintentionally, treat it as a regression.
 */

import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { glob } from 'glob';

import { scanImports } from '../scanners/connections/import-scanner.js';
import { scanServiceCalls } from '../scanners/connections/service-calls.js';
import { traceLLMCalls } from '../scanners/connections/llm-call-tracer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(__dirname, '..', '..', '__tests__', 'fixtures', 'bench-repo');

/**
 * Strip non-deterministic fields so snapshots are stable across runs.
 * - `timestamp` / `last_updated` / `last_verified` always change (Date.now())
 * - `component_id` and `connection_id` carry random suffixes; we keep
 *   `stable_id` (T2) for components and `connection_type + symbol + file`
 *   as the connection's identity.
 */
function normalizeComponent<T extends { component_id?: string; stable_id?: string; timestamp?: number; last_updated?: number }>(c: T): Record<string, unknown> {
  const { component_id: _id, timestamp: _t, last_updated: _u, ...rest } = c;
  return { ...rest };
}

function normalizeConnection<T extends { connection_id?: string; timestamp?: number; last_verified?: number; from?: { component_id?: string; location?: { line?: number } }; to?: { component_id?: string }; code_reference?: { line_start?: number; line_end?: number; code_snippet?: string } }>(c: T): Record<string, unknown> {
  const { connection_id: _id, timestamp: _t, last_verified: _v, from, to, code_reference, ...rest } = c;
  return {
    ...rest,
    from_file: from?.location?.line !== undefined ? `${(from as { location?: { file?: string } }).location?.file ?? ''}:${from.location.line}` : undefined,
    to: to ? { /* component_id stripped */ } : undefined,
    code_reference: code_reference
      ? {
          file: (code_reference as { file?: string }).file,
          symbol: (code_reference as { symbol?: string }).symbol,
          symbol_type: (code_reference as { symbol_type?: string }).symbol_type,
          // line_start/line_end deliberately stripped (cosmetic, varies on edits)
        }
      : undefined,
  };
}

function summarizeScanResult(label: string, components: unknown[], connections: unknown[]): Record<string, unknown> {
  // Sort for deterministic order across runs.
  const componentSummary = components
    .map((c) => normalizeComponent(c as Record<string, never>))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const connectionSummary = connections
    .map((c) => normalizeConnection(c as Record<string, never>))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return {
    label,
    component_count: components.length,
    connection_count: connections.length,
    components_by_type: countBy(components, (c) => (c as { type?: string }).type ?? 'unknown'),
    connections_by_type: countBy(connections, (c) => (c as { connection_type?: string }).connection_type ?? 'unknown'),
    sample_components: componentSummary.slice(0, 5),
    sample_connections: connectionSummary.slice(0, 10),
  };
}

function countBy<T>(arr: T[], key: (t: T) => string): Record<string, number> {
  const m: Record<string, number> = {};
  for (const x of arr) {
    const k = key(x);
    m[k] = (m[k] ?? 0) + 1;
  }
  return m;
}

/**
 * Run 1 — D4: Lock the FULL-SCAN output of `scan()` on the bench-repo
 * fixture. This is the regression baseline for D1+D2 refactors. If this
 * snapshot diff appears, treat it as a regression and investigate before
 * accepting the new shape.
 *
 * Strips: timestamps, component_id random suffixes, scan duration,
 * absolute paths, git info, last_scan/last_full_scan, NavSummary text
 * (markdown depends on per-component random IDs).
 */
function normalizeFullScan(result: {
  components: Array<{ component_id?: string; stable_id?: string; timestamp?: number; last_updated?: number; type?: string; name?: string }>;
  connections: Array<{ connection_id?: string; timestamp?: number; last_verified?: number; connection_type?: string; code_reference?: { file?: string; symbol?: string } }>;
  warnings: unknown[];
}): Record<string, unknown> {
  const componentTypes: Record<string, number> = {};
  const stableIds = new Set<string>();
  for (const c of result.components) {
    componentTypes[c.type ?? 'unknown'] = (componentTypes[c.type ?? 'unknown'] ?? 0) + 1;
    if (c.stable_id) stableIds.add(c.stable_id);
  }

  const connectionTypes: Record<string, number> = {};
  const connectionFingerprints: string[] = [];
  for (const c of result.connections) {
    connectionTypes[c.connection_type ?? 'unknown'] = (connectionTypes[c.connection_type ?? 'unknown'] ?? 0) + 1;
    // Fingerprint: type + file + symbol (no line numbers — those drift).
    connectionFingerprints.push(
      `${c.connection_type ?? '?'}::${c.code_reference?.file ?? ''}::${c.code_reference?.symbol ?? ''}`
    );
  }
  connectionFingerprints.sort();

  const stableIdList = Array.from(stableIds).sort();

  return {
    component_count: result.components.length,
    connection_count: result.connections.length,
    components_by_type: componentTypes,
    connections_by_type: connectionTypes,
    stable_ids_sample: stableIdList.slice(0, 20), // First 20 stable IDs (alphabetical)
    connection_fingerprints_sample: connectionFingerprints.slice(0, 30), // First 30 fingerprints
    warnings_count: result.warnings.length,
  };
}

describe('full-scan characterization (Run 1 — D4)', () => {
  it('full scan on bench-repo fixture: locked output shape', async () => {
    // Late import to avoid circular import issues with the storage atomic-rename helpers.
    const { scan } = await import('../scanner.js');
    const result = await scan(FIXTURE, { mode: 'full' });
    const normalized = normalizeFullScan({
      components: result.components,
      connections: result.connections,
      warnings: result.warnings,
    });
    expect(normalized).toMatchSnapshot();
  });
});

describe('scanner characterization (Wave 2 T9)', () => {
  it('import-scanner: stable on bench-repo fixture', async () => {
    // Pre-collect source files the way the main scanner does, so the test
    // exercises the parameterized path (not the fallback glob).
    const sourceFiles = await glob('**/*.{ts,tsx,js,jsx}', {
      cwd: FIXTURE,
      ignore: ['**/node_modules/**', '**/dist/**', '**/.next/**', '**/.navgator/**'],
    });
    const result = await scanImports(FIXTURE, sourceFiles);
    expect(summarizeScanResult('import-scanner', result.components, result.connections)).toMatchSnapshot();
  });

  it('service-calls: stable on bench-repo fixture', async () => {
    const result = await scanServiceCalls(FIXTURE);
    expect(summarizeScanResult('service-calls', result.components, result.connections)).toMatchSnapshot();
  });

  it('llm-call-tracer: stable on bench-repo fixture', async () => {
    const trace = await traceLLMCalls(FIXTURE);
    // traceLLMCalls returns a different shape than ScanResult — capture the
    // call list, deduped/sorted for deterministic output.
    const calls = (trace.calls ?? [])
      .map((c) => {
        const cu = c as unknown as Record<string, unknown>;
        const anchor = (cu['anchor'] as { file?: string } | undefined) ?? {};
        const provider = (cu['provider'] as { name?: string } | undefined) ?? {};
        return {
          provider_name: provider.name,
          method: (cu['method'] as { name?: string } | undefined)?.name,
          file: anchor.file,
          name: cu['name'] as string | undefined,
        };
      })
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    expect({
      total_calls: calls.length,
      providers: countBy(calls, (c) => c.provider_name ?? 'unknown'),
      methods: countBy(calls, (c) => c.method ?? 'unknown'),
      sample_calls: calls.slice(0, 8),
    }).toMatchSnapshot();
  });
});
