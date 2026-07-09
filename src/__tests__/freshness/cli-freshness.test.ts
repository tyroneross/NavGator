import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runDrain, runMarkDirty, runFreshness } from '../../cli/commands/freshness.js';
import { readDirty } from '../../freshness/dirty-ledger.js';
import { scan } from '../../scanner.js';
import { loadAllConnections } from '../../storage.js';

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'nv-cli-'));
  fs.mkdirSync(path.join(root, '.navgator', 'architecture'), { recursive: true });
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('freshness CLI helpers', () => {
  it('runMarkDirty appends to the ledger', async () => {
    await runMarkDirty(['src/a.ts'], root);
    expect(readDirty(root)).toEqual(['src/a.ts']);
  });

  it('runFreshness returns a stamp-shaped object even before any drain', async () => {
    const out = await runFreshness(root);
    expect(out).toHaveProperty('dirty_count');
    expect(out).toHaveProperty('scan_in_flight');
  });

  it('overlays durable ledger events when the persisted stamp remained clean', async () => {
    await runMarkDirty(['src/late.ts'], root);
    fs.writeFileSync(
      path.join(root, '.navgator', 'architecture', 'freshness.json'),
      JSON.stringify({
        version: 1,
        generated_at: 1,
        commit_sha: '',
        branch: '',
        dirty_files: [],
        dirty_count: 0,
        scan_in_flight: false,
      }),
    );

    const out = await runFreshness(root);
    expect(out.dirty_files).toEqual(['src/late.ts']);
    expect(out.dirty_count).toBe(1);
    expect(out.scan_in_flight).toBe(false);
  });

  it('uses auto mode so a dirty tsconfig change rebuilds alias connections', async () => {
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({ name: 'freshness-alias-fixture', version: '0.0.0', dependencies: {} }),
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
        connection.code_reference?.file === 'src/a.ts' &&
        connection.code_reference?.symbol === '@/b',
    )).toBe(true);

    fs.writeFileSync(
      path.join(root, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '#/*': ['src/*'] } } }),
    );
    await runMarkDirty(['tsconfig.json'], root);
    const result = await runDrain(root, 0);

    expect(result.status).toBe('drained');
    expect(readDirty(root)).toEqual([]);
    expect((await loadAllConnections(undefined, root)).some(
      (connection) =>
        connection.connection_type === 'imports' &&
        connection.code_reference?.file === 'src/a.ts' &&
        connection.code_reference?.symbol === '@/b',
    )).toBe(false);
  });
});
