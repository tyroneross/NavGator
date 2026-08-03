/**
 * Suite-wide $HOME redirect for every NavGator test file.
 *
 * Why this exists: `scan()` calls `registerProject()` (`src/scanner.ts:2131`),
 * which writes `~/.navgator/projects.json`. Any test that builds a tmp project
 * and calls `scan()` without redirecting home writes the DEVELOPER'S REAL
 * registry. Measured drift on a clean HEAD, before this hook existed: +42
 * entries per full `npm test` run. A cleanup on 2026-08-03 removed 1,433
 * accumulated tmp-fixture entries that had piled up this way. This is a
 * vitest `setupFiles` hook — it runs once per test FILE (see `pool: 'forks'`
 * in `vitest.config.ts`, which gives each file its own process and therefore
 * its own fake home with no cross-file interference) — so every test file
 * gets an isolated home with no per-test opt-in required.
 *
 * How the redirect actually reaches every write. Two families of home
 * resolution exist in this tree, and `HOME` covers both:
 *
 *   1. `os.homedir()`, which resolves `$HOME` at CALL time on POSIX (verified
 *      on Node 22 in this environment). This is the majority:
 *      `src/projects.ts:70`, `src/registry-journal.ts:186`,
 *      `src/lessons-store.ts:103`, `src/remote/clone.ts:59`,
 *      `web/lib/server/registry-store.ts:98`,
 *      `web/lib/server/registry-journal.ts:184`.
 *   2. `process.env['HOME']` read directly — `src/config.ts:87` and
 *      `src/config.ts:118`, which build the shared-storage-mode path. These
 *      are the reason this file sets `HOME` itself rather than mocking
 *      `os.homedir()`: a module mock would leave `src/config.ts` pointed at
 *      the real home.
 *
 * `USERPROFILE` has no direct reader in this repo; it is set because
 * `os.homedir()` consults it on Windows, so the redirect holds if the suite
 * is ever run there. Setting all of `HOME`, `USERPROFILE`, and `NAVGATOR_HOME`
 * before any module runs is therefore sufficient, with no per-module wiring.
 *
 * `src/enrich/cache.ts:31` is the one home-adjacent path that does NOT go
 * through `os.homedir()` alone — it reads
 * `process.env['NAVGATOR_HOME'] || join(homedir(), '.navgator')` for the
 * enrichment cache, reached from `scanner.ts:64` on every scan. We set
 * `NAVGATOR_HOME` explicitly so that path redirects too, rather than relying
 * on the `|| homedir()` fallback (which would still redirect correctly today,
 * but only incidentally — pin it so a future refactor of that fallback can't
 * silently reopen the leak).
 *
 * The fake home MUST be its own `mkdtemp` directory, never `os.tmpdir()`
 * itself: `src/__tests__/registry-journal.test.ts:58` asserts
 * `journalPathForDir(<some other mkdtemp dir>).startsWith(os.homedir())` is
 * `false`, which only holds while the fake home is a SIBLING of other mkdtemp
 * dirs under `os.tmpdir()`, not their ancestor.
 *
 * `NAVGATOR_TEST_REAL_HOME` publishes the pre-redirect home for the one test
 * file that legitimately needs it: `registry-concurrency-oracle.test.ts`
 * proves its writes never land in the developer's real `~/.navgator`, and it
 * needs the REAL path (not the fake one this file just installed) to make
 * that assertion mean anything. It must be captured here, before the
 * redirect, because every `.test.ts` file is imported after `setupFiles` has
 * already run.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll } from 'vitest';

// Capture the real home BEFORE overwriting it. Load-bearing: any test file
// that needs to assert against the developer's real ~/.navgator (rather than
// the fake home this file is about to install) reads this instead of
// re-deriving os.homedir(), which by the time any .test.ts module runs would
// already be redirected.
//
// The `??=` is the second half of the guarantee, and it is not defensive
// padding. `pool: 'forks'` gives each test file a fresh process today, so this
// file runs once per real home. If that ever changes — an `isolate: false`,
// a pool-behaviour drift of the kind the vitest.config comment already warns
// about, or a reused worker — an unconditional assignment would capture the
// PREVIOUS file's FAKE home here. The isolation oracle in
// registry-concurrency-oracle.test.ts would then check a tmp journal that by
// construction can never contain its sentinel path, and would report green
// while proving nothing. Capturing only once keeps the first (real) value.
process.env.NAVGATOR_TEST_REAL_HOME ??= os.homedir();

const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-test-home-'));

process.env.HOME = fakeHome;
process.env.USERPROFILE = fakeHome;
process.env.NAVGATOR_HOME = path.join(fakeHome, '.navgator');

afterAll(() => {
  try {
    fs.rmSync(fakeHome, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup only. A failure here must never fail the suite —
    // it's a tmp directory, not evidence.
  }
});
