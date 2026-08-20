import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('MCP stdio lifecycle', () => {
  it('drains an async tool response before exiting on stdin EOF', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-mcp-drain-'));
    roots.push(root);
    const architecture = path.join(root, '.navgator', 'architecture');
    fs.mkdirSync(architecture, { recursive: true });
    fs.writeFileSync(path.join(architecture, 'index.json'), JSON.stringify({
      schema_version: '1.1.0',
      version: '1.1.0',
      stable_id_scheme: 2,
      last_scan: Date.now(),
      last_full_scan: Date.now(),
      incrementals_since_full: 0,
      project_path: root,
      components: { by_name: {}, by_type: {}, by_layer: {}, by_status: {} },
      connections: { by_type: {}, by_from: {}, by_to: {} },
      stats: {
        total_components: 42,
        total_connections: 7,
        components_by_type: {},
        connections_by_type: {},
        outdated_count: 0,
        vulnerable_count: 0,
      },
    }));

    const input = [
      JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
      JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'notifications/initialized', params: {} }),
      JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'status', arguments: {} } }),
      '',
    ].join('\n');
    const server = path.resolve(__dirname, '../../dist/mcp/server.js');
    const result = spawnSync(process.execPath, [server], { cwd: root, input, encoding: 'utf8', timeout: 10_000 });
    const responses = result.stdout.trim().split(/\r?\n/).map((line) => JSON.parse(line));

    expect(result.status).toBe(0);
    expect(responses.find((response) => response.id === 3)?.result?.content?.[0]?.text)
      .toContain('Components: 42');
  });
});
