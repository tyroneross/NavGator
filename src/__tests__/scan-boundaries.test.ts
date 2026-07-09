import { Command } from 'commander';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { registerScanCommand } from '../cli/commands/scan.js';
import { loadTimeline } from '../diff.js';
import { scanLockPath } from '../freshness/paths.js';
import { handleToolCall } from '../mcp/tools.js';
import { acquireScanLease, type ScanLease } from '../scan-lock.js';
import { quickScan } from '../scanner.js';
import { setup } from '../setup.js';

const originalCwd = process.cwd();
const originalExitCode = process.exitCode;

afterEach(() => {
  process.chdir(originalCwd);
  process.exitCode = originalExitCode;
});

function lockedFixture(): { root: string; lease: ScanLease; cleanup: () => void } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-boundary-'));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'fixture' }));
  const acquisition = acquireScanLease(scanLockPath(root), 'test-holder');
  if (!acquisition.ok) throw new Error(acquisition.message);
  return {
    root,
    lease: acquisition.lease,
    cleanup: () => {
      acquisition.lease.release();
      if (process.cwd() === root) process.chdir(originalCwd);
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

describe.sequential('scan contention boundaries', () => {
  it('preserves busy status through quickScan and setup', async () => {
    const fixture = lockedFixture();
    try {
      const quick = await quickScan(fixture.root);
      expect(quick).toMatchObject({ status: 'busy', retryable: true });

      const result = await setup({
        projectPath: fixture.root,
        fastOnly: true,
        generateDiagram: false,
      });
      expect(result.fastScanComplete).toBe(false);
      expect(result.errors.join('\n')).toContain('Fast scan busy');
    } finally {
      fixture.cleanup();
    }
  });

  it('marks the MCP scan response as retryable error without claiming completion', async () => {
    const fixture = lockedFixture();
    process.chdir(fixture.root);
    try {
      const response = await handleToolCall('scan', {});
      const text = response.content.map((item) => item.text).join('\n');

      expect(response.isError).toBe(true);
      expect(text).toContain('Scan busy (retryable)');
      expect(text).not.toContain('Scan complete: 0 components');
    } finally {
      fixture.cleanup();
    }
  });

  it('lets an MCP scan promote a config change to a full rebuild', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-mcp-auto-'));
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({ name: 'mcp-auto-fixture', version: '0.0.0', dependencies: {} }, null, 2),
    );
    fs.writeFileSync(path.join(root, 'src', 'index.ts'), 'export const value = 1;\n');
    process.chdir(root);

    try {
      const baseline = await handleToolCall('scan', {});
      expect(baseline.isError).not.toBe(true);

      fs.writeFileSync(
        path.join(root, 'package.json'),
        JSON.stringify({
          name: 'mcp-auto-fixture',
          version: '0.0.0',
          dependencies: { commander: '^14.0.0' },
        }, null, 2),
      );

      const response = await handleToolCall('scan', {});
      expect(response.isError).not.toBe(true);

      const timeline = await loadTimeline(undefined, root);
      expect(timeline.entries.at(-1)?.scan_type).toBe('full');
    } finally {
      process.chdir(originalCwd);
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not print SCAN COMPLETE from the CLI when the lease is busy', async () => {
    const fixture = lockedFixture();
    process.chdir(fixture.root);
    const logs: string[] = [];
    const errors: string[] = [];
    const originalLog = console.log;
    const originalError = console.error;
    console.log = (...args: unknown[]) => logs.push(args.join(' '));
    console.error = (...args: unknown[]) => errors.push(args.join(' '));
    process.exitCode = undefined;

    try {
      const program = new Command();
      registerScanCommand(program);
      await program.parseAsync(['node', 'navgator', 'scan'], { from: 'node' });

      expect(logs.join('\n')).not.toContain('SCAN COMPLETE');
      expect(errors.join('\n')).toContain('Scan busy:');
      expect(process.exitCode).toBe(2);
    } finally {
      console.log = originalLog;
      console.error = originalError;
      fixture.cleanup();
    }
  });
});
