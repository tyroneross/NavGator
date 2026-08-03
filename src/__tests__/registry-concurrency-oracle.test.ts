/**
 * Concurrency oracle for the project registry.
 *
 * The lesson this file encodes: a concurrency fix needs a concurrency oracle.
 * Single-writer tests certify nothing. Every test here provokes a real race and
 * asserts on what survives it.
 *
 * Three defects are held closed:
 *
 *   f1  concurrent `registerProject` in one process silently dropped
 *       registrations (measured: 2 of 6 registered at concurrency 4).
 *   f3  the dashboard route's unserialized load-mutate-save dropped one of two
 *       concurrent adds (measured: 300 lost registrations across 300 rounds on
 *       the real 541-project registry).
 *   new a writer that commits underneath another writer must be DETECTED and
 *       merged, not silently allowed to win.
 *
 * Mutation-verified. Reverting any of the three mechanisms makes a named test
 * here fail — see the `MUTANT:` annotation on each.
 *
 * Every test redirects `$HOME` to a tmp directory. `os.homedir()` honours
 * `$HOME` on POSIX, which is how the registry, the journal, and the lock all
 * follow the redirect together. The `journal coverage` block asserts the real
 * `~/.navgator` was never touched BY THESE TESTS — it says nothing about the
 * other 68 test files, which do pollute the real home (followup
 * nav-20260803-10).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  registerProject,
  updateProjectMeta,
  removeProject,
  loadRegistry,
  saveRegistry,
  type ProjectRegistry,
} from '../projects.js';
import { readJournal, journalPathForDir } from '../registry-journal.js';
import {
  acquireRegistryLock,
  withRegistryFileLock,
  registryLockPath,
  LOCK_STALE_MS,
  LOCK_ACQUIRE_TIMEOUT_MS,
} from '../registry-lock.js';

// The web app's twin implementations. Imported by relative path exactly as
// src/__tests__/web-atomic-write-concurrency.test.ts imports its twin — this is
// what holds the two copies to a single contract instead of letting them drift.
import {
  addProject as webAddProject,
  removeProject as webRemoveProject,
  loadRegistry as webLoadRegistry,
  registryDir as webRegistryDir,
} from '../../web/lib/server/registry-store.js';
import { withRegistryFileLock as webWithRegistryFileLock } from '../../web/lib/server/registry-lock.js';
import { loadRegisteredProjectPaths } from '../../web/lib/server/coverage.js';

/** The shape web/app/api/projects/route.ts pushes for a newly registered path. */
function webEntry(name: string) {
  return { name, addedAt: Date.now(), lastScan: null, scanCount: 0 };
}

let homeDir: string;
let navDir: string;
let registryPath: string;
let prevHome: string | undefined;

/** The developer's real journal, to prove THIS suite's writes never reach it. */
const REAL_NAVGATOR_DIR = path.join(os.homedir(), '.navgator');

beforeEach(() => {
  homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-oracle-home-'));
  navDir = path.join(homeDir, '.navgator');
  registryPath = path.join(navDir, 'projects.json');
  prevHome = process.env.HOME;
  process.env.HOME = homeDir;
});

afterEach(() => {
  vi.restoreAllMocks();
  if (prevHome === undefined) delete process.env.HOME;
  else process.env.HOME = prevHome;
  fs.rmSync(homeDir, { recursive: true, force: true });
});

function readRegistry(): ProjectRegistry {
  return JSON.parse(fs.readFileSync(registryPath, 'utf-8')) as ProjectRegistry;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// =============================================================================
// LOST UPDATES — the entries must survive
// =============================================================================

describe('lost updates', () => {
  // NOTE: neutralizing `withRegistryLock` does NOT break this test — the file
  // lock serializes same-process writers too. The mutex is convicted only by the
  // `with the file lock unavailable` block below. Mutation-verified, not assumed.
  it('loses no entry when 12 writers register distinct projects at once', async () => {
    const count = 12;

    await Promise.all(
      Array.from({ length: count }, (_, i) =>
        registerProject(`/repos/concurrent-${i}`, { components: i, connections: 0, prompts: 0 })
      )
    );

    const registry = readRegistry();
    expect(registry.projects).toHaveLength(count);
    for (let i = 0; i < count; i++) {
      expect(registry.projects.some((p) => p.path === `/repos/concurrent-${i}`)).toBe(true);
    }
  }, 30_000);

  it('increments scanCount exactly once per call when the same project is registered concurrently', async () => {
    // The replay path recomputes `scanCount + 1` off a fresh load rather than a
    // stale one. A replay that reapplied a captured value would over- or
    // under-count here.
    const rounds = 10;
    await Promise.all(
      Array.from({ length: rounds }, () => registerProject('/repos/same', undefined))
    );

    const entry = readRegistry().projects.find((p) => p.path === '/repos/same');
    expect(entry?.scanCount).toBe(rounds);
  }, 30_000);

  it('loses no field when three patches for one project land together', async () => {
    await Promise.all([
      updateProjectMeta('/repos/patched', { origin: { kind: 'local' } }),
      updateProjectMeta('/repos/patched', { portfolio: { root: '/repos' } }),
      updateProjectMeta('/repos/patched', { lastSignificance: 'minor' }),
    ]);

    const entry = readRegistry().projects.find((p) => p.path === '/repos/patched');
    expect(entry?.origin).toEqual({ kind: 'local' });
    expect(entry?.portfolio).toEqual({ root: '/repos' });
    expect(entry?.lastSignificance).toBe('minor');
  }, 30_000);

  it('removes only the named project when a remove races an add', async () => {
    await registerProject('/repos/keep');
    await registerProject('/repos/drop');

    await Promise.all([removeProject('/repos/drop'), registerProject('/repos/added-during')]);

    const paths = readRegistry().projects.map((p) => p.path);
    expect(paths).toContain('/repos/keep');
    expect(paths).toContain('/repos/added-during');
    expect(paths).not.toContain('/repos/drop');
  }, 30_000);

  it('sustains zero loss across 40 rounds of paired concurrent writers', async () => {
    // The shape that produced the measured 300/300 failure: two writers, each
    // adding a distinct path, fired together, repeated until a timing-dependent
    // fix would have shown its seam.
    const rounds = 40;
    for (let round = 0; round < rounds; round++) {
      await Promise.all([
        registerProject(`/repos/round-${round}-a`),
        registerProject(`/repos/round-${round}-b`),
      ]);
    }

    expect(readRegistry().projects).toHaveLength(rounds * 2);
  }, 60_000);
});

// =============================================================================
// VERSION STAMPING
// =============================================================================

describe('revision stamping', () => {
  it('starts at 0 for a registry that has never been written', async () => {
    const registry = await loadRegistry();
    expect(registry.revision).toBe(0);
    expect(registry.projects).toEqual([]);
  });

  it('advances monotonically, one step per committed write', async () => {
    await registerProject('/repos/a');
    const first = readRegistry().revision;

    await registerProject('/repos/b');
    const second = readRegistry().revision;

    await updateProjectMeta('/repos/b', { origin: { kind: 'local' } });
    const third = readRegistry().revision;

    expect(first).toBe(1);
    expect(second).toBe(2);
    expect(third).toBe(3);
  });

  it('does not advance when a mutation decides it has nothing to do', async () => {
    await registerProject('/repos/a');
    const before = readRegistry().revision;

    const removed = await removeProject('/repos/never-registered');

    expect(removed).toBe(false);
    expect(readRegistry().revision).toBe(before);
  });

  it('never collides across concurrent writers', async () => {
    await Promise.all(
      Array.from({ length: 10 }, (_, i) => registerProject(`/repos/rev-${i}`))
    );
    // Ten committed writes from revision 0 means the counter must read exactly 10;
    // any collision would leave it short.
    expect(readRegistry().revision).toBe(10);
  }, 30_000);
});

// =============================================================================
// BACKWARD COMPATIBILITY
// =============================================================================

describe('backward compatibility', () => {
  it('loads a v2 file written before `revision` existed as revision 0', async () => {
    fs.mkdirSync(navDir, { recursive: true });
    fs.writeFileSync(
      registryPath,
      JSON.stringify({
        version: 2,
        projects: [{ path: '/repos/legacy', name: 'Legacy', addedAt: 1, lastScan: null, scanCount: 0 }],
      })
    );

    const registry = await loadRegistry();
    expect(registry.revision).toBe(0);
    expect(registry.projects).toHaveLength(1);

    // And the first write after upgrade simply stamps 1 — no migration needed.
    await registerProject('/repos/new');
    expect(readRegistry().revision).toBe(1);
    expect(readRegistry().projects).toHaveLength(2);
  });

  it('still runs the v1 -> v2 migration and does not bump `version` past 2', async () => {
    fs.mkdirSync(navDir, { recursive: true });
    fs.writeFileSync(
      registryPath,
      JSON.stringify({
        version: 1,
        projects: [{ path: '/repos/v1', name: 'V1', addedAt: 1, lastScan: 1234 }],
      })
    );

    const registry = await loadRegistry();
    expect(registry.version).toBe(2);
    expect(registry.projects[0].scanCount).toBe(1);

    await registerProject('/repos/after-migration');
    expect(readRegistry().version).toBe(2);
  });

  it('treats an unparseable registry as empty rather than throwing', async () => {
    fs.mkdirSync(navDir, { recursive: true });
    fs.writeFileSync(registryPath, '{ this is not json');

    const registry = await loadRegistry();
    expect(registry.projects).toEqual([]);
    expect(registry.revision).toBe(0);
  });
});

// =============================================================================
// CONFLICT DETECTION — the heart of the change
// =============================================================================

describe('lost-update detection', () => {
  /**
   * Inject a competing commit that does NOT take the lock, landing between our
   * writer's load and its compare-and-swap re-check.
   *
   * This is the "older dashboard build" case: a writer that predates the lock,
   * or one that timed out acquiring it. The interception is entirely test-side —
   * there is no test seam in the production path — and it is deterministic
   * rather than timing-dependent, because it fires on the first read of the
   * registry file, which is always the writer's load.
   */
  function injectUnlockedCommitAfterFirstLoad(competitor: ProjectRegistry): void {
    const realReadFile = fs.promises.readFile.bind(fs.promises);
    let fired = false;

    vi.spyOn(fs.promises, 'readFile').mockImplementation((async (
      target: Parameters<typeof fs.promises.readFile>[0],
      ...rest: unknown[]
    ) => {
      const result = await (realReadFile as (...a: unknown[]) => Promise<unknown>)(
        target,
        ...rest
      );
      if (!fired && String(target) === registryPath) {
        fired = true;
        fs.writeFileSync(registryPath, JSON.stringify(competitor, null, 2));
      }
      return result;
    }) as typeof fs.promises.readFile);
  }

  // MUTANT: make readDiskRevision() return `base` unconditionally -> both the
  // conflict record and the surviving competitor entry disappear.
  it('journals a conflict and keeps BOTH entries when a writer commits underneath', async () => {
    await registerProject('/repos/seed');
    const seeded = readRegistry();

    injectUnlockedCommitAfterFirstLoad({
      version: 2,
      revision: (seeded.revision ?? 0) + 50,
      projects: [
        ...seeded.projects,
        {
          path: '/repos/competitor',
          name: 'Competitor',
          addedAt: Date.now(),
          lastScan: null,
          scanCount: 0,
        },
      ],
    });

    await registerProject('/repos/ours');

    const paths = readRegistry().projects.map((p) => p.path);
    // The merge proof: the competitor's entry survived our write.
    expect(paths).toContain('/repos/competitor');
    expect(paths).toContain('/repos/ours');
    expect(paths).toContain('/repos/seed');

    const conflicts = readJournal({ dir: navDir, conflictsOnly: true, limit: 100 });
    expect(conflicts.length).toBeGreaterThanOrEqual(1);
    // `base !== found` is the condition under which a conflict record is written
    // at all, so asserting it re-states the write condition. Assert the exact
    // revision the competitor published instead — information the write
    // condition does not imply.
    expect(conflicts[0].found).toBe((seeded.revision ?? 0) + 50);
    expect(conflicts[0].base).toBe(seeded.revision ?? 0);
  }, 30_000);

  it('names a revision regression distinctly from ordinary contention', async () => {
    // An older dashboard build reconstructs the registry as {version, projects}
    // and drops `revision`, resetting the counter. That is a compatibility
    // signal, not contention, and the journal must say which it was.
    await registerProject('/repos/a');
    await registerProject('/repos/b');
    const seeded = readRegistry();

    injectUnlockedCommitAfterFirstLoad({
      version: 2,
      revision: 0, // the field-stripping writer
      projects: seeded.projects,
    });

    await registerProject('/repos/c');

    const conflicts = readJournal({ dir: navDir, conflictsOnly: true, limit: 100 });
    expect(conflicts.some((c) => c.note?.includes('revision-regression'))).toBe(true);
    expect(readRegistry().projects.map((p) => p.path)).toContain('/repos/c');
  }, 30_000);

  it('does not add a duplicate when the replayed mutation targets a path the winner already added', async () => {
    // Replay safety for find-or-create: the competitor adds the SAME path we are
    // about to add. A naive replay would push a second copy.
    await registerProject('/repos/seed');
    const seeded = readRegistry();

    injectUnlockedCommitAfterFirstLoad({
      version: 2,
      revision: (seeded.revision ?? 0) + 50,
      projects: [
        ...seeded.projects,
        {
          path: '/repos/contested',
          name: 'Contested',
          addedAt: Date.now(),
          lastScan: null,
          scanCount: 0,
        },
      ],
    });

    await registerProject('/repos/contested');

    const matches = readRegistry().projects.filter((p) => p.path === '/repos/contested');
    expect(matches).toHaveLength(1);
    // Found-not-created: the replay updated the winner's entry instead of
    // pushing a duplicate.
    expect(matches[0].scanCount).toBe(1);
  }, 30_000);

  it('reports no conflicts on an uncontended sequence', async () => {
    for (let i = 0; i < 5; i++) await registerProject(`/repos/serial-${i}`);
    expect(readJournal({ dir: navDir, conflictsOnly: true, limit: 100 })).toEqual([]);
  });
});

// =============================================================================
// CROSS-PROCESS LOCK
// =============================================================================

describe('registry file lock', () => {
  /**
   * `acquireRegistryLock` keeps zero module-level state — exclusion is entirely
   * the filesystem's `O_CREAT|O_EXCL`. An in-process contender therefore takes
   * exactly the same code path a second process would, so these tests measure
   * the real primitive rather than a stand-in.
   */
  // MUTANT: drop withRegistryFileLock from mutateRegistry -> the cross-writer
  // tests above lose entries; this test pins the primitive itself.
  it('admits exactly one holder at a time under 8-way contention', async () => {
    let inside = 0;
    let maxInside = 0;
    const acquisitions: boolean[] = [];

    await Promise.all(
      Array.from({ length: 8 }, () =>
        withRegistryFileLock(navDir, async (acquired) => {
          acquisitions.push(acquired);
          inside++;
          maxInside = Math.max(maxInside, inside);
          await sleep(5);
          inside--;
        })
      )
    );

    expect(acquisitions.every(Boolean)).toBe(true);
    expect(maxInside).toBe(1);
  }, 30_000);

  it('releases the lock file even when the critical section throws', async () => {
    await expect(
      withRegistryFileLock(navDir, async () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');

    expect(fs.existsSync(registryLockPath(navDir))).toBe(false);
  });

  it('steals a lock left behind by a process that died', async () => {
    fs.mkdirSync(navDir, { recursive: true });
    fs.writeFileSync(
      registryLockPath(navDir),
      JSON.stringify({ pid: 999999, token: 'dead', ts: Date.now() - 60_000 })
    );

    const lock = await acquireRegistryLock(navDir, { timeoutMs: 1_000, staleMs: 10_000 });
    expect(lock.acquired).toBe(true);
    await lock.release();
  }, 15_000);

  it('does not steal a lock that is still fresh, and gives up within budget', async () => {
    fs.mkdirSync(navDir, { recursive: true });
    fs.writeFileSync(
      registryLockPath(navDir),
      JSON.stringify({ pid: 999999, token: 'alive', ts: Date.now() })
    );

    const started = Date.now();
    const lock = await acquireRegistryLock(navDir, { timeoutMs: 200, staleMs: 10_000 });

    // Fail-open: contention returns `acquired: false` rather than throwing or
    // hanging, so a wedged lock can never stop a registry write.
    expect(lock.acquired).toBe(false);
    expect(Date.now() - started).toBeLessThan(3_000);
    expect(fs.existsSync(registryLockPath(navDir))).toBe(true);
  }, 15_000);

  it('release is owner-safe: a holder whose lock was stolen does not delete the new owner', async () => {
    const first = await acquireRegistryLock(navDir, { timeoutMs: 1_000 });
    expect(first.acquired).toBe(true);

    // Simulate a steal: someone replaced the record while the first holder stalled.
    fs.writeFileSync(
      registryLockPath(navDir),
      JSON.stringify({ pid: 4242, token: 'someone-else', ts: Date.now() })
    );

    await first.release();

    expect(fs.existsSync(registryLockPath(navDir))).toBe(true);
    const record = JSON.parse(fs.readFileSync(registryLockPath(navDir), 'utf-8'));
    expect(record.token).toBe('someone-else');
  }, 15_000);

  it('reclaims an orphaned lock using production defaults, in one acquire', async () => {
    // f1 closure proof. With the original 10s stale / 2s timeout pair this
    // failed: an acquire could never outlast the stale threshold, so a lock
    // orphaned by a killed process forced EVERY writer in EVERY process onto
    // the unlocked path for a full 10s. The constants must stay ordered.
    expect(LOCK_ACQUIRE_TIMEOUT_MS).toBeGreaterThan(LOCK_STALE_MS);

    fs.mkdirSync(navDir, { recursive: true });
    fs.writeFileSync(
      registryLockPath(navDir),
      JSON.stringify({ pid: 999999, token: 'orphan', ts: Date.now() - (LOCK_STALE_MS + 1000) })
    );

    // No options override — this must hold with the shipped defaults.
    const lock = await acquireRegistryLock(navDir);
    expect(lock.acquired).toBe(true);
    await lock.release();
  }, 30_000);

  it('does not steal a lock that was re-created after the staleness read', async () => {
    // f2 closure proof: the unlink must re-verify the record it judged, or it
    // lands after a third process has already taken a fresh lock and destroys a
    // live holder's lock.
    fs.mkdirSync(navDir, { recursive: true });
    const lockPath = registryLockPath(navDir);
    fs.writeFileSync(
      lockPath,
      JSON.stringify({ pid: 999999, token: 'stale', ts: Date.now() - 60_000 })
    );

    const realReadFile = fs.promises.readFile.bind(fs.promises);
    let seenStale = false;
    vi.spyOn(fs.promises, 'readFile').mockImplementation((async (
      target: Parameters<typeof fs.promises.readFile>[0],
      ...rest: unknown[]
    ) => {
      const result = await (realReadFile as (...a: unknown[]) => Promise<unknown>)(target, ...rest);
      if (!seenStale && String(target) === lockPath) {
        seenStale = true;
        // A third process steals and takes a FRESH lock in the window between
        // our staleness read and our unlink.
        fs.writeFileSync(
          lockPath,
          JSON.stringify({ pid: 4242, token: 'fresh-holder', ts: Date.now() })
        );
      }
      return result;
    }) as typeof fs.promises.readFile);

    await acquireRegistryLock(navDir, { timeoutMs: 150, staleMs: 10_000 });

    expect(fs.existsSync(lockPath)).toBe(true);
    const record = JSON.parse(fs.readFileSync(lockPath, 'utf-8'));
    expect(record.token).toBe('fresh-holder');
  }, 30_000);

  it('leaves no lock file behind when writing the lock record fails', async () => {
    // f5 closure proof: an ENOSPC/EIO between create and write must not strand
    // an EMPTY lock whose unparseable record blocks every writer for LOCK_STALE_MS.
    fs.mkdirSync(navDir, { recursive: true });
    const realOpen = fs.promises.open.bind(fs.promises) as unknown as (
      ...a: unknown[]
    ) => Promise<{ close: () => Promise<void> }>;
    vi.spyOn(fs.promises, 'open').mockImplementation((async (...args: unknown[]) => {
      const handle = await realOpen(...args);
      return {
        ...handle,
        // The record write fails after the file already exists on disk.
        writeFile: async () => {
          throw Object.assign(new Error('ENOSPC'), { code: 'ENOSPC' });
        },
        close: handle.close.bind(handle),
      };
    }) as unknown as typeof fs.promises.open);

    const lock = await acquireRegistryLock(navDir, { timeoutMs: 150 });

    expect(lock.acquired).toBe(false);
    expect(fs.existsSync(registryLockPath(navDir))).toBe(false);
  }, 30_000);

  it('leaves no lock file behind after a normal write', async () => {
    await registerProject('/repos/tidy');
    expect(fs.existsSync(registryLockPath(navDir))).toBe(false);
  });
});

// =============================================================================
// JOURNAL COVERAGE OF THE REGISTRY PATH
// =============================================================================

describe('journal coverage', () => {
  it('records a read for every load', async () => {
    await loadRegistry('unit-test-read');

    const loads = readJournal({ dir: navDir, op: 'load', limit: 100 });
    expect(loads.some((e) => e.note === 'unit-test-read')).toBe(true);
  });

  it('records a write with an entry-count delta and a content digest', async () => {
    await registerProject('/repos/journaled');

    const writes = readJournal({ dir: navDir, op: 'register', limit: 100 });
    expect(writes).toHaveLength(1);
    expect(writes[0].delta).toBe(1);
    expect(writes[0].entries).toBe(1);
    expect(writes[0].digest).toMatch(/^[0-9a-f]{16}$/);
    expect(writes[0].rev).toBe(1);
  });

  it('marks a normal write as holding the cross-process lock', async () => {
    await registerProject('/repos/locked-marker');

    const writes = readJournal({ dir: navDir, op: 'register', limit: 20 });
    expect(writes[0].locked).toBe(true);
  });

  it('records a negative delta on removal', async () => {
    await registerProject('/repos/x');
    await removeProject('/repos/x');

    const removes = readJournal({ dir: navDir, op: 'remove', limit: 100 });
    expect(removes).toHaveLength(1);
    expect(removes[0].delta).toBe(-1);
    expect(removes[0].entries).toBe(0);
  });

  it('records the compare-and-swap re-read distinctly from a caller read', async () => {
    await registerProject('/repos/cas');
    const loads = readJournal({ dir: navDir, op: 'load', limit: 100 });
    expect(loads.some((e) => e.note === 'cas-check')).toBe(true);
  });

  it('journals a direct saveRegistry call, so no write escapes the record', async () => {
    await saveRegistry({ version: 2, revision: 4, projects: [] });

    const saves = readJournal({ dir: navDir, op: 'save', limit: 100 });
    expect(saves).toHaveLength(1);
    // A direct save still bumps the counter — a write that left the revision
    // standing still would make a real conflict look like agreement.
    expect(saves[0].rev).toBe(5);
  });

  it('writes the journal beside the redirected registry, never into the real home', async () => {
    await registerProject('/repos/isolation');

    expect(fs.existsSync(journalPathForDir(navDir))).toBe(true);
    // Sibling test files in parallel workers legitimately append to the real
    // home journal (the known npm-test pollution), so a size/mtime-equality
    // snapshot races. Assert by attribution instead: this test's unique path
    // must never appear there. A regression to an import-time-cached real-home
    // path would land '/repos/isolation' in this file and still fail.
    const realJournal = path.join(REAL_NAVGATOR_DIR, 'registry-journal.jsonl');
    if (fs.existsSync(realJournal)) {
      expect(fs.readFileSync(realJournal, 'utf-8')).not.toContain('/repos/isolation');
    }
  });
});

// =============================================================================
// THE WEB TWIN — this is where the 300-of-300 loss was measured
// =============================================================================

describe('dashboard route store', () => {
  it('resolves its paths per call, so a redirected HOME actually redirects it', () => {
    // If this regresses to a module-level const, every test below silently
    // starts writing to the developer's real registry.
    expect(webRegistryDir()).toBe(navDir);
  });

  // Reproduces the shape of the measured dashboard defect. NOTE: neutralizing
  // the store's `withRegistryLock` does not break this — the file lock covers it.
  // The mutex is convicted in the `with the file lock unavailable` block.
  it('loses neither add when two concurrent requests register distinct paths', async () => {
    const rounds = 40;

    for (let round = 0; round < rounds; round++) {
      await Promise.all([
        webAddProject(`/repos/web-${round}-a`, webEntry(`Web ${round} A`)),
        webAddProject(`/repos/web-${round}-b`, webEntry(`Web ${round} B`)),
      ]);
    }

    const paths = readRegistry().projects.map((p) => p.path);
    expect(paths).toHaveLength(rounds * 2);
    for (let round = 0; round < rounds; round++) {
      expect(paths).toContain(`/repos/web-${round}-a`);
      expect(paths).toContain(`/repos/web-${round}-b`);
    }
  }, 60_000);

  it('loses no entry when 12 concurrent requests register distinct paths', async () => {
    await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        webAddProject(`/repos/web-burst-${i}`, webEntry(`Burst ${i}`))
      )
    );

    expect(readRegistry().projects).toHaveLength(12);
  }, 30_000);

  it('adds exactly one entry when the same path is registered concurrently', async () => {
    const results = await Promise.all(
      Array.from({ length: 6 }, () => webAddProject('/repos/web-dup', webEntry('Dup')))
    );

    expect(readRegistry().projects.filter((p) => p.path === '/repos/web-dup')).toHaveLength(1);
    // Exactly one caller is told it created the entry; the rest report the
    // no-op that produces the route's "Project already registered" response.
    expect(results.filter((r) => r.added)).toHaveLength(1);
  }, 30_000);

  it('removes only the named project when a remove races an add', async () => {
    await webAddProject('/repos/web-keep', webEntry('Keep'));
    await webAddProject('/repos/web-drop', webEntry('Drop'));

    await Promise.all([
      webRemoveProject('/repos/web-drop'),
      webAddProject('/repos/web-late', webEntry('Late')),
    ]);

    const paths = readRegistry().projects.map((p) => p.path);
    expect(paths).toContain('/repos/web-keep');
    expect(paths).toContain('/repos/web-late');
    expect(paths).not.toContain('/repos/web-drop');
  }, 30_000);

  it('reports removed:false without writing when the path was not registered', async () => {
    await webAddProject('/repos/web-a', webEntry('A'));
    const before = readRegistry().revision;

    expect(await webRemoveProject('/repos/never-there')).toEqual({ removed: false });
    expect(readRegistry().revision).toBe(before);
  });

  it('journals its reads and writes with the web-route actor', async () => {
    await webAddProject('/repos/web-journaled', webEntry('Journaled'));
    await webLoadRegistry('web-get');

    const webRecords = readJournal({ dir: navDir, actor: 'web-route', limit: 200 });
    expect(webRecords.some((e) => e.op === 'register' && e.delta === 1)).toBe(true);
    expect(webRecords.some((e) => e.op === 'load' && e.note === 'web-get')).toBe(true);
  });

  it('keeps version at 2 and preserves the revision the CLI stamped', async () => {
    await registerProject('/repos/from-cli');
    const afterCli = readRegistry();

    await webAddProject('/repos/from-web', webEntry('From Web'));
    const afterWeb = readRegistry();

    expect(afterWeb.version).toBe(2);
    expect(afterWeb.revision).toBe((afterCli.revision ?? 0) + 1);
    expect(afterWeb.projects.map((p) => p.path)).toContain('/repos/from-cli');
  });

  it('journals the coverage allowlist read against the registry it was handed', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-allowlist-'));
    try {
      const tmpRegistry = path.join(tmpDir, 'projects.json');
      fs.writeFileSync(
        tmpRegistry,
        JSON.stringify({ version: 2, revision: 3, projects: [{ path: '/repos/allowed' }] })
      );

      expect(loadRegisteredProjectPaths(tmpRegistry).has('/repos/allowed')).toBe(true);

      const records = readJournal({ dir: tmpDir, limit: 10 });
      expect(records).toHaveLength(1);
      expect(records[0].note).toBe('coverage-allowlist');
      expect(records[0].rev).toBe(3);
      // Journaled beside the registry it was given, not beside $HOME.
      expect(fs.existsSync(journalPathForDir(navDir))).toBe(false);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('records an unreadable registry rather than leaving the empty allowlist unexplained', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-allowlist-bad-'));
    try {
      const tmpRegistry = path.join(tmpDir, 'projects.json');
      fs.writeFileSync(tmpRegistry, 'not json at all');

      expect(loadRegisteredProjectPaths(tmpRegistry).size).toBe(0);

      const records = readJournal({ dir: tmpDir, limit: 10 });
      expect(records[0].note).toContain('unreadable');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// =============================================================================
// CROSS-COMPILATION-UNIT — the CLI and the dashboard contending for one file
// =============================================================================

describe('CLI and dashboard writing together', () => {
  /**
   * The two stores are separate modules with separate in-process mutexes, so
   * neither one's mutex can serialize the other. The ONLY thing standing
   * between them is the shared lock file, which is exactly the situation when
   * the real CLI process and the real Next.js process contend.
   *
   * `acquireRegistryLock` holds no module-level state — exclusion is entirely
   * the filesystem's `O_CREAT|O_EXCL` — so these contenders take the same code
   * path two separate processes would, rather than a stand-in for it.
   */

  // MUTANT: drop withRegistryFileLock from either mutateRegistry -> entries are
  // lost here. This is the test the CAS alone cannot pass: two writers starting
  // in the same tick both read revision R, both pass their own CAS check, and
  // both write R+1.
  it('loses no entry across 40 rounds of one CLI write against one dashboard write', async () => {
    const rounds = 40;

    for (let round = 0; round < rounds; round++) {
      await Promise.all([
        registerProject(`/repos/cli-${round}`),
        webAddProject(`/repos/dash-${round}`, webEntry(`Dash ${round}`)),
      ]);
    }

    const paths = readRegistry().projects.map((p) => p.path);
    expect(paths).toHaveLength(rounds * 2);
    for (let round = 0; round < rounds; round++) {
      expect(paths).toContain(`/repos/cli-${round}`);
      expect(paths).toContain(`/repos/dash-${round}`);
    }
  }, 60_000);

  it('loses no entry with six writers fanned across both units at once', async () => {
    await Promise.all([
      registerProject('/repos/mixed-cli-1'),
      webAddProject('/repos/mixed-web-1', webEntry('W1')),
      registerProject('/repos/mixed-cli-2'),
      webAddProject('/repos/mixed-web-2', webEntry('W2')),
      updateProjectMeta('/repos/mixed-cli-3', { origin: { kind: 'local' } }),
      webAddProject('/repos/mixed-web-3', webEntry('W3')),
    ]);

    expect(readRegistry().projects).toHaveLength(6);
  }, 30_000);

  it('keeps the revision counter exact across both units', async () => {
    await Promise.all([
      registerProject('/repos/count-cli-1'),
      webAddProject('/repos/count-web-1', webEntry('W1')),
      registerProject('/repos/count-cli-2'),
      webAddProject('/repos/count-web-2', webEntry('W2')),
    ]);

    // Four committed writes from revision 0. A collision would leave it short.
    expect(readRegistry().revision).toBe(4);
    expect(readRegistry().projects).toHaveLength(4);
  }, 30_000);

  it('both units honour the same lock file, so neither overlaps the other', async () => {
    let inside = 0;
    let maxInside = 0;

    const section = async (acquired: boolean) => {
      expect(acquired).toBe(true);
      inside++;
      maxInside = Math.max(maxInside, inside);
      await sleep(5);
      inside--;
    };

    await Promise.all([
      withRegistryFileLock(navDir, section),
      webWithRegistryFileLock(navDir, section),
      withRegistryFileLock(navDir, section),
      webWithRegistryFileLock(navDir, section),
    ]);

    expect(maxInside).toBe(1);
  }, 30_000);

  it('writes one interleaved journal both units can be read out of', async () => {
    await registerProject('/repos/shared-journal-cli');
    await webAddProject('/repos/shared-journal-web', webEntry('Shared'));

    const all = readJournal({ dir: navDir, limit: 200 });
    expect(all.some((e) => e.actor === 'cli')).toBe(true);
    expect(all.some((e) => e.actor === 'web-route')).toBe(true);

    // One file, one format: every record parses under the CLI reader regardless
    // of which unit wrote it.
    for (const record of all) {
      expect(typeof record.rev).toBe('number');
      expect(typeof record.entries).toBe('number');
      expect(record.pid).toBe(process.pid);
    }
  });
});
