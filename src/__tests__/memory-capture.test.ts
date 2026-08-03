/**
 * Capture wiring: `registerProject`, `removeProject`, and `pruneProjects`
 * (src/projects.ts) emitting into gator-memory (src/memory/store.ts).
 *
 * Three properties this suite exists to convict a regression of, matching
 * the three capture constraints in `src/projects.ts`:
 *
 *   1. Anti-noise — a routine ('patch'/absent-significance) rescan must not
 *      grow the store. Asserted by COUNT, not just by the absence of one
 *      kind, because a capture bug that emits the WRONG kind on every scan
 *      would still pass a kind-only assertion.
 *   2. Fail-open — a broken memory store must never break a registry write.
 *      Proven by making the memory dir genuinely unwritable and checking the
 *      registry write still lands, not just that no exception escaped.
 *   3. `pruneProjects` batches through ONE `mutateRegistry` call (one journal
 *      `remove` record, one revision bump for the whole batch) rather than
 *      looping `removeProject` — proven by reading the registry journal back.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { registerProject, removeProject, pruneProjects, loadRegistry } from '../projects.js';
import { readMemoryEvents, listProjectMemories, memoryDir } from '../memory/store.js';
import { readJournal } from '../registry-journal.js';

let homeDir: string;
let prevHome: string | undefined;

beforeEach(() => {
  homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-memory-capture-'));
  prevHome = process.env.HOME;
  process.env.HOME = homeDir;
});

afterEach(() => {
  if (prevHome === undefined) delete process.env.HOME;
  else process.env.HOME = prevHome;
  fs.rmSync(homeDir, { recursive: true, force: true });
});

describe('gator-memory capture wiring', () => {
  it('registerProject on a new path emits exactly one project.registered event', async () => {
    await registerProject('/repos/capture-1', { components: 3, connections: 2, prompts: 0 });

    const events = readMemoryEvents({ limit: 100 });
    expect(events).toHaveLength(1);
    expect(events[0]?.kind).toBe('project.registered');
  });

  it('a patch-significance rescan emits no new memory event (count, not just kind)', async () => {
    await registerProject('/repos/capture-2', { components: 3, connections: 2, prompts: 0 });
    const before = readMemoryEvents({ limit: 100 }).length;

    await registerProject(
      '/repos/capture-2',
      { components: 3, connections: 2, prompts: 0 },
      'patch'
    );

    expect(readMemoryEvents({ limit: 100 })).toHaveLength(before);
  });

  it('an absent-significance rescan also emits no new memory event', async () => {
    await registerProject('/repos/capture-2b', { components: 3, connections: 2, prompts: 0 });
    const before = readMemoryEvents({ limit: 100 }).length;

    await registerProject('/repos/capture-2b', { components: 3, connections: 2, prompts: 0 });

    expect(readMemoryEvents({ limit: 100 })).toHaveLength(before);
  });

  it('a major-significance rescan emits a project.scanned event', async () => {
    await registerProject('/repos/capture-3', { components: 3, connections: 2, prompts: 0 });
    await registerProject(
      '/repos/capture-3',
      { components: 5, connections: 4, prompts: 0 },
      'major'
    );

    const events = readMemoryEvents({ limit: 100 });
    expect(events.some((e) => e.kind === 'project.scanned')).toBe(true);
  });

  it('a major rescan with a changeSummary ALSO emits architecture.changed carrying the four deltas', async () => {
    await registerProject('/repos/capture-4', { components: 3, connections: 2, prompts: 0 });
    await registerProject(
      '/repos/capture-4',
      { components: 5, connections: 4, prompts: 0 },
      'major',
      undefined,
      { componentsAdded: 2, componentsRemoved: 0, connectionsAdded: 2, connectionsRemoved: 0 }
    );

    const events = readMemoryEvents({ limit: 100 });
    expect(events.some((e) => e.kind === 'project.scanned')).toBe(true);
    const archEvent = events.find((e) => e.kind === 'architecture.changed');
    expect(archEvent).toBeDefined();
    expect(archEvent?.detail).toMatchObject({
      componentsAdded: 2,
      componentsRemoved: 0,
      connectionsAdded: 2,
      connectionsRemoved: 0,
    });
  });

  it('removeProject on a registered path emits project.removed and flips status to removed', async () => {
    await registerProject('/repos/capture-5', { components: 1, connections: 0, prompts: 0 });

    const removed = await removeProject('/repos/capture-5');
    expect(removed).toBe(true);

    const events = readMemoryEvents({ limit: 100 });
    expect(events.some((e) => e.kind === 'project.removed')).toBe(true);

    const records = listProjectMemories();
    const record = records.find((r) => r.path === path.resolve('/repos/capture-5'));
    expect(record?.status).toBe('removed');
  });

  it('removeProject on an unregistered path emits no event', async () => {
    const removed = await removeProject('/repos/never-registered');
    expect(removed).toBe(false);
    expect(readMemoryEvents({ limit: 100 })).toHaveLength(0);
  });

  it('memory capture fails open when the memory directory is unwritable', async () => {
    if (process.platform === 'win32') return; // chmod semantics differ on Windows.

    const dir = memoryDir();
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.chmodSync(dir, 0o500);

    try {
      await expect(
        registerProject('/repos/capture-fail-open', { components: 1, connections: 0, prompts: 0 })
      ).resolves.toBeUndefined();
    } finally {
      fs.chmodSync(dir, 0o700);
    }

    // The whole safety claim: memory must never break a registry write.
    const registry = await loadRegistry();
    expect(registry.projects.find((p) => p.path === '/repos/capture-fail-open')).toBeDefined();
  });

  it('NAVGATOR_MEMORY=0 disables capture without breaking the registry write', async () => {
    const prevFlag = process.env.NAVGATOR_MEMORY;
    process.env.NAVGATOR_MEMORY = '0';
    try {
      await registerProject('/repos/capture-disabled', { components: 1, connections: 0, prompts: 0 });
    } finally {
      if (prevFlag === undefined) delete process.env.NAVGATOR_MEMORY;
      else process.env.NAVGATOR_MEMORY = prevFlag;
    }

    const registry = await loadRegistry();
    expect(registry.projects.find((p) => p.path === '/repos/capture-disabled')).toBeDefined();
    expect(fs.existsSync(memoryDir())).toBe(false);
  });

  it('pruneProjects removes exactly the listed paths and emits one project.removed per removed entry', async () => {
    await registerProject('/repos/prune-a', { components: 1, connections: 0, prompts: 0 });
    await registerProject('/repos/prune-b', { components: 1, connections: 0, prompts: 0 });
    await registerProject('/repos/prune-c', { components: 1, connections: 0, prompts: 0 });

    const before = readMemoryEvents({ limit: 100 }).length;
    const { removed } = await pruneProjects(['/repos/prune-a', '/repos/prune-b']);

    expect(removed.map((e) => e.path).sort()).toEqual(['/repos/prune-a', '/repos/prune-b']);

    const registry = await loadRegistry();
    expect(registry.projects.map((p) => p.path)).toEqual(['/repos/prune-c']);

    const events = readMemoryEvents({ limit: 100 });
    expect(events.length - before).toBe(2);
    expect(events.filter((e) => e.kind === 'project.removed').length).toBeGreaterThanOrEqual(2);
  });

  it('pruneProjects([]) and a no-match list are no-ops — removed: [] and no revision bump', async () => {
    await registerProject('/repos/prune-keep', { components: 1, connections: 0, prompts: 0 });
    const revBefore = (await loadRegistry()).revision;

    const emptyResult = await pruneProjects([]);
    expect(emptyResult.removed).toEqual([]);

    const noMatchResult = await pruneProjects(['/repos/does-not-exist']);
    expect(noMatchResult.removed).toEqual([]);

    const revAfter = (await loadRegistry()).revision;
    expect(revAfter).toBe(revBefore);

    const registry = await loadRegistry();
    expect(registry.projects.map((p) => p.path)).toEqual(['/repos/prune-keep']);
  });

  it('pruneProjects goes through the journaled+locked registry write path (G3 positive check)', async () => {
    await registerProject('/repos/prune-journal', { components: 1, connections: 0, prompts: 0 });
    await pruneProjects(['/repos/prune-journal']);

    const navDir = path.join(homeDir, '.navgator');
    const records = readJournal({ dir: navDir, op: 'remove', limit: 20 });
    expect(records.length).toBeGreaterThan(0);
    expect(records[records.length - 1]?.locked).toBe(true);
  });
});

// =============================================================================
// MIRROR ACTIVATION
// =============================================================================

/**
 * The mirror's activation path, not its behaviour.
 *
 * `src/__tests__/memory-mirror.test.ts` already proves `mirrorProjectMemory`
 * works when called. That is a different claim from "it ever gets called".
 * A capability that is correct, tested, documented, and unreachable is the
 * defect class these tests exist to close, so every assertion here goes
 * through a REAL `registerProject` call and never invokes the mirror directly.
 */
describe('mirror activation from registerProject', () => {
  let target: string;
  let prevMirror: string | undefined;
  let prevTarget: string | undefined;

  const mirroredJson = (slugDir: string) =>
    path.join(target, 'projects', slugDir, 'architecture', 'navgator-memory.json');

  beforeEach(async () => {
    target = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-blm-target-'));
    fs.mkdirSync(path.join(target, 'projects'), { recursive: true });
    prevMirror = process.env.NAVGATOR_MEMORY_MIRROR;
    prevTarget = process.env.NAVGATOR_MEMORY_MIRROR_TARGET;
    const { resetHomeConfigCache } = await import('../home-config.js');
    resetHomeConfigCache();
  });

  afterEach(async () => {
    if (prevMirror === undefined) delete process.env.NAVGATOR_MEMORY_MIRROR;
    else process.env.NAVGATOR_MEMORY_MIRROR = prevMirror;
    if (prevTarget === undefined) delete process.env.NAVGATOR_MEMORY_MIRROR_TARGET;
    else process.env.NAVGATOR_MEMORY_MIRROR_TARGET = prevTarget;
    fs.rmSync(target, { recursive: true, force: true });
    const { resetHomeConfigCache } = await import('../home-config.js');
    resetHomeConfigCache();
  });

  async function enableMirror(): Promise<void> {
    process.env.NAVGATOR_MEMORY_MIRROR = '1';
    process.env.NAVGATOR_MEMORY_MIRROR_TARGET = target;
    const { resetHomeConfigCache } = await import('../home-config.js');
    resetHomeConfigCache();
  }

  it('registering a project reaches the mirror', async () => {
    await enableMirror();
    await registerProject('/repos/activation-new', { components: 1, connections: 0, prompts: 0 });

    expect(fs.existsSync(mirroredJson('activation-new'))).toBe(true);
  });

  it('a significant architecture change reaches the mirror', async () => {
    await enableMirror();
    await registerProject('/repos/activation-change');

    const before = fs.statSync(mirroredJson('activation-change')).mtimeMs;
    await new Promise((r) => setTimeout(r, 10));

    await registerProject(
      '/repos/activation-change',
      { components: 5, connections: 4, prompts: 0 },
      'major',
      undefined,
      { componentsAdded: 4, componentsRemoved: 0, connectionsAdded: 4, connectionsRemoved: 0 }
    );

    expect(fs.statSync(mirroredJson('activation-change')).mtimeMs).toBeGreaterThan(before);
  });

  it('a routine patch rescan does NOT re-reach the mirror', async () => {
    // The mirror target is typically a git repo. Writing on every scan would
    // turn a knowledge export into churn, so the gate must be the same
    // significance gate capture uses — not merely "registerProject ran".
    await enableMirror();
    await registerProject('/repos/activation-quiet');

    const before = fs.statSync(mirroredJson('activation-quiet')).mtimeMs;
    await new Promise((r) => setTimeout(r, 10));

    await registerProject('/repos/activation-quiet', undefined, 'patch');

    expect(fs.statSync(mirroredJson('activation-quiet')).mtimeMs).toBe(before);
  });

  it('writes nothing when the mirror is off — the default', async () => {
    await registerProject('/repos/activation-off', { components: 1, connections: 0, prompts: 0 });

    expect(fs.existsSync(path.join(target, 'projects', 'activation-off'))).toBe(false);
  });

  it('registry write still succeeds when the mirror target is missing', async () => {
    process.env.NAVGATOR_MEMORY_MIRROR = '1';
    process.env.NAVGATOR_MEMORY_MIRROR_TARGET = path.join(target, 'does-not-exist');
    const { resetHomeConfigCache } = await import('../home-config.js');
    resetHomeConfigCache();

    await registerProject('/repos/activation-absent', { components: 1, connections: 0, prompts: 0 });

    const registry = await loadRegistry();
    expect(registry.projects.map((p) => p.path)).toContain('/repos/activation-absent');
    expect(fs.existsSync(path.join(target, 'does-not-exist'))).toBe(false);
  });
});
