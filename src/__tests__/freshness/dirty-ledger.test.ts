import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as ts from 'typescript';
import {
  captureDirtySnapshot,
  clearDirty,
  clearDirtySnapshot,
  markDirty,
  readDirty,
} from '../../freshness/dirty-ledger.js';

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'nv-dirty-'));
  fs.mkdirSync(path.join(root, '.navgator'), { recursive: true });
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function compileDirtyLedgerRuntime(targetRoot: string): string {
  const sourceRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
  );
  const outDir = path.join(targetRoot, 'ledger-runtime');
  const rootNames = [
    path.join(sourceRoot, 'scan-lock.ts'),
    path.join(sourceRoot, 'config.ts'),
    path.join(sourceRoot, 'freshness', 'paths.ts'),
    path.join(sourceRoot, 'freshness', 'dirty-ledger.ts'),
  ];
  const program = ts.createProgram({
    rootNames,
    options: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      rootDir: sourceRoot,
      outDir,
      strict: true,
      skipLibCheck: true,
      noEmitOnError: true,
    },
  });
  const emitted = program.emit();
  const errors = [...ts.getPreEmitDiagnostics(program), ...emitted.diagnostics]
    .filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
  if (errors.length > 0) {
    throw new Error(ts.formatDiagnosticsWithColorAndContext(errors, {
      getCanonicalFileName: (fileName) => fileName,
      getCurrentDirectory: () => process.cwd(),
      getNewLine: () => '\n',
    }));
  }
  return path.join(outDir, 'freshness', 'dirty-ledger.js');
}

async function waitForFile(filePath: string, timeoutMs: number = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!fs.existsSync(filePath)) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${filePath}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe('dirty ledger', () => {
  it('starts empty', () => {
    expect(readDirty(root)).toEqual([]);
  });

  it('marks and reads paths, deduped and sorted', () => {
    markDirty(['b.ts', 'a.ts', 'b.ts'], root);
    expect(readDirty(root)).toEqual(['a.ts', 'b.ts']);
  });

  it('accumulates across calls', () => {
    markDirty(['a.ts'], root);
    markDirty(['c.ts'], root);
    expect(readDirty(root)).toEqual(['a.ts', 'c.ts']);
  });

  it('clears only the drained subset, leaving late arrivals', () => {
    markDirty(['a.ts', 'b.ts', 'c.ts'], root);
    clearDirty(['a.ts', 'b.ts'], root);
    expect(readDirty(root)).toEqual(['c.ts']);
  });

  it('tolerates a corrupt ledger by resetting to empty', () => {
    fs.writeFileSync(path.join(root, '.navgator', 'dirty.json'), '{not json');
    expect(readDirty(root)).toEqual([]);
    markDirty(['a.ts'], root);
    expect(readDirty(root)).toEqual(['a.ts']);
  });

  it('preserves a same-path event created after snapshot enumeration', () => {
    markDirty(['a.ts'], root);
    const snapshot = captureDirtySnapshot(root, {
      afterEventList: () => markDirty(['a.ts'], root),
    });

    clearDirtySnapshot(snapshot, root);
    expect(readDirty(root)).toEqual(['a.ts']);
  });

  it('preserves a same-path event created during snapshot clearing', () => {
    markDirty(['a.ts'], root);
    const snapshot = captureDirtySnapshot(root);

    clearDirtySnapshot(snapshot, root, {
      beforeSnapshotDelete: () => markDirty(['a.ts'], root),
    });
    expect(readDirty(root)).toEqual(['a.ts']);
  });

  it('binds legacy bytes to the opened inode and preserves a replacement generation', () => {
    const legacy = path.join(root, '.navgator', 'dirty.json');
    fs.writeFileSync(legacy, JSON.stringify({
      version: 1,
      paths: ['old.ts'],
      updated_at: 1,
    }));

    const snapshot = captureDirtySnapshot(root, {
      afterLegacyRead: () => {
        const replacement = `${legacy}.replacement`;
        fs.writeFileSync(replacement, JSON.stringify({
          version: 1,
          paths: ['late.ts'],
          updated_at: 2,
        }));
        fs.renameSync(replacement, legacy);
      },
    });

    expect(snapshot.paths).toEqual(['old.ts']);
    clearDirtySnapshot(snapshot, root);
    expect(readDirty(root)).toEqual(['late.ts']);
  });

  it('preserves every path under high-fanout multiprocess marking', async () => {
    const modulePath = compileDirtyLedgerRuntime(root);
    const workerCount = 40;
    const marksPerWorker = 16;
    const children: ChildProcess[] = [];
    const runner = `
      import { markDirty } from ${JSON.stringify(pathToFileURL(modulePath).href)};
      const root = process.argv[1];
      const worker = Number(process.argv[2]);
      for (let index = 0; index < ${marksPerWorker}; index += 1) {
        markDirty([\`worker-\${worker}/path-\${index}.ts\`], root);
      }
    `;

    try {
      const results = await Promise.all(Array.from({ length: workerCount }, (_, worker) => {
        const child = spawn(
          process.execPath,
          ['--input-type=module', '-e', runner, root, String(worker)],
          {
            stdio: ['ignore', 'ignore', 'pipe'],
            env: {
              ...process.env,
              NAVGATOR_MODE: 'local',
              NAVGATOR_PATH: '.navgator/architecture',
            },
          },
        );
        children.push(child);
        let stderr = '';
        child.stderr?.on('data', (chunk) => { stderr += String(chunk); });
        return new Promise<{ code: number | null; stderr: string }>((resolve, reject) => {
          child.once('error', reject);
          child.once('exit', (code) => resolve({ code, stderr }));
        });
      }));

      expect(results.filter((result) => result.code !== 0)).toEqual([]);
      const expected = Array.from({ length: workerCount }, (_, worker) =>
        Array.from({ length: marksPerWorker }, (_unused, index) =>
          `worker-${worker}/path-${index}.ts`)).flat().sort();
      expect(readDirty(root)).toEqual(expected);
    } finally {
      for (const child of children) child.kill('SIGKILL');
    }
  }, 60_000);

  it('serializes a delayed marker stamp rename behind drain lifecycle writes', async () => {
    const modulePath = compileDirtyLedgerRuntime(root);
    const stamp = path.join(root, '.navgator', 'architecture', 'freshness.json');
    const markerReady = path.join(root, 'marker-ready');
    const releaseMarker = path.join(root, 'release-marker');
    const writerQueued = path.join(root, 'writer-queued');
    fs.mkdirSync(path.dirname(stamp), { recursive: true });
    fs.writeFileSync(stamp, JSON.stringify({
      version: 1,
      generated_at: 1,
      commit_sha: '',
      branch: '',
      dirty_files: [],
      dirty_count: 0,
      scan_in_flight: true,
    }));

    const markerScript = `
      import fs from 'node:fs';
      import { markDirty } from ${JSON.stringify(pathToFileURL(modulePath).href)};
      const [root, ready, release] = process.argv.slice(1);
      markDirty(['late.ts'], root, {
        beforeStampRename: () => {
          fs.writeFileSync(ready, 'ready');
          while (!fs.existsSync(release)) {
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2);
          }
        },
      });
    `;
    const writerScript = `
      import fs from 'node:fs';
      import { withDirtyLedgerMutationLock, readDirty } from ${JSON.stringify(pathToFileURL(modulePath).href)};
      const [root, stamp, queued] = process.argv.slice(1);
      fs.writeFileSync(queued, 'queued');
      withDirtyLedgerMutationLock(root, () => {
        const current = JSON.parse(fs.readFileSync(stamp, 'utf8'));
        const dirty = readDirty(root);
        const candidate = stamp + '.writer';
        fs.writeFileSync(candidate, JSON.stringify({
          ...current,
          dirty_files: dirty,
          dirty_count: dirty.length,
          scan_in_flight: false,
        }));
        fs.renameSync(candidate, stamp);
      });
    `;
    const children: ChildProcess[] = [];
    const run = (
      script: string,
      args: string[],
    ): { child: ChildProcess; completed: Promise<{ code: number | null; stderr: string }> } => {
      const child = spawn(process.execPath, ['--input-type=module', '-e', script, ...args], {
        stdio: ['ignore', 'ignore', 'pipe'],
      });
      children.push(child);
      let stderr = '';
      child.stderr?.on('data', (chunk) => { stderr += String(chunk); });
      return {
        child,
        completed: new Promise((resolve, reject) => {
          child.once('error', reject);
          child.once('exit', (code) => resolve({ code, stderr }));
        }),
      };
    };

    try {
      const marker = run(markerScript, [root, markerReady, releaseMarker]);
      await waitForFile(markerReady);
      const writer = run(writerScript, [root, stamp, writerQueued]);
      await waitForFile(writerQueued);
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(JSON.parse(fs.readFileSync(stamp, 'utf8')).scan_in_flight).toBe(true);

      fs.writeFileSync(releaseMarker, 'go');
      expect(await marker.completed).toMatchObject({ code: 0 });
      expect(await writer.completed).toMatchObject({ code: 0 });

      const finalStamp = JSON.parse(fs.readFileSync(stamp, 'utf8')) as {
        dirty_files: string[];
        dirty_count: number;
        scan_in_flight: boolean;
      };
      expect(finalStamp.scan_in_flight).toBe(false);
      expect(finalStamp.dirty_files).toEqual(['late.ts']);
      expect(finalStamp.dirty_count).toBe(1);
    } finally {
      for (const child of children) child.kill('SIGKILL');
    }
  }, 15_000);
});
