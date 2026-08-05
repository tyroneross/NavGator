/**
 * CLI exit-code contract (Ops Center 38533730).
 *
 * Invokes the BUILT CLI (`dist/cli/index.js`) as a real subprocess and
 * asserts on the process exit code — not a unit test of a helper function.
 * `src/cli/exit-codes.ts` defines the contract these assertions check:
 *
 *   0 SUCCESS · 1 OPERATIONAL · 2 NO_DATA · 3 NOT_FOUND · 4 USAGE
 *
 * Requires `npm run build:cli` to have run first (see package.json's
 * `test:release` / this task's own instructions) — `beforeAll` below fails
 * with an actionable message if `dist/cli/index.js` is missing rather than
 * failing every test with an opaque ENOENT.
 *
 * Timeouts are explicit and generous — CI runs on 2 cores (see
 * scripts/verify-release.mjs's `probeCli` for the same convention).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const repoRoot = path.resolve(__dirname, '..', '..');
const cliEntry = path.join(repoRoot, 'dist', 'cli', 'index.js');

let scannedProject: string;
let unscannedProject: string;

interface CliResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function runCli(args: string[], cwd: string, timeout = 60_000): CliResult {
  const result = spawnSync(process.execPath, [cliEntry, ...args], {
    cwd,
    env: process.env,
    encoding: 'utf8',
    timeout,
  });
  if (result.error) {
    throw new Error(`navgator ${args.join(' ')} failed to spawn: ${result.error.message}`);
  }
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** Newest mtime under a directory tree, or 0 if it does not exist. */
function newestMtimeMs(dir: string): number {
  if (!fs.existsSync(dir)) return 0;
  let newest = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    newest = Math.max(newest, entry.isDirectory() ? newestMtimeMs(full) : fs.statSync(full).mtimeMs);
  }
  return newest;
}

beforeAll(() => {
  if (!fs.existsSync(cliEntry)) {
    throw new Error(
      `${cliEntry} does not exist — run \`npm run build:cli\` before running this test file.`
    );
  }

  // This file is the only test that exercises the SHIPPED CLI, and it spawns
  // dist/ rather than importing src/. That makes it silently vacuous against a
  // stale build: mutating src/cli/index.ts's exitOverride(), the
  // natural-language redirect, and find.ts's NOT_FOUND assignment each left
  // this suite fully green until dist was rebuilt.
  //
  // Two gates close that, and they are deliberately different mechanisms
  // because mtime means different things in the two environments:
  //
  //   locally  — an edited src/cli is genuinely newer than a stale dist/cli,
  //              so the mtime comparison below is a fast, accurate signal.
  //   in CI    — a fresh checkout stamps EVERY file at clone time, so the
  //              relative order of src/cli and dist/cli is an artifact of
  //              checkout, not of staleness. This check is therefore skipped
  //              there; it fired as a false failure the first time it shipped.
  //              CI's authoritative gate is the `git diff --exit-code -- dist`
  //              step that runs after `npm run build` in .github/workflows/ci.yml,
  //              which compares built output against committed output and does
  //              not depend on timestamps at all.
  if (!process.env.CI) {
    const srcNewest = newestMtimeMs(path.join(repoRoot, 'src', 'cli'));
    const distNewest = newestMtimeMs(path.join(repoRoot, 'dist', 'cli'));
    if (srcNewest > distNewest) {
      throw new Error(
        `dist/cli is older than src/cli — run \`npm run build:cli\`. This suite spawns the built ` +
          `CLI, so running it against a stale dist would assert the previous build's behaviour.`
      );
    }
  }

  unscannedProject = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-exitcode-unscanned-'));

  scannedProject = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-exitcode-scanned-'));
  fs.mkdirSync(path.join(scannedProject, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(scannedProject, 'package.json'),
    JSON.stringify({
      name: 'exit-code-fixture',
      version: '1.0.0',
      dependencies: { commander: '^14.0.0' },
    })
  );
  fs.writeFileSync(
    path.join(scannedProject, 'src', 'index.ts'),
    "import { Command } from 'commander';\nexport const program = new Command();\n"
  );

  const scan = runCli(['scan', '--quick', '--agent'], scannedProject, 120_000);
  if (scan.status !== 0) {
    throw new Error(
      `fixture scan failed (exit ${scan.status}), can't build NOT_FOUND/SUCCESS fixtures: ${scan.stdout}\n${scan.stderr}`
    );
  }
}, 120_000);

afterAll(() => {
  for (const dir of [scannedProject, unscannedProject]) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup only — never fail the suite over a leftover tmpdir.
    }
  }
});

describe('CLI exit-code contract', () => {
  it('SUCCESS (0): a command that runs and produces its result', () => {
    const result = runCli(['status', '--agent', '--no-refresh'], scannedProject);
    expect(result.status).toBe(0);
    expect(() => JSON.parse(result.stdout)).not.toThrow();
  });

  it('SUCCESS (0): --version', () => {
    const result = runCli(['--version'], scannedProject);
    expect(result.status).toBe(0);
  });

  it('SUCCESS (0): --help', () => {
    const result = runCli(['--help'], scannedProject);
    expect(result.status).toBe(0);
  });

  it('NO_DATA (2): status --agent with no scan data available', () => {
    const result = runCli(['status', '--agent', '--no-refresh'], unscannedProject);
    expect(result.status).toBe(2);
  });

  it('NO_DATA (2): impact --agent with no scan data available', () => {
    const result = runCli(['impact', 'anything', '--agent'], unscannedProject);
    expect(result.status).toBe(2);
  });

  it('NO_DATA (2): list --agent with no scan data available', () => {
    const result = runCli(['list', '--agent'], unscannedProject);
    expect(result.status).toBe(2);
  });

  it('NOT_FOUND (3): impact --agent against an unknown component', () => {
    const result = runCli(['impact', 'NoSuchComponentXYZ', '--agent'], scannedProject);
    expect(result.status).toBe(3);
  });

  it('NOT_FOUND (3): connections --agent against an unknown component', () => {
    const result = runCli(['connections', 'NoSuchComponentXYZ', '--agent'], scannedProject);
    expect(result.status).toBe(3);
  });

  it('NOT_FOUND (3): lessons show against an unregistered lesson id', () => {
    const result = runCli(['lessons', 'show', 'no-such-lesson-id', '--agent'], scannedProject);
    expect(result.status).toBe(3);
  });

  it('NOT_FOUND (3): diagram --focus against an unknown component', () => {
    const result = runCli(['diagram', '--focus', 'NoSuchComponentXYZ'], scannedProject);
    expect(result.status).toBe(3);
  });

  it('USAGE (4): the natural-language redirect', () => {
    const result = runCli(['please refactor my whole auth flow'], scannedProject);
    expect(result.status).toBe(4);
    expect(result.stdout).toContain('needs Claude Code');
  });

  it('USAGE (4): a missing required option (Commander parse error)', () => {
    const result = runCli(['changes'], scannedProject);
    expect(result.status).toBe(4);
  });

  it('USAGE (4): an unknown subcommand (Commander parse error)', () => {
    const result = runCli(['totally-bogus-command-xyz'], scannedProject);
    expect(result.status).toBe(4);
  });

  it('USAGE (4): an unregistered project scanned as a project reference', () => {
    // registry-log's --actor validation is a hand-rolled invocation check,
    // not a Commander-level parse error — exercises the other USAGE path.
    const result = runCli(['registry-log', '--actor', 'not-a-real-actor'], scannedProject);
    expect(result.status).toBe(4);
  });

  it('OPERATIONAL (1): a genuine failure (unwritable output path)', () => {
    const result = runCli(
      ['diagram', '--output', '/this/path/does/not/exist/out.md'],
      scannedProject
    );
    expect(result.status).toBe(1);
  });
});
