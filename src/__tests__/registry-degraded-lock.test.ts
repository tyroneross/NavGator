/**
 * What still holds when the cross-process file lock is NOT available.
 *
 * `withRegistryFileLock` fails open: a writer that cannot acquire within its
 * budget proceeds unlocked. That is the right trade — a wedged lock must never
 * stop NavGator working — but it means the in-process mutexes are NOT
 * redundant. They are the fallback that keeps same-process writers correct once
 * the outer lock has stepped aside.
 *
 * This file exists because mutation verification proved the point: with the
 * file lock in place, reverting either mutex left every test in
 * registry-concurrency-oracle.test.ts passing. Without a suite that runs the
 * degraded path, both mutexes would be uncovered code that nothing convicts.
 *
 * The lock is mocked rather than contended for. An earlier version planted a
 * live foreign lock file, but once LOCK_STALE_MS dropped below
 * LOCK_ACQUIRE_TIMEOUT_MS (the f1 fix) a planted lock is correctly stolen and
 * the writer acquires — so that setup no longer exercises the degraded path at
 * all, and simulating a live holder would cost a full acquire timeout per
 * writer. Mocking states the condition directly: "the lock was not held."
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Both twins report "not acquired" and run the body anyway — exactly what the
// real modules do when their budget is spent.
vi.mock('../registry-lock.js', () => ({
  withRegistryFileLock: async (_dir: string, fn: (acquired: boolean) => Promise<unknown>) =>
    fn(false),
}));
vi.mock('../../web/lib/server/registry-lock.js', () => ({
  withRegistryFileLock: async (_dir: string, fn: (acquired: boolean) => Promise<unknown>) =>
    fn(false),
}));

import { registerProject, updateProjectMeta } from '../projects.js';
import { readJournal } from '../registry-journal.js';
import { addProject as webAddProject } from '../../web/lib/server/registry-store.js';

let homeDir: string;
let navDir: string;
let registryPath: string;
let prevHome: string | undefined;

beforeEach(() => {
  homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-degraded-'));
  navDir = path.join(homeDir, '.navgator');
  registryPath = path.join(navDir, 'projects.json');
  prevHome = process.env.HOME;
  process.env.HOME = homeDir;
});

afterEach(() => {
  if (prevHome === undefined) delete process.env.HOME;
  else process.env.HOME = prevHome;
  fs.rmSync(homeDir, { recursive: true, force: true });
});

function readRegistry() {
  return JSON.parse(fs.readFileSync(registryPath, 'utf-8')) as {
    revision?: number;
    projects: { path: string }[];
  };
}

describe('with the file lock unavailable', () => {
  // MUTANT: neutralize `withRegistryLock` in src/projects.ts -> this fails.
  it('the CLI mutex still keeps every concurrent registration', async () => {
    await Promise.all(
      Array.from({ length: 8 }, (_, i) => registerProject(`/repos/degraded-${i}`))
    );

    const paths = readRegistry().projects.map((p) => p.path);
    expect(paths).toHaveLength(8);
    for (let i = 0; i < 8; i++) expect(paths).toContain(`/repos/degraded-${i}`);
  }, 30_000);

  // MUTANT: neutralize `withRegistryLock` in web/lib/server/registry-store.ts -> this fails.
  it('the dashboard mutex still keeps every concurrent registration', async () => {
    await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        webAddProject(`/repos/degraded-web-${i}`, {
          name: `Degraded ${i}`,
          addedAt: Date.now(),
          lastScan: null,
          scanCount: 0,
        })
      )
    );

    expect(readRegistry().projects).toHaveLength(8);
  }, 30_000);

  it('keeps the revision counter exact across both units without the lock', async () => {
    await Promise.all([
      registerProject('/repos/dg-cli-1'),
      updateProjectMeta('/repos/dg-cli-2', { origin: { kind: 'local' } }),
      registerProject('/repos/dg-cli-3'),
    ]);

    expect(readRegistry().revision).toBe(3);
    expect(readRegistry().projects).toHaveLength(3);
  }, 30_000);

  it('records the write as unlocked rather than presenting it as serialized', async () => {
    await registerProject('/repos/degraded-journal');

    const writes = readJournal({ dir: navDir, op: 'register', limit: 20 });
    expect(writes).toHaveLength(1);
    // A positive marker, so a locked write and a write from a build with no lock
    // code at all are distinguishable when reading an old journal back.
    expect(writes[0].locked).toBe(false);
  }, 30_000);
});
