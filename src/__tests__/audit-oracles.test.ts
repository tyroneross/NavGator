/**
 * NavGator audit oracle tests — Run 4 (2026-09-05).
 *
 * A tmp fixture repo with package.json, prisma/schema.prisma, vercel.json and
 * a BullMQ literal; a hand-built stored graph with known TP/FP/FN per oracle.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ArchitectureComponent, ArchitectureConnection } from '../types.js';
import { runCensus, runOracles } from '../audit/oracles/index.js';
import { regexModels } from '../audit/oracles/prisma.js';

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-oracle-'));
  fs.mkdirSync(path.join(root, 'prisma'), { recursive: true });
  fs.mkdirSync(path.join(root, 'lib'), { recursive: true });
  fs.mkdirSync(path.join(root, 'node_modules', 'ignored'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ name: 'fx', dependencies: { react: '1', pg: '1', bullmq: '1' }, devDependencies: { vitest: '1' } })
  );
  fs.writeFileSync(
    path.join(root, 'prisma', 'schema.prisma'),
    `datasource db { provider = "postgresql" url = env("DATABASE_URL") }\n\nmodel User {\n  id Int @id\n  @@map("users")\n}\n\nmodel Post {\n  id Int @id\n}\n`
  );
  fs.writeFileSync(path.join(root, 'vercel.json'), JSON.stringify({ crons: [{ path: '/api/cron/a', schedule: '* * * * *' }, { path: '/api/cron/b', schedule: '0 * * * *' }] }));
  fs.writeFileSync(path.join(root, 'lib', 'queues.ts'), `import { Queue } from 'bullmq';\nexport const q1 = new Queue('emails');\nexport const q2 = new Queue("thumbnails", { connection });\n`);
  fs.writeFileSync(path.join(root, 'node_modules', 'ignored', 'x.ts'), `new Queue('should-not-count')`);
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function comp(id: string, name: string, type: ArchitectureComponent['type'], configFiles: string[], tags: string[] = []): ArchitectureComponent {
  return {
    component_id: id,
    name,
    type,
    role: { purpose: '', layer: 'backend', critical: false },
    source: { detection_method: 'auto', config_files: configFiles, confidence: 1 },
    connects_to: [],
    connected_from: [],
    status: 'active',
    tags,
    timestamp: 0,
    last_updated: 0,
  };
}

function conn(id: string, from: string, to: string, type: ArchitectureConnection['connection_type'], file = 'lib/queues.ts'): ArchitectureConnection {
  return {
    connection_id: id,
    from: { component_id: from, location: { file, line: 1 } },
    to: { component_id: to },
    connection_type: type,
    code_reference: { file, symbol: 'x' },
    detected_from: 'test',
    confidence: 1,
    timestamp: 0,
    last_verified: 0,
  };
}

const components: ArchitectureComponent[] = [
  comp('C_react', 'react', 'npm', ['package.json']),
  comp('C_pg', 'pg', 'database', ['package.json']), // client library typed database → prisma FP
  comp('C_bullmq', 'bullmq', 'queue', ['package.json']), // package, excluded from queue oracle map
  comp('C_ghost', '@types/ghost', 'npm', ['package.json']), // npm FP
  // vitest missing → npm FN
  comp('C_user', 'User', 'database', ['prisma/schema.prisma']),
  comp('C_phantom', 'Phantom', 'database', ['prisma/schema.prisma']), // prisma FP
  // Post missing → prisma FN
  comp('C_cron_a', '/api/cron/a', 'cron', ['vercel.json'], ['cron', 'vercel']),
  comp('C_cron_z', '/api/cron/z', 'cron', ['vercel.json'], ['cron', 'vercel']), // cron FP; /api/cron/b FN
  comp('C_q_emails', 'emails', 'queue', ['lib/queues.ts']),
  comp('C_q_stale', 'old-queue', 'queue', ['lib/queues.ts']), // queue FP; thumbnails FN
];

const connections: ArchitectureConnection[] = [
  conn('X1', 'C_react', 'C_user', 'imports'),
  conn('X2', 'C_react', 'C_missing', 'imports'), // unresolved → census bad
  conn('X3', 'C_nope', 'C_user', 'service-call', 'app/x.ts'), // unresolved
  conn('X4', 'C_user', 'C_pg', 'api-calls-db', 'app/y.ts'),
];

describe('runOracles', () => {
  it('npm: exact recall against package.json with FP/FN examples and Wilson/CP intervals', async () => {
    const byId = new Map(components.map((c) => [c.component_id, c] as const));
    const res = await runOracles({ projectRoot: root, components, connections, componentById: byId, hashes: null }, { only: ['npm'] });
    const npm = res.find((r) => r.oracle === 'npm')!;
    expect(npm.oracle_strength).toBe('independent');
    expect(npm.truth_count).toBe(4);
    expect(npm.map_count).toBe(4);
    expect(npm.tp).toBe(3);
    expect(npm.fp).toBe(1);
    expect(npm.fn).toBe(1);
    expect(npm.fp_samples).toEqual(['@types/ghost']);
    expect(npm.fn_samples).toEqual(['vitest']);
    expect(npm.precision).toBeCloseTo(0.75, 6);
    expect(npm.recall).toBeCloseTo(0.75, 6);
    expect(npm.precision_ci?.method).toBe('wilson');
    expect(npm.precision_ci!.lower).toBeLessThan(0.75);
    expect(npm.precision_ci!.upper).toBeGreaterThan(0.75);
  });

  it('prisma: regex fallback is weak, matches @@map, flags client libraries as FP', async () => {
    const byId = new Map(components.map((c) => [c.component_id, c] as const));
    const res = await runOracles({ projectRoot: root, components, connections, componentById: byId, hashes: null }, { only: ['prisma'] });
    const p = res.find((r) => r.oracle === 'prisma')!;
    expect(p.oracle_strength).toBe('weak'); // no @prisma/internals in the fixture
    expect(p.truth_count).toBe(2);
    expect(p.tp).toBe(1); // User
    expect(p.fn).toBe(1); // Post
    expect(p.fn_samples).toEqual(['Post']);
    expect(p.fp).toBe(2); // Phantom + pg
    expect(p.fp_samples).toContain('pg');
    expect(p.fp_samples).toContain('Phantom');
    expect(p.notes.join(' ')).toContain('client-library-misclassified: pg');
    expect(p.map_count).toBe(3);
  });

  it('(b): prisma never imports @prisma/internals from the target unless trustTargetDeps is set', async () => {
    const byId = new Map(components.map((c) => [c.component_id, c] as const));
    const res = await runOracles({ projectRoot: root, components, connections, componentById: byId, hashes: null }, { only: ['prisma'] });
    expect(res[0]!.oracle_strength).toBe('weak');
    expect(res[0]!.notes.join(' ')).toContain('--trust-target-deps');
    const trusted = await runOracles({ projectRoot: root, components, connections, componentById: byId, hashes: null }, { only: ['prisma'], trustTargetDeps: true });
    // Fixture has no @prisma/internals: still weak, but now via the resolution path.
    expect(trusted[0]!.oracle_strength).toBe('weak');
    expect(trusted[0]!.notes.join(' ')).toContain('not resolvable');
  });

  it('cron: joins on vercel.json cron path', async () => {
    const byId = new Map(components.map((c) => [c.component_id, c] as const));
    const res = await runOracles({ projectRoot: root, components, connections, componentById: byId, hashes: null }, { only: ['cron'] });
    const c = res.find((r) => r.oracle === 'cron')!;
    expect(c.oracle_strength).toBe('independent');
    expect(c.tp).toBe(1);
    expect(c.fp_samples).toEqual(['/api/cron/z']);
    expect(c.fn_samples).toEqual(['/api/cron/b']);
  });

  it('queue: independent walk ignores node_modules and excludes package-derived queue components', async () => {
    const byId = new Map(components.map((c) => [c.component_id, c] as const));
    const res = await runOracles({ projectRoot: root, components, connections, componentById: byId, hashes: null }, { only: ['queue'] });
    const q = res.find((r) => r.oracle === 'queue')!;
    expect(q.oracle_strength).toBe('weak');
    expect(q.truth_count).toBe(2); // emails, thumbnails
    expect(q.tp).toBe(1);
    expect(q.fp_samples).toEqual(['old-queue']);
    expect(q.fn_samples).toEqual(['thumbnails']);
  });

  it('fix2 #3: an existing manifest with an empty frame stays independent and counts map components as FP', async () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-oracle-emptyframe-'));
    try {
      fs.writeFileSync(path.join(empty, 'package.json'), JSON.stringify({ name: 'bare' }));
      fs.writeFileSync(path.join(empty, 'vercel.json'), JSON.stringify({ crons: [] }));
      const cs = [comp('C_x', 'left-pad', 'npm', ['package.json']), comp('C_c', '/api/cron/ghost', 'cron', ['vercel.json'], ['vercel'])];
      const byId = new Map(cs.map((c) => [c.component_id, c] as const));
      const res = await runOracles({ projectRoot: empty, components: cs, connections: [], componentById: byId, hashes: null }, { only: ['npm', 'cron'] });
      const npm = res.find((r) => r.oracle === 'npm')!;
      expect(npm.oracle_strength).toBe('independent');
      expect(npm.truth_count).toBe(0);
      expect(npm.fp).toBe(1);
      expect(npm.fp_samples).toEqual(['left-pad']);
      expect(npm.precision).toBe(0);
      expect(npm.recall).toBeNull();
      const cron = res.find((r) => r.oracle === 'cron')!;
      expect(cron.oracle_strength).toBe('independent');
      expect(cron.truth_count).toBe(0);
      expect(cron.fp_samples).toEqual(['/api/cron/ghost']);
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });

  it('imports-scip is skipped (strength none) unless enabled', async () => {
    const byId = new Map(components.map((c) => [c.component_id, c] as const));
    const res = await runOracles({ projectRoot: root, components, connections, componentById: byId, hashes: null }, { only: ['imports-scip'] });
    expect(res[0]!.oracle_strength).toBe('none');
    expect(res[0]!.notes[0]).toContain('skipped');
  });

  it('missing manifests degrade to strength none, never throw', async () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-oracle-empty-'));
    try {
      const res = await runOracles({ projectRoot: empty, components: [], connections: [], componentById: new Map(), hashes: null });
      expect(res.length).toBe(5);
      for (const r of res) expect(r.oracle_strength).toBe('none');
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });
});

describe('regexModels', () => {
  it('parses model names and @@map inside the block only', () => {
    const models = regexModels(`model A {\n id Int\n @@map("a_tbl")\n}\nmodel B {\n id Int\n}\n`);
    expect(models).toEqual([{ name: 'A', dbName: 'a_tbl' }, { name: 'B' }]);
  });
});

describe('runCensus', () => {
  it('counts unresolved endpoints exactly, by type and top dir, with an interval', () => {
    const c = runCensus(components, connections);
    expect(c.unresolved_endpoints.bad).toBe(2);
    expect(c.unresolved_endpoints.total).toBe(4);
    expect(c.unresolved_endpoints.rate).toBeCloseTo(0.5, 6);
    expect(c.unresolved_endpoints.by_type['imports']).toEqual({ bad: 1, total: 2 });
    expect(c.unresolved_endpoints.by_type['service-call']).toEqual({ bad: 1, total: 1 });
    expect(c.unresolved_endpoints.by_top_dir['lib']).toEqual({ bad: 1, total: 2 });
    expect(c.unresolved_endpoints.by_top_dir['app']).toEqual({ bad: 1, total: 2 });
    expect(c.unresolved_endpoints.ci?.method).toBe('wilson');
    expect(c.dedup_collisions).toBe(0);
  });

  it('counts dedup collisions', () => {
    const dup = { ...components[0]!, component_id: 'C_react_dup' };
    expect(runCensus([...components, dup], []).dedup_collisions).toBe(1);
  });
});

describe('imports-scip oracle (spawns scip-typescript from NavGator node_modules)', () => {
  it('scores stored imports edges against compiler-resolved references and reports frame coverage', async () => {
    const tsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-oracle-scip-'));
    try {
      fs.mkdirSync(path.join(tsRoot, 'src'), { recursive: true });
      fs.writeFileSync(path.join(tsRoot, 'package.json'), JSON.stringify({ name: 'scipfx', version: '0.0.0' }));
      fs.writeFileSync(path.join(tsRoot, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'es2020', module: 'esnext', moduleResolution: 'node', strict: true }, include: ['src'] }));
      fs.writeFileSync(path.join(tsRoot, 'src', 'a.ts'), `import { b } from './b';\nexport const a = b + 1;\n`);
      fs.writeFileSync(path.join(tsRoot, 'src', 'b.ts'), `export const b = 1;\n`);
      fs.writeFileSync(path.join(tsRoot, 'src', 'c.ts'), `export const c = 3;\n`);
      const comps = [comp('C_a', 'a', 'component', ['src/a.ts']), comp('C_b', 'b', 'component', ['src/b.ts']), comp('C_c', 'c', 'component', ['src/c.ts'])];
      const conns = [
        conn('I1', 'C_a', 'C_b', 'imports', 'src/a.ts'), // real
        conn('I2', 'C_a', 'C_c', 'imports', 'src/a.ts'), // phantom: a.ts never references c.ts
      ];
      const byId = new Map(comps.map((c) => [c.component_id, c] as const));
      const hashes = { version: '1.0' as const, generatedAt: 0, projectPath: tsRoot, files: { 'src/a.ts': { hash: 'x', lastScanned: 0, size: 1 }, 'src/b.ts': { hash: 'x', lastScanned: 0, size: 1 }, 'src/c.ts': { hash: 'x', lastScanned: 0, size: 1 } } };
      const res = await runOracles({ projectRoot: tsRoot, components: comps, connections: conns, componentById: byId, hashes }, { only: ['imports-scip'], scip: true });
      const o = res[0]!;
      expect(o.notes.join(' ')).not.toContain('unavailable');
      expect(o.oracle_strength).toBe('independent');
      expect(o.tp).toBe(1);
      expect(o.fp_samples).toEqual(['src/a.ts -> src/c.ts']);
      expect(o.fn).toBe(0);
      expect(o.frame_coverage).toBeGreaterThan(0);

      // (c): a configurable timeout that expires is reported as strength none with the reason.
      const slow = await runOracles({ projectRoot: tsRoot, components: comps, connections: conns, componentById: byId, hashes }, { only: ['imports-scip'], scip: true, scipTimeoutMs: 1 });
      expect(slow[0]!.oracle_strength).toBe('none');
      expect(slow[0]!.notes[0]).toMatch(/timed out after 1 ms/);
    } finally {
      fs.rmSync(tsRoot, { recursive: true, force: true });
    }
  }, 60000);
});
