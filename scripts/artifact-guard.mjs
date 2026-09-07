#!/usr/bin/env node
/**
 * artifact-guard.mjs — keep NavGator's checked-in generated artifacts in sync
 * at commit time.
 *
 * NAMED FAILURE THIS EARNS ITS PLACE AGAINST
 * ------------------------------------------
 * `dist/`, `ARCHITECTURE.md`, and `docs/architecture/index.json` are committed
 * on purpose (a fresh clone, and any agent dispatched into one, must find them
 * without running a build or a scan first). CI gates both — `Assert committed
 * dist matches source` and `Assert committed architecture index matches
 * source` — but regeneration was a manual step nobody owned, so main went red
 * and needed a follow-up regen commit:
 *
 *   c0e36f4 → fixed by 579b477   (src/ + dist/ changed; index still stale)
 *   85e5b5e → fixed by bccef45   (scripts/*.py + .github/*.yml ONLY, zero src/)
 *
 * `85e5b5e` is why this guard does not watch `src/`. `arch-index` counts 25
 * file extensions across the whole tree (`LANGUAGE_BY_EXTENSION` in
 * `src/architecture-index.ts` — `.py`, `.sh`, `.rs`, `.go` included), so a
 * `src/`-scoped trigger misses the most recent observed failure. Re-listing
 * that extension map here would recreate the exact drift class the guard
 * exists to close, so the architecture artifact watches everything and leans
 * on its own cheap freshness probe (0.6s measured) instead.
 *
 * DESIGN (systems-not-discipline, DRY)
 * -----------------------------------
 * ONE engine over a registry. Each artifact declares watched source patterns,
 * an optional cheap freshness check, a regen command, and the outputs to
 * re-stage. Adding a future checked-in generated file is a one-entry edit to
 * `ARTIFACTS`.
 *
 * The registry is ORDERED and the pipeline runs in one shared frame, because
 * the second artifact's generator is the first artifact's output:
 * `npm run architecture` executes `node dist/cli/index.js`.
 *
 * MODES
 * -----
 *   --staged      pre-commit: regenerate + re-stage drifted artifacts. Always
 *                 regenerates from the STAGED INDEX in a throwaway worktree,
 *                 never the live working tree, so a concurrent agent's
 *                 unstaged edit or untracked file cannot be compiled into an
 *                 artifact this commit ships.
 *   --check       read-only freshness gate (CI / manual). Never mutates the
 *                 working tree — a regen-and-compare artifact is evaluated in
 *                 an isolated worktree.
 *   --regen [N]   regenerate N (or all) into the working tree.
 *   --list        introspect the registry.
 *   --install-hook / --uninstall-hook / --hook-status
 *
 * `NAVGATOR_ARTIFACT_ADVISORY=1` downgrades `--staged` to a warning: no regen,
 * no block. Use it to land a commit during an outage, then fix before CI.
 *
 * Exit codes: 0 ok · 1 drift unfixable / regen failed · 2 usage.
 *
 * SPDX-FileCopyrightText: 2025-2026 Tyrone Ross, Jr <46267523+tyroneross@users.noreply.github.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/**
 * @typedef {object} Artifact
 * @property {string}   name
 * @property {string[]} watch   Source patterns. `**` = any staged path; a
 *                              trailing `/` = directory prefix; a leading `*.`
 *                              = extension; otherwise an exact repo-relative
 *                              path.
 * @property {string[]} regen   argv, run with cwd = the frame.
 * @property {string[]} outputs Repo-relative files or directories to re-stage.
 * @property {?{argv: string[], staleExit: number[]}} check
 *                              Cheap freshness probe. Exit 0 = fresh; an exit
 *                              in `staleExit` = stale; anything else = the
 *                              probe itself failed. `null` means the artifact
 *                              has no probe, so freshness is decided by
 *                              regenerating and comparing bytes.
 * @property {string}   why
 */

/** @type {Artifact[]} */
export const ARTIFACTS = [
  {
    name: 'dist',
    // tsc's inputs: `src/**` minus `src/__tests__/**` (tsconfig `exclude`), plus
    // the two files that decide how it compiles. Staging a test file is a cheap
    // false positive — the regen just produces no change.
    watch: ['src/', 'tsconfig.json', 'package.json'],
    check: null,
    // `npm run build`, which the CI gate runs, is build:cli + build:web. The
    // web half is a Next.js production build whose entire output is gitignored
    // (`web/.next/`, `web/runtime/`, `web/server.cjs`) — zero tracked bytes for
    // seconds of pre-commit latency. `build:cli` alone reproduces dist/
    // byte-identically.
    regen: ['npm', 'run', 'build:cli'],
    outputs: ['dist'],
    why: 'tsc output is committed so marketplace installs resolve .mcp.json paths without a build',
  },
  {
    name: 'architecture-index',
    watch: ['**'],
    // Exits NO_DATA (2) when stale and OPERATIONAL (1) on an internal error —
    // see src/cli/exit-codes.ts and the arch-index docblock. Naming 2
    // explicitly stops a broken generator from reading as a stale artifact.
    check: { argv: ['node', 'dist/cli/index.js', 'arch-index', '--check'], staleExit: [2] },
    regen: ['npm', 'run', 'architecture'],
    outputs: ['ARCHITECTURE.md', 'docs/architecture/index.json'],
    why: 'a cold clone, and any agent dispatched into one, must find the architecture without scanning',
  },
];

/** Abandoned isolation worktrees older than this are reaped on entry. */
export const STALE_WORKTREE_AGE_MS = 2 * 60 * 60 * 1000;

const WORKTREE_PREFIX = 'navgator-artifact-guard-';

// ---------------------------------------------------------------------------
// Watch matching
// ---------------------------------------------------------------------------

/** Whether one repo-relative path matches one watch pattern. */
export function matchesPattern(pattern, filePath) {
  if (pattern === '**') return true;
  if (pattern.endsWith('/')) {
    return filePath === pattern.slice(0, -1) || filePath.startsWith(pattern);
  }
  if (pattern.startsWith('*.')) return filePath.endsWith(pattern.slice(1));
  return filePath === pattern;
}

/** Whether any of `paths` matches any of the artifact's watch patterns. */
export function matchesWatch(artifact, paths) {
  return paths.some((p) => artifact.watch.some((w) => matchesPattern(w, p)));
}

// ---------------------------------------------------------------------------
// git helpers
// ---------------------------------------------------------------------------

function run(argv, { cwd, env } = {}) {
  const result = spawnSync(argv[0], argv.slice(1), {
    cwd,
    env: env ?? process.env,
    encoding: 'utf-8',
    // npm on Windows is a .cmd; harmless elsewhere and keeps `npm run` working
    // when the hook runs under a minimal shell.
    shell: process.platform === 'win32',
  });
  return {
    code: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    detail: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim(),
  };
}

function git(repo, args, env) {
  return run(['git', '-C', repo, ...args], { env });
}

/**
 * A copy of the environment with git's hook-injected location variables
 * removed. During `git commit` the pre-commit hook inherits `GIT_DIR` /
 * `GIT_INDEX_FILE` / `GIT_WORK_TREE` pointing at the committing repo; a git
 * subprocess that inherits them binds to THAT index instead of the throwaway
 * worktree it was pointed at.
 */
export function cleanGitEnv(base = process.env) {
  return Object.fromEntries(Object.entries(base).filter(([k]) => !k.startsWith('GIT_')));
}

function lines(out) {
  return out.split('\n').map((l) => l.trim()).filter(Boolean);
}

function stagedFiles(repo) {
  const cp = git(repo, ['diff', '--cached', '--name-only']);
  return cp.code === 0 ? lines(cp.stdout) : [];
}

/**
 * Everything present in the working tree but NOT in the index: tracked files
 * with unstaged edits, plus untracked (non-ignored) files.
 *
 * Untracked files belong in this set. `tsc` compiles `src/**` off disk, so an
 * untracked `src/*.ts` an agent has not staged yet would be compiled into
 * `dist` and shipped inside somebody else's commit — the same leak as an
 * unstaged edit, through a path `git diff` never reports.
 */
function outOfIndexFiles(repo) {
  const modified = git(repo, ['diff', '--name-only']);
  const untracked = git(repo, ['ls-files', '--others', '--exclude-standard']);
  return [
    ...(modified.code === 0 ? lines(modified.stdout) : []),
    ...(untracked.code === 0 ? lines(untracked.stdout) : []),
  ];
}

/**
 * The repository root.
 *
 * Resolved with git's hook-injected variables STRIPPED. During `git commit`
 * the pre-commit hook inherits `GIT_DIR` (relative, `.git`), and
 * `git -C <dir> rev-parse --show-toplevel` then resolves that relative GIT_DIR
 * against `<dir>` — so asking from this script's own directory answered
 * `<root>/scripts`, and every output path derived from it was written one
 * level too deep. Observed: a regenerated `ARCHITECTURE.md` landing at
 * `scripts/ARCHITECTURE.md` while the real one stayed stale.
 */
export function detectRepo(explicit) {
  if (explicit) return path.resolve(explicit);
  const env = cleanGitEnv();
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (const from of [process.cwd(), here]) {
    const cp = run(['git', '-C', from, 'rev-parse', '--show-toplevel'], { env });
    if (cp.code === 0 && cp.stdout.trim()) return cp.stdout.trim();
  }
  return process.cwd();
}

// ---------------------------------------------------------------------------
// node_modules resolution
// ---------------------------------------------------------------------------

/**
 * An installed `node_modules` usable for regeneration, or null.
 *
 * Falls back to the MAIN worktree's when this checkout has none, because the
 * drift commits this guard exists to prevent came from `.build-loop/worktrees/`
 * checkouts that are never `npm install`ed. Same repo, same lockfile.
 */
export function resolveNodeModules(repo) {
  const own = path.join(repo, 'node_modules');
  if (fs.existsSync(own)) return { path: own, fallback: false };
  const cp = git(repo, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  if (cp.code !== 0 || !cp.stdout.trim()) return null;
  const mainRoot = path.dirname(cp.stdout.trim());
  const shared = path.join(mainRoot, 'node_modules');
  if (mainRoot !== repo && fs.existsSync(shared)) return { path: shared, fallback: true };
  return null;
}

// ---------------------------------------------------------------------------
// Output snapshots
// ---------------------------------------------------------------------------

function walkFiles(base, root, acc) {
  const stat = fs.existsSync(base) ? fs.statSync(base) : null;
  if (!stat) return acc;
  if (stat.isFile()) {
    acc.set(path.relative(root, base), fs.readFileSync(base));
    return acc;
  }
  if (stat.isDirectory()) {
    for (const entry of fs.readdirSync(base).sort()) {
      walkFiles(path.join(base, entry), root, acc);
    }
  }
  return acc;
}

/** relative path -> bytes, for every regular file under `outputs`. */
function snapshot(root, outputs) {
  const acc = new Map();
  for (const rel of outputs) walkFiles(path.join(root, rel), root, acc);
  return acc;
}

function snapshotsDiffer(a, b) {
  if (a.size !== b.size) return true;
  for (const [key, value] of a) {
    const other = b.get(key);
    if (!other || !value.equals(other)) return true;
  }
  return false;
}

function copyOutputs(srcRoot, dstRoot, outputs) {
  for (const rel of outputs) {
    const src = path.join(srcRoot, rel);
    const dst = path.join(dstRoot, rel);
    if (!fs.existsSync(src)) continue;
    if (fs.statSync(src).isDirectory()) {
      fs.rmSync(dst, { recursive: true, force: true });
      fs.cpSync(src, dst, { recursive: true });
    } else {
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(src, dst);
    }
  }
}

// ---------------------------------------------------------------------------
// Frame operations (a "frame" is a directory the regen commands run in)
// ---------------------------------------------------------------------------

/** @returns {'fresh'|'stale'|'unavailable'} plus detail. */
function probe(frame, artifact, env) {
  if (!artifact.check) return { state: 'unknown', detail: '' };
  const cp = run(artifact.check.argv, { cwd: frame, env });
  if (cp.code === 0) return { state: 'fresh', detail: cp.detail };
  if (artifact.check.staleExit.includes(cp.code)) return { state: 'stale', detail: cp.detail };
  return { state: 'unavailable', detail: cp.detail };
}

function regenerate(frame, artifact, env) {
  const before = snapshot(frame, artifact.outputs);
  const cp = run(artifact.regen, { cwd: frame, env });
  if (cp.code !== 0) return { ok: false, changed: false, detail: cp.detail };
  const after = snapshot(frame, artifact.outputs);
  return { ok: true, changed: snapshotsDiffer(before, after), detail: cp.detail };
}

export function regenCommand(artifact) {
  return artifact.regen.join(' ');
}

// ---------------------------------------------------------------------------
// Isolation
// ---------------------------------------------------------------------------

/**
 * Remove abandoned isolation worktrees. A hard kill (SIGKILL, crashed session,
 * machine sleep) runs no cleanup, and a registered worktree is not free — it
 * pins objects and shows up in every `git worktree list` a human or agent
 * reads. Age-gated so a CONCURRENT guard run is never removed out from under
 * itself. Fail-soft: hygiene inside a pre-commit gate must never block a commit.
 */
export function reapStaleWorktrees(repo, env, maxAgeMs = STALE_WORKTREE_AGE_MS) {
  let freed = 0;
  try {
    const listing = git(repo, ['worktree', 'list', '--porcelain'], env);
    if (listing.code !== 0) return 0;
    for (const line of listing.stdout.split('\n')) {
      if (!line.startsWith('worktree ')) continue;
      const wt = line.slice('worktree '.length).trim();
      if (!wt.includes(WORKTREE_PREFIX)) continue;
      let age;
      try {
        age = Date.now() - fs.statSync(wt).mtimeMs;
      } catch {
        git(repo, ['worktree', 'prune'], env);
        freed += 1;
        continue;
      }
      if (age < maxAgeMs) continue;
      git(repo, ['worktree', 'remove', '--force', wt], env);
      fs.rmSync(path.dirname(wt), { recursive: true, force: true });
      freed += 1;
    }
    if (freed) git(repo, ['worktree', 'prune'], env);
  } catch {
    return freed;
  }
  return freed;
}

/**
 * Run `fn(frame, env)` against the STAGED INDEX in a throwaway worktree.
 *
 * The isolated tree is exactly what is being committed (HEAD + staged changes)
 * with NO unstaged edits, so a generator that reads whole files cannot compile
 * a concurrent agent's uncommitted work into `dist` and ship it inside someone
 * else's commit. Returns `null` when isolation could not be set up — the caller
 * decides whether the in-place fallback is safe.
 */
function withIsolatedFrame(repo, nodeModules, fn) {
  // write-tree INHERITS git's env so it captures the exact index being
  // committed (git may point GIT_INDEX_FILE at a temp index for a partial
  // commit). The result is a content-addressed sha, portable to the worktree.
  const tree = git(repo, ['write-tree']);
  if (tree.code !== 0 || !tree.stdout.trim()) return null;
  const treeSha = tree.stdout.trim();

  // Everything below binds to the throwaway worktree, not the committing repo.
  const env = cleanGitEnv();
  reapStaleWorktrees(repo, env);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), WORKTREE_PREFIX));
  const wt = path.join(tmp, 'wt');
  try {
    if (git(repo, ['worktree', 'add', '--detach', '-q', wt, 'HEAD'], env).code !== 0) return null;
    try {
      if (git(wt, ['read-tree', treeSha], env).code !== 0) return null;
      if (git(wt, ['checkout-index', '-a', '-f'], env).code !== 0) return null;
      // A fresh worktree has no node_modules. A symlink is enough for tsc's
      // type resolution and for `node dist/cli/index.js` to find its deps; it
      // is gitignored, so it cannot pollute the frame's git state.
      fs.symlinkSync(nodeModules, path.join(wt, 'node_modules'), 'dir');
      return fn(wt, env);
    } finally {
      git(repo, ['worktree', 'remove', '--force', wt], env);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

/**
 * Run the ordered registry in one frame. Returns per-artifact results.
 *
 * `selected` is the subset whose watched sources are in play; unselected
 * artifacts are still probed (cheaply) but never regenerated, because a stale
 * artifact nobody's commit touched is CI's problem, not this commit's.
 */
function runPipeline(frame, env, selected, { regenAllowed }) {
  const results = [];
  for (const artifact of ARTIFACTS) {
    if (!selected.includes(artifact)) continue;
    const checked = probe(frame, artifact, env);
    if (checked.state === 'fresh') {
      results.push({ artifact, state: 'fresh', changed: false, detail: '' });
      continue;
    }
    if (checked.state === 'unavailable') {
      results.push({ artifact, state: 'unavailable', changed: false, detail: checked.detail });
      continue;
    }
    if (!regenAllowed) {
      // `unknown` survives as itself: an artifact with no freshness probe has
      // not been measured, and reporting it as stale would assert something
      // this path did not check.
      results.push({
        artifact,
        state: checked.state === 'unknown' ? 'unknown' : 'stale',
        changed: false,
        detail: checked.detail,
      });
      continue;
    }
    const regen = regenerate(frame, artifact, env);
    if (!regen.ok) {
      results.push({ artifact, state: 'failed', changed: false, detail: regen.detail });
      // A failed regen leaves later artifacts reading a stale generator; stop
      // rather than report a second, derived failure as if it were its own.
      break;
    }
    results.push({
      artifact,
      state: regen.changed ? 'regenerated' : 'fresh',
      changed: regen.changed,
      detail: regen.detail,
    });
  }
  return results;
}

function gitAdd(repo, outputs) {
  const added = [];
  for (const rel of outputs) {
    if (!fs.existsSync(path.join(repo, rel))) continue;
    if (git(repo, ['add', '--', rel]).code === 0) added.push(rel);
  }
  return added;
}

function advisory() {
  return process.env.NAVGATOR_ARTIFACT_ADVISORY === '1';
}

// ---------------------------------------------------------------------------
// Modes
// ---------------------------------------------------------------------------

function warnMissingToolchain(repo) {
  process.stderr.write(
    '⚠ artifact-guard: no node_modules found for this checkout or its main worktree — ' +
      'committed artifacts NOT verified.\n' +
      `  Run \`npm ci\` in ${repo}, then \`npm run build:cli && npm run architecture\`.\n` +
      '  CI remains the backstop; this commit may redden it.\n'
  );
}

export function modeStaged(repo) {
  const staged = stagedFiles(repo);
  if (staged.length === 0) return 0;

  const selected = ARTIFACTS.filter((a) => matchesWatch(a, staged));
  if (selected.length === 0) return 0;

  const nodeModules = resolveNodeModules(repo);
  if (!nodeModules) {
    warnMissingToolchain(repo);
    return 0;
  }
  if (nodeModules.fallback && matchesWatch({ watch: ['package.json', 'package-lock.json'] }, staged)) {
    process.stderr.write(
      '⚠ artifact-guard: regenerating with the main worktree\'s node_modules while this ' +
        'commit changes the dependency manifest — the build may not see a newly added package.\n'
    );
  }

  const apply = (results, frame) => {
    let failed = false;
    for (const r of results) {
      if (r.state === 'failed') {
        failed = true;
        process.stderr.write(
          `✖ ${r.artifact.name} drifted and could not be regenerated.\n` +
            `  Run manually: ${regenCommand(r.artifact)}\n` +
            '  (or set NAVGATOR_ARTIFACT_ADVISORY=1 to commit without regenerating, then fix before CI)\n'
        );
        if (r.detail) process.stderr.write(`  ${r.detail.replace(/\n/g, '\n  ')}\n`);
        continue;
      }
      if (r.state === 'unavailable') {
        process.stderr.write(
          `⚠ ${r.artifact.name}: freshness probe failed to run — not verified.\n` +
            (r.detail ? `  ${r.detail.replace(/\n/g, '\n  ')}\n` : '')
        );
        continue;
      }
      if (!r.changed) continue;
      if (frame !== repo) copyOutputs(frame, repo, r.artifact.outputs);
      const added = gitAdd(repo, r.artifact.outputs);
      process.stderr.write(`↻ ${r.artifact.name}: regenerated and re-staged ${added.join(', ')}\n`);
    }
    return failed ? 1 : 0;
  };

  if (advisory()) {
    // Probe only. Advisory mode must not mutate a tree the user asked it to
    // leave alone, which rules out both the isolated worktree and any
    // regen-and-compare — so it reports against the live working tree, and
    // distinguishes what it measured from what it could not.
    const results = runPipeline(repo, process.env, selected, { regenAllowed: false });
    for (const r of results) {
      if (r.state === 'stale') {
        process.stderr.write(
          `⚠ ${r.artifact.name} is stale in the working tree (advisory mode — not regenerating). ` +
            `Run: ${regenCommand(r.artifact)}\n`
        );
      } else if (r.state === 'unknown') {
        process.stderr.write(
          `⚠ ${r.artifact.name} NOT verified — it has no freshness probe, and checking it means ` +
            `regenerating, which advisory mode will not do. Run: ${regenCommand(r.artifact)}\n`
        );
      }
    }
    return 0;
  }

  // Always isolate. The generators read whole files off disk, so regenerating
  // in the live tree would compile whatever else is lying around — an unstaged
  // edit or an untracked file belonging to a concurrent agent — into an
  // artifact this commit then ships. Isolation costs ~1s of worktree setup;
  // the correctness it buys does not have a cheaper form.
  const outcome = withIsolatedFrame(repo, nodeModules.path, (frame, env) =>
    apply(runPipeline(frame, env, selected, { regenAllowed: true }), frame)
  );
  if (outcome !== null) return outcome;

  // Isolation failed to set up. In-place regen is only safe when the working
  // tree holds nothing outside the index; otherwise fail closed rather than
  // risk bundling somebody else's uncommitted work.
  const outOfIndex = outOfIndexFiles(repo);
  if (outOfIndex.length > 0) {
    process.stderr.write(
      '✖ artifact-guard: could not create an isolated worktree, and the working tree holds ' +
        `${outOfIndex.length} change(s) outside the index — refusing to regenerate from it ` +
        '(that would risk bundling uncommitted third-party content into this commit).\n' +
        '  Commit or stash them, or regenerate manually: ' +
        `${ARTIFACTS.map(regenCommand).join(' && ')}\n`
    );
    return 1;
  }
  return apply(runPipeline(repo, process.env, selected, { regenAllowed: true }), repo);
}

export function modeCheck(repo, { json }) {
  const nodeModules = resolveNodeModules(repo);
  if (!nodeModules) {
    warnMissingToolchain(repo);
    return 1;
  }

  // Read-only by contract: an artifact with no cheap probe is decided by
  // regenerating in an isolated frame and comparing, never by mutating here.
  const evaluate = (frame, env) =>
    ARTIFACTS.map((artifact) => {
      const checked = probe(frame, artifact, env);
      if (checked.state !== 'unknown') {
        return {
          name: artifact.name,
          fresh: checked.state === 'fresh',
          available: checked.state !== 'unavailable',
          regen_command: regenCommand(artifact),
          detail: checked.state === 'fresh' ? '' : checked.detail,
        };
      }
      const regen = regenerate(frame, artifact, env);
      return {
        name: artifact.name,
        fresh: regen.ok && !regen.changed,
        available: regen.ok,
        regen_command: regenCommand(artifact),
        detail: regen.ok ? (regen.changed ? 'regenerating changed the committed output' : '') : regen.detail,
      };
    });

  const results = withIsolatedFrame(repo, nodeModules.path, evaluate);
  if (results === null) {
    process.stderr.write('✖ artifact-guard: could not create an isolated worktree to check against.\n');
    return 1;
  }

  const stale = results.some((r) => !r.fresh);
  if (json) {
    process.stdout.write(`${JSON.stringify({ stale, artifacts: results }, null, 2)}\n`);
  } else {
    for (const r of results) {
      if (r.fresh) process.stdout.write(`✓ ${r.name} fresh\n`);
      else {
        process.stderr.write(`✖ ${r.name} STALE — run: ${r.regen_command}\n`);
        if (r.detail) process.stderr.write(`  ${r.detail.replace(/\n/g, '\n  ')}\n`);
      }
    }
  }
  return stale ? 1 : 0;
}

export function modeRegen(repo, which) {
  const nodeModules = resolveNodeModules(repo);
  if (!nodeModules) {
    warnMissingToolchain(repo);
    return 1;
  }
  const selected = ARTIFACTS.filter((a) => which === 'all' || a.name === which);
  if (selected.length === 0) {
    process.stderr.write(`✖ unknown artifact: ${which}. Known: ${ARTIFACTS.map((a) => a.name).join(', ')}\n`);
    return 2;
  }
  let failed = false;
  for (const artifact of selected) {
    const result = regenerate(repo, artifact, process.env);
    if (!result.ok) {
      failed = true;
      process.stderr.write(`✖ ${artifact.name} regen failed: ${result.detail}\n`);
      continue;
    }
    process.stdout.write(
      result.changed
        ? `↻ ${artifact.name} regenerated: ${artifact.outputs.join(', ')}\n`
        : `= ${artifact.name} already fresh\n`
    );
  }
  return failed ? 1 : 0;
}

export function modeList({ json }) {
  const data = ARTIFACTS.map((a) => ({
    name: a.name,
    watch: a.watch,
    check: a.check ? a.check.argv.join(' ') : null,
    regen: regenCommand(a),
    outputs: a.outputs,
    why: a.why,
  }));
  if (json) {
    process.stdout.write(`${JSON.stringify({ artifacts: data }, null, 2)}\n`);
  } else {
    for (const d of data) {
      process.stdout.write(
        `${d.name}\n  watch:  ${d.watch.join(', ')}\n  regen:  ${d.regen}\n  why:    ${d.why}\n`
      );
    }
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Pre-commit hook installer (chained segment; coexists with other segments)
// ---------------------------------------------------------------------------

export const HOOK_MARKER = '# --- BEGIN navgator artifact-guard pre-commit ---';
export const HOOK_MARKER_END = '# --- END navgator artifact-guard pre-commit ---';
const SOURCE_HOOK = ['scripts', 'git-hooks', 'pre-commit'];

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const SEGMENT_RE = new RegExp(`${escapeRegExp(HOOK_MARKER)}[\\s\\S]*?${escapeRegExp(HOOK_MARKER_END)}\n?`);

function hooksDir(repo) {
  // In a linked worktree this resolves to the COMMON hooks dir, so one install
  // covers every worktree of the repo.
  const cp = git(repo, ['rev-parse', '--git-path', 'hooks']);
  if (cp.code !== 0 || !cp.stdout.trim()) return null;
  const p = cp.stdout.trim();
  return path.isAbsolute(p) ? p : path.resolve(repo, p);
}

/** The marked segment, extracted from the committed source hook (DRY source). */
export function sourceSegment(repo) {
  const src = path.join(repo, ...SOURCE_HOOK);
  if (!fs.existsSync(src)) return null;
  const match = SEGMENT_RE.exec(fs.readFileSync(src, 'utf-8'));
  return match ? `${match[0].replace(/\n+$/, '')}\n` : null;
}

export function installHook(repo) {
  const dir = hooksDir(repo);
  if (dir === null) return { installed: false, reason: 'not a git repo / no hooks dir' };
  const segment = sourceSegment(repo);
  if (segment === null) {
    return { installed: false, reason: `source segment not found in ${path.join(repo, ...SOURCE_HOOK)}` };
  }
  fs.mkdirSync(dir, { recursive: true });
  const hook = path.join(dir, 'pre-commit');
  const fresh = !fs.existsSync(hook);

  // A fresh base is a bare shebang, NOT a trailing `exit 0`. Emitting `exit 0`
  // would turn any later-APPENDED segment into dead code, silently disabling a
  // guard someone else installed.
  const body = fresh ? '#!/bin/sh\n' : fs.readFileSync(hook, 'utf-8');

  if (!fresh && body.includes(HOOK_MARKER)) {
    const next = body.replace(SEGMENT_RE, segment);
    if (next !== body) fs.writeFileSync(hook, next);
    fs.chmodSync(hook, fs.statSync(hook).mode | 0o111);
    return { installed: true, action: 'resynced', path: hook };
  }

  // Insert right after the shebang so this segment runs before any
  // later-appended segment AND before a trailing `exit 0` an earlier installer
  // left behind — order-independent with whatever else is chained here.
  const parts = body.split(/(?<=\n)/);
  const at = parts.length > 0 && parts[0].startsWith('#!') ? 1 : 0;
  const next = [...parts.slice(0, at), '\n', segment, ...parts.slice(at)].join('');
  fs.writeFileSync(hook, next);
  fs.chmodSync(hook, fs.statSync(hook).mode | 0o111);
  return { installed: true, action: fresh ? 'created' : 'chained', path: hook };
}

export function uninstallHook(repo) {
  const dir = hooksDir(repo);
  if (dir === null) return { removed: false, reason: 'not a git repo' };
  const hook = path.join(dir, 'pre-commit');
  if (!fs.existsSync(hook)) return { removed: false, reason: 'no pre-commit hook' };
  const body = fs.readFileSync(hook, 'utf-8');
  if (!body.includes(HOOK_MARKER)) return { removed: false, reason: 'artifact-guard segment not present' };
  fs.writeFileSync(hook, body.replace(SEGMENT_RE, ''));
  return { removed: true, path: hook };
}

export function hookStatus(repo) {
  const dir = hooksDir(repo);
  if (dir === null) return { installed: false, reason: 'not a git repo' };
  const hook = path.join(dir, 'pre-commit');
  const installed = fs.existsSync(hook) && fs.readFileSync(hook, 'utf-8').includes(HOOK_MARKER);
  return { installed, path: hook };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export function parseArgs(argv) {
  const out = { mode: 'check', repo: null, json: false, quiet: false, regen: 'all' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--repo') { out.repo = argv[i + 1] ?? null; i += 1; continue; }
    if (arg === '--json') { out.json = true; continue; }
    if (arg === '--quiet') { out.quiet = true; continue; }
    if (arg === '--staged') { out.mode = 'staged'; continue; }
    if (arg === '--check' || arg === '--all') { out.mode = 'check'; continue; }
    if (arg === '--list') { out.mode = 'list'; continue; }
    if (arg === '--install-hook') { out.mode = 'install-hook'; continue; }
    if (arg === '--uninstall-hook') { out.mode = 'uninstall-hook'; continue; }
    if (arg === '--hook-status') { out.mode = 'hook-status'; continue; }
    if (arg === '--regen') {
      out.mode = 'regen';
      const next = argv[i + 1];
      if (next && !next.startsWith('-')) { out.regen = next; i += 1; }
      continue;
    }
    return { error: `unknown argument: ${arg}` };
  }
  return out;
}

function main(argv) {
  const args = parseArgs(argv);
  if (args.error) {
    process.stderr.write(`✖ ${args.error}\n`);
    return 2;
  }
  const repo = detectRepo(args.repo);

  switch (args.mode) {
    case 'staged':
      return modeStaged(repo);
    case 'regen':
      return modeRegen(repo, args.regen);
    case 'list':
      return modeList({ json: args.json });
    case 'install-hook': {
      const result = installHook(repo);
      if (!args.quiet) process.stdout.write(`${JSON.stringify(result)}\n`);
      // `--quiet` is the `prepare` lifecycle's entry point: a missing hooks dir
      // or a non-git tarball extraction must never fail `npm install`.
      return args.quiet || result.installed ? 0 : 1;
    }
    case 'uninstall-hook':
      process.stdout.write(`${JSON.stringify(uninstallHook(repo))}\n`);
      return 0;
    case 'hook-status':
      process.stdout.write(`${JSON.stringify(hookStatus(repo))}\n`);
      return 0;
    default:
      return modeCheck(repo, { json: args.json });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv.slice(2)));
}
