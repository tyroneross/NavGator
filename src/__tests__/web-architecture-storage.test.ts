import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { loadArchitectureRecords } from '../../web/lib/server/architecture-storage.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('dashboard consolidated architecture storage', () => {
  it('loads graph nodes and compact JSONL connections without per-entity files', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-web-storage-'));
    roots.push(root);
    const architecture = path.join(root, '.navgator', 'architecture');
    fs.mkdirSync(architecture, { recursive: true });
    fs.writeFileSync(path.join(architecture, 'graph.json'), JSON.stringify({
      nodes: [
        { id: 'COMP_web', name: 'Web', type: 'service', layer: 'frontend' },
        { id: 'COMP_db', name: 'Database', type: 'database', layer: 'database' },
      ],
      edges: [],
      metadata: { generated_at: 123, component_count: 2, connection_count: 1 },
    }));
    fs.writeFileSync(path.join(architecture, 'components.full.jsonl'), [
      {
        component_id: 'COMP_web',
        name: 'Web',
        version: '1.2.3',
        type: 'component',
        role: { layer: 'frontend', purpose: 'UI' },
        status: 'active',
        tags: ['ui'],
      },
      {
        component_id: 'COMP_db',
        name: 'Database',
        type: 'database',
        role: { layer: 'database', purpose: 'Storage' },
        status: 'vulnerable',
        tags: ['data'],
      },
    ].map((record) => JSON.stringify(record)).join('\n'));
    fs.writeFileSync(path.join(architecture, 'connections.full.jsonl'), `${JSON.stringify({
      connection_id: 'CONN_web_db',
      from: { component_id: 'COMP_web' },
      to: { component_id: 'COMP_db' },
      connection_type: 'queue-uses-cache',
      code_reference: { file: 'src/web.ts', line_start: 7, symbol: 'loadData' },
      semantic: { classification: 'production' },
    })}\n`);
    fs.writeFileSync(path.join(architecture, 'connections.jsonl'), `${JSON.stringify({
      connection_id: 'CONN_web_db',
      from_id: 'COMP_web',
      to_id: 'COMP_db',
      type: 'other',
      file: 'src/web.ts',
      line: 7,
      symbol: 'loadData',
      confidence: 1,
      classification: 'production',
    })}\n`);

    const records = await loadArchitectureRecords(root);

    expect(records.generatedAt).toBe(123);
    expect(records.components).toHaveLength(2);
    expect(records.components[0]).toMatchObject({
      component_id: 'COMP_web',
      version: '1.2.3',
      type: 'component',
      status: 'active',
      role: { layer: 'frontend' },
    });
    expect(records.connections).toEqual([
      expect.objectContaining({
        connection_id: 'CONN_web_db',
        from: { component_id: 'COMP_web' },
        to: { component_id: 'COMP_db' },
        connection_type: 'queue-uses-cache',
        code_reference: expect.objectContaining({ file: 'src/web.ts', line_start: 7 }),
        semantic: { classification: 'production' },
      }),
    ]);
  });
});
