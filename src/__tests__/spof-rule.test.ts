/**
 * single-point-of-failure: protocol conformance is not a dependency, and the
 * rule's result on a scanned TypeScript project is pinned so a change to what
 * the rule counts cannot silently move TS/JS results.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { scan } from '../scanner.js';
import { getBuiltinRules } from '../rules.js';
import { createComponent, createConnection } from './helpers.js';

const spof = () => getBuiltinRules().find(r => r.id === 'single-point-of-failure')!;

describe('single-point-of-failure', () => {
  it('does not count protocol conformers as dependents', () => {
    const protocol = createComponent({ name: 'protocol:Codable', layer: 'backend' });
    const service = createComponent({ name: 'Store', layer: 'backend' });
    const components = [protocol, service];
    const connections = [];
    for (let i = 0; i < 8; i++) {
      const type = createComponent({ name: `Model${i}`, layer: 'backend' });
      components.push(type);
      connections.push({ ...createConnection(type.component_id, protocol.component_id), connection_type: 'conforms-to' as const });
      connections.push(createConnection(type.component_id, service.component_id));
    }
    expect(spof().check(components, connections).map(v => v.component)).toEqual(['Store']);
  });

  describe('on a scanned TypeScript project (pinned)', () => {
    let tmp: string;
    const write = (rel: string, content: string): void => {
      const full = path.join(tmp, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content, 'utf-8');
    };

    beforeEach(() => {
      tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-spof-ts-'));
      write('package.json', JSON.stringify({ name: 'spof-ts', version: '1.0.0', dependencies: { zod: '^3.0.0' } }));
      write('tsconfig.json', JSON.stringify({ compilerOptions: { module: 'esnext', target: 'es2022' } }));
      write('src/db.ts', "export const db = { query: (s: string) => s };\n");
      write('src/small.ts', "export const small = 1;\n");
      for (let i = 0; i < 6; i++) {
        write(
          `src/handler${i}.ts`,
          `import { z } from 'zod';\nimport { db } from './db';\n${i < 2 ? "import { small } from './small';\n" : ''}export const h${i} = () => db.query(z.string().parse('x'));\n`
        );
      }
    });

    afterEach(() => {
      fs.rmSync(tmp, { recursive: true, force: true });
    });

    it('flags the same components as before the conformance change', async () => {
      const result = await scan(tmp, { mode: 'full' });
      const flagged = spof()
        .check(result.components, result.connections)
        .map(v => v.message)
        .sort();
      expect(flagged).toMatchInlineSnapshot(`
        [
          "db has 6 dependents — single point of failure",
          "zod has 6 dependents — single point of failure",
        ]
      `);
    });
  });
});
