/**
 * Tests for `scripts/artifact-guard.mjs` — the pre-commit guard that keeps the
 * committed generated artifacts (`dist/`, `ARCHITECTURE.md`,
 * `docs/architecture/index.json`) in sync with their sources.
 *
 * The guard is a plain `.mjs` with no build step, so it is imported through a
 * computed dynamic specifier: `tsconfig.json` sets `rootDir: ./src` without
 * `allowJs`, and a static import would fail `npm run typecheck`.
 *
 * What is NOT covered here, deliberately: a full `--staged` round trip. That
 * runs `npm run build:cli` over the whole tree and would make this suite a
 * multi-second build. The commit path exercises it on every commit instead —
 * which is the point of the control.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { execFileSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const GUARD_PATH = path.join(REPO_ROOT, 'scripts', 'artifact-guard.mjs');
const SOURCE_HOOK_PATH = path.join(REPO_ROOT, 'scripts', 'git-hooks', 'pre-commit');

/* eslint-disable @typescript-eslint/no-explicit-any */
let guard: any;

beforeAll(async () => {
  // Computed specifier: TypeScript resolves this to `any` rather than trying to
  // typecheck a .mjs outside rootDir.
  const specifier = pathToFileURL(GUARD_PATH).href;
  guard = await import(/* @vite-ignore */ specifier);
});

describe('watch matching', () => {
  it('`**` matches any path', () => {
    expect(guard.matchesPattern('**', 'anything/at/all.txt')).toBe(true);
  });

  it('a trailing slash matches the directory and everything under it', () => {
    expect(guard.matchesPattern('src/', 'src/cli/index.ts')).toBe(true);
    expect(guard.matchesPattern('src/', 'src')).toBe(true);
    expect(guard.matchesPattern('src/', 'srcfoo/bar.ts')).toBe(false);
  });

  it('a leading `*.` matches by extension', () => {
    expect(guard.matchesPattern('*.py', 'scripts/registry_lag.py')).toBe(true);
    expect(guard.matchesPattern('*.py', 'scripts/registry_lag.pyc')).toBe(false);
  });

  it('anything else is an exact repo-relative path', () => {
    expect(guard.matchesPattern('tsconfig.json', 'tsconfig.json')).toBe(true);
    expect(guard.matchesPattern('tsconfig.json', 'web/tsconfig.json')).toBe(false);
  });
});

describe('registry', () => {
  const byName = (name: string) => guard.ARTIFACTS.find((a: any) => a.name === name);

  it('orders `dist` before `architecture-index`', () => {
    // Not cosmetic: `npm run architecture` executes `node dist/cli/index.js`,
    // so a stale dist would generate the index with the previous compiler
    // output. The pipeline relies on registry order for that dependency.
    const names = guard.ARTIFACTS.map((a: any) => a.name);
    expect(names.indexOf('dist')).toBeLessThan(names.indexOf('architecture-index'));
  });

  it('regenerates dist with build:cli, not the full build', () => {
    // `npm run build` adds a Next.js production build whose output is entirely
    // gitignored — seconds of pre-commit latency for zero tracked bytes.
    expect(byName('dist').regen).toEqual(['npm', 'run', 'build:cli']);
  });

  it('treats only exit 2 as a stale architecture index', () => {
    // `arch-index --check` exits NO_DATA (2) when stale and OPERATIONAL (1) on
    // an internal error. Treating any non-zero as drift would let a broken
    // generator masquerade as a stale artifact and get "regenerated" forever.
    expect(byName('architecture-index').check.staleExit).toEqual([2]);
  });

  it('watches a Python-only change — the 85e5b5e regression', () => {
    // 85e5b5e added scripts/*.py + .github/*.yml and ZERO src/ files, yet still
    // drifted the architecture index (fixed by bccef45). arch-index counts 25
    // extensions across the whole tree, so a src/-scoped trigger would have
    // missed the most recent observed failure.
    const staged = ['scripts/registry_lag.py', '.github/workflows/release-staleness.yml'];
    expect(guard.matchesWatch(byName('architecture-index'), staged)).toBe(true);
    expect(guard.matchesWatch(byName('dist'), staged)).toBe(false);
  });

  it('every artifact declares outputs, a regen command and a reason', () => {
    for (const artifact of guard.ARTIFACTS) {
      expect(artifact.outputs.length).toBeGreaterThan(0);
      expect(artifact.regen.length).toBeGreaterThan(0);
      expect(artifact.why.length).toBeGreaterThan(0);
    }
  });

  it('names artifact outputs that exist in this repo', () => {
    for (const artifact of guard.ARTIFACTS) {
      for (const output of artifact.outputs) {
        expect(fs.existsSync(path.join(REPO_ROOT, output)), `${artifact.name}: ${output}`).toBe(true);
      }
    }
  });
});

describe('argument parsing', () => {
  it('defaults to the read-only check', () => {
    expect(guard.parseArgs([]).mode).toBe('check');
  });

  it('maps each flag to its mode', () => {
    expect(guard.parseArgs(['--staged']).mode).toBe('staged');
    expect(guard.parseArgs(['--list']).mode).toBe('list');
    expect(guard.parseArgs(['--install-hook']).mode).toBe('install-hook');
    expect(guard.parseArgs(['--hook-status']).mode).toBe('hook-status');
  });

  it('takes an optional artifact name after --regen', () => {
    expect(guard.parseArgs(['--regen'])).toMatchObject({ mode: 'regen', regen: 'all' });
    expect(guard.parseArgs(['--regen', 'dist'])).toMatchObject({ mode: 'regen', regen: 'dist' });
    expect(guard.parseArgs(['--regen', '--json'])).toMatchObject({ mode: 'regen', regen: 'all', json: true });
  });

  it('rejects an unknown argument instead of silently ignoring it', () => {
    expect(guard.parseArgs(['--nope']).error).toContain('--nope');
  });
});

describe('git environment isolation', () => {
  it('resolves the repo root under a hook\'s inherited GIT_DIR', () => {
    // Regression. `git commit` exports GIT_DIR=.git (RELATIVE) to its hooks, and
    // `git -C <dir> rev-parse --show-toplevel` resolves that relative GIT_DIR
    // against <dir>. Asking from the guard's own directory therefore answered
    // `<root>/scripts`, and every output path derived from it went one level
    // deep: a regenerated ARCHITECTURE.md landed at `scripts/ARCHITECTURE.md`
    // while the real one stayed stale and the commit shipped an inconsistent
    // pair. Reproduced by exporting the same variable git does.
    // The path arrives by env, not argv: the guard's own `main()` fires when
    // `process.argv[1]` is the module, which would run a real check instead.
    const probe = [
      'const g = await import(process.env.GUARD_PROBE_PATH);',
      'process.stdout.write(g.detectRepo());',
    ].join('');
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', probe], {
      cwd: REPO_ROOT,
      encoding: 'utf-8',
      env: { ...process.env, GIT_DIR: '.git', GUARD_PROBE_PATH: pathToFileURL(GUARD_PATH).href },
    });
    expect(result.status).toBe(0);
    expect(fs.realpathSync(result.stdout.trim())).toBe(fs.realpathSync(REPO_ROOT));
  });

  it('strips every GIT_* variable', () => {
    // A git subprocess that inherits the hook's GIT_DIR / GIT_INDEX_FILE binds
    // to the COMMITTING repo's index instead of the throwaway worktree it was
    // pointed at, which silently defeats the isolation.
    const cleaned = guard.cleanGitEnv({ GIT_DIR: '.git', GIT_INDEX_FILE: '/tmp/i', PATH: '/usr/bin' });
    expect(cleaned).toEqual({ PATH: '/usr/bin' });
  });
});

describe('source hook segment', () => {
  it('extracts the marked segment from the committed source hook', () => {
    const segment = guard.sourceSegment(REPO_ROOT);
    expect(segment).toContain(guard.HOOK_MARKER);
    expect(segment).toContain(guard.HOOK_MARKER_END);
    expect(segment).toContain('scripts/artifact-guard.mjs');
    expect(segment).toContain('--staged');
  });

  it('does not extract the source hook\'s standalone trailing `exit 0`', () => {
    // The standalone file keeps `exit 0` for manual single-segment use. Copying
    // it into a chained hook would turn every later-appended segment into dead
    // code — silently disabling someone else's guard.
    expect(fs.readFileSync(SOURCE_HOOK_PATH, 'utf-8')).toMatch(/exit 0\s*$/);
    expect(guard.sourceSegment(REPO_ROOT)).not.toMatch(/^exit 0$/m);
  });
});

describe('hook installer', () => {
  let repo: string;

  const readHook = () => fs.readFileSync(path.join(repo, '.git', 'hooks', 'pre-commit'), 'utf-8');

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-guard-test-'));
    execFileSync('git', ['init', '-q'], { cwd: repo });
    fs.mkdirSync(path.join(repo, 'scripts', 'git-hooks'), { recursive: true });
    fs.copyFileSync(SOURCE_HOOK_PATH, path.join(repo, 'scripts', 'git-hooks', 'pre-commit'));
  });

  afterEach(() => {
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it('creates an executable hook when none exists', () => {
    expect(guard.installHook(repo)).toMatchObject({ installed: true, action: 'created' });
    const hook = path.join(repo, '.git', 'hooks', 'pre-commit');
    expect(fs.readFileSync(hook, 'utf-8')).toMatch(/^#!\/bin\/sh/);
    expect(fs.statSync(hook).mode & 0o111).toBeGreaterThan(0);
  });

  it('leaves no trailing `exit 0` that would shadow a later segment', () => {
    guard.installHook(repo);
    expect(readHook()).not.toMatch(/^exit 0$/m);
  });

  it('is idempotent — a second install resyncs in place', () => {
    guard.installHook(repo);
    const first = readHook();
    expect(guard.installHook(repo)).toMatchObject({ installed: true, action: 'resynced' });
    expect(readHook()).toBe(first);
  });

  it('chains into a foreign hook without displacing it', () => {
    const hookDir = path.join(repo, '.git', 'hooks');
    fs.mkdirSync(hookDir, { recursive: true });
    fs.writeFileSync(path.join(hookDir, 'pre-commit'), '#!/bin/sh\necho other-guard\n');

    expect(guard.installHook(repo)).toMatchObject({ installed: true, action: 'chained' });
    const body = readHook();
    expect(body).toContain('echo other-guard');
    // Inserted right after the shebang, so it runs before a foreign segment
    // AND before any trailing `exit 0` an earlier installer left behind.
    expect(body.indexOf(guard.HOOK_MARKER)).toBeLessThan(body.indexOf('echo other-guard'));
  });

  it('reports status and removes only its own segment', () => {
    expect(guard.hookStatus(repo).installed).toBe(false);
    guard.installHook(repo);
    expect(guard.hookStatus(repo).installed).toBe(true);

    fs.appendFileSync(path.join(repo, '.git', 'hooks', 'pre-commit'), 'echo appended-later\n');
    expect(guard.uninstallHook(repo)).toMatchObject({ removed: true });
    expect(readHook()).toContain('echo appended-later');
    expect(guard.hookStatus(repo).installed).toBe(false);
  });

  it('refuses to install without the source hook rather than inventing a segment', () => {
    fs.rmSync(path.join(repo, 'scripts', 'git-hooks', 'pre-commit'));
    expect(guard.installHook(repo)).toMatchObject({ installed: false });
  });
});

describe('toolchain resolution', () => {
  it('returns null when neither this checkout nor a main worktree is installed', () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-guard-nm-'));
    try {
      execFileSync('git', ['init', '-q'], { cwd: repo });
      expect(guard.resolveNodeModules(repo)).toBeNull();
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  it('resolves this repo\'s own node_modules when present', () => {
    // The suite itself only runs with dependencies installed, so this is a
    // statement about the resolver, not an environment assumption.
    const resolved = guard.resolveNodeModules(REPO_ROOT);
    expect(resolved).not.toBeNull();
    expect(fs.existsSync(resolved.path)).toBe(true);
  });
});

describe('command line', () => {
  const runGuard = (args: string[], cwd = REPO_ROOT) =>
    spawnSync(process.execPath, [GUARD_PATH, ...args], { cwd, encoding: 'utf-8' });

  it('--list --json describes the whole registry', () => {
    const result = runGuard(['--list', '--json']);
    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.artifacts.map((a: any) => a.name)).toEqual(guard.ARTIFACTS.map((a: any) => a.name));
  });

  it('--hook-status answers without mutating anything', () => {
    const result = runGuard(['--hook-status']);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toHaveProperty('installed');
  });

  it('exits 2 on an unknown argument', () => {
    expect(runGuard(['--not-a-flag']).status).toBe(2);
  });

  it('--staged is a no-op with an empty index', () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-guard-empty-'));
    try {
      execFileSync('git', ['init', '-q'], { cwd: repo });
      const result = runGuard(['--staged', '--repo', repo], repo);
      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });
});
