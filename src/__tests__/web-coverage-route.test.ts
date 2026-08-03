import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { loadArchitectureRecords } from '../../web/lib/server/architecture-storage.js';
import { computeCoverage as webComputeCoverage } from '../../web/lib/server/coverage.js';
import { computeCoverage as cliComputeCoverage } from '../coverage.js';
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
