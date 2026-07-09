import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isSetupComplete, setup } from '../setup.js';
import { loadAllConnections } from '../storage.js';

describe('setup persistence boundaries', () => {
  it('forces the deep phase to detect imports without writing legacy architecture', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-setup-'));
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({ name: 'setup-fixture', version: '0.0.0', dependencies: {} }, null, 2),
    );
    fs.writeFileSync(
      path.join(root, 'src', 'a.ts'),
      "import { fromB } from './b';\nexport const fromA = () => fromB();\n",
    );
    fs.writeFileSync(
      path.join(root, 'src', 'b.ts'),
      'export const fromB = () => 1;\n',
    );

    try {
      const result = await setup({
        projectPath: root,
        generateDiagram: false,
      });

      expect(result.success).toBe(true);
      expect(result.fastScanComplete).toBe(true);
      expect(result.deepScanComplete).toBe(true);
      expect(result.connectionsFound).toBeGreaterThan(0);

      const connections = await loadAllConnections(undefined, root);
      expect(connections.some((connection) =>
        connection.connection_type === 'imports' &&
        connection.code_reference?.file === 'src/a.ts' &&
        connection.code_reference?.symbol === './b'
      )).toBe(true);

      expect(fs.existsSync(path.join(root, '.navgator', 'architecture', 'index.json'))).toBe(true);
      expect(fs.existsSync(path.join(root, '.claude', 'architecture'))).toBe(false);
      await expect(isSetupComplete(root)).resolves.toMatchObject({
        hasScanned: true,
        phase: 'deep',
      });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('records a completed deep phase even when the graph has no import edges', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-setup-no-imports-'));
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({ name: 'setup-no-imports', version: '0.0.0', dependencies: {} }),
    );
    fs.writeFileSync(path.join(root, 'src', 'index.ts'), 'export const value = 1;\n');

    try {
      const result = await setup({ projectPath: root, generateDiagram: false });
      expect(result.deepScanComplete).toBe(true);
      await expect(isSetupComplete(root)).resolves.toMatchObject({
        hasScanned: true,
        phase: 'deep',
      });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('records fast when setup intentionally skips the deep phase', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-setup-fast-'));
    fs.writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({ name: 'setup-fast', version: '0.0.0', dependencies: {} }),
    );

    try {
      const result = await setup({ projectPath: root, fastOnly: true, generateDiagram: false });
      expect(result.fastScanComplete).toBe(true);
      expect(result.deepScanComplete).toBe(false);
      await expect(isSetupComplete(root)).resolves.toMatchObject({
        hasScanned: true,
        phase: 'fast',
      });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
