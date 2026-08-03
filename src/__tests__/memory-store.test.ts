/**
 * gator-memory core store — `src/memory/store.ts`.
 *
 * Redirects `$HOME` to a fresh `mkdtemp` directory in `beforeEach` (in
 * addition to the suite-wide per-FILE redirect in
 * `src/__tests__/setup/home-redirect.ts`) because several tests here need a
 * fresh, EMPTY home per TEST — the bound tests and the corruption tests both
 * depend on starting from nothing. Restored in `afterEach` with the
 * undefined guard, per the project convention (`registry-concurrency-oracle
 * .test.ts` is the canonical example of getting this right).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  memoryEnabled,
  memoryDir,
  projectMemoryPath,
  recordMemoryEvent,
  readProjectMemory,
  listProjectMemories,
  readMemoryEvents,
  memoryStoreStats,
  removeProjectMemory,
  rebuildMemoryIndex,
  reconcileMemory,
  slug,
  MAX_MILESTONES,
} from '../memory/store.js';
import { resetHomeConfigCache, homeConfigPath } from '../home-config.js';

let homeDir: string;
let prevHome: string | undefined;
let prevMemoryEnv: string | undefined;
let prevMaxEventBytesEnv: string | undefined;
let prevMaxMilestonesEnv: string | undefined;

beforeEach(() => {
  homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-memory-store-'));
  prevHome = process.env.HOME;
  process.env.HOME = homeDir;

  prevMemoryEnv = process.env.NAVGATOR_MEMORY;
  prevMaxEventBytesEnv = process.env.NAVGATOR_MEMORY_MAX_EVENT_BYTES;
  prevMaxMilestonesEnv = process.env.NAVGATOR_MEMORY_MAX_MILESTONES;
  delete process.env.NAVGATOR_MEMORY;
  delete process.env.NAVGATOR_MEMORY_MAX_EVENT_BYTES;
  delete process.env.NAVGATOR_MEMORY_MAX_MILESTONES;

  resetHomeConfigCache();
});

afterEach(() => {
  if (prevHome === undefined) delete process.env.HOME;
  else process.env.HOME = prevHome;

  if (prevMemoryEnv === undefined) delete process.env.NAVGATOR_MEMORY;
  else process.env.NAVGATOR_MEMORY = prevMemoryEnv;

  if (prevMaxEventBytesEnv === undefined) delete process.env.NAVGATOR_MEMORY_MAX_EVENT_BYTES;
  else process.env.NAVGATOR_MEMORY_MAX_EVENT_BYTES = prevMaxEventBytesEnv;

  if (prevMaxMilestonesEnv === undefined) delete process.env.NAVGATOR_MEMORY_MAX_MILESTONES;
  else process.env.NAVGATOR_MEMORY_MAX_MILESTONES = prevMaxMilestonesEnv;

  resetHomeConfigCache();
  fs.rmSync(homeDir, { recursive: true, force: true });
});

function eventsPath(): string {
  return path.join(memoryDir(), 'events.jsonl');
}
function rotatedEventsPath(): string {
  return path.join(memoryDir(), 'events.1.jsonl');
}
function indexPath(): string {
  return path.join(memoryDir(), 'index.json');
}

// =============================================================================
// BASICS — creation, round-trip
// =============================================================================

describe('recordMemoryEvent — first write', () => {
  it('creates the whole tree and round-trips the project record', async () => {
    const projectPath = path.join(homeDir, 'projects', 'my-app');

    await recordMemoryEvent({
      projectPath,
      kind: 'project.registered',
      summary: 'Registered my-app',
    });

    expect(fs.existsSync(memoryDir())).toBe(true);
    expect(fs.existsSync(eventsPath())).toBe(true);
    // NOT index.json — capture never writes the shared rollup. See the
    // dedicated describe block below for why that is a correctness property.
    expect(fs.existsSync(indexPath())).toBe(false);

    const projectSlug = slug(projectPath);
    expect(fs.existsSync(projectMemoryPath(projectSlug))).toBe(true);

    const record = readProjectMemory(projectPath);
    expect(record).not.toBeNull();
    expect(record?.slug).toBe(projectSlug);
    expect(record?.path).toBe(path.resolve(projectPath));
    expect(record?.name).toBe('my-app');
    expect(record?.status).toBe('active');
    expect(record?.milestones).toHaveLength(1);
    expect(record?.milestones[0]?.summary).toBe('Registered my-app');
  });
});

// =============================================================================
// COUNTERS — scans, firstSeen preservation
// =============================================================================

describe('counters', () => {
  it('increments scans on project.scanned and preserves firstSeen', async () => {
    const projectPath = path.join(homeDir, 'projects', 'counted');

    await recordMemoryEvent({
      projectPath,
      kind: 'project.registered',
      summary: 'Registered',
      ts: 1000,
    });
    const firstSeen = readProjectMemory(projectPath)?.firstSeen;
    expect(firstSeen).toBe(1000);

    for (let i = 0; i < 3; i++) {
      await recordMemoryEvent({
        projectPath,
        kind: 'project.scanned',
        summary: `Scan ${i}`,
        ts: 2000 + i,
        detail: { components: 10 + i, connections: 5 },
      });
    }

    const record = readProjectMemory(projectPath);
    expect(record?.counters.scans).toBe(3);
    expect(record?.firstSeen).toBe(1000); // unchanged
    expect(record?.lastSeen).toBe(2002);
    expect(record?.latest?.components).toBe(12);
    expect(record?.latest?.connections).toBe(5);
  });

  it('increments significantChanges on architecture.changed and keeps the detail', async () => {
    const projectPath = path.join(homeDir, 'projects', 'changed');

    await recordMemoryEvent({ projectPath, kind: 'project.registered', summary: 'Registered' });
    await recordMemoryEvent({
      projectPath,
      kind: 'architecture.changed',
      summary: 'Added a queue consumer',
      detail: {
        significance: 'major',
        componentsAdded: 2,
        componentsRemoved: 0,
        connectionsAdded: 3,
        connectionsRemoved: 1,
      },
    });

    const record = readProjectMemory(projectPath);
    expect(record?.counters.significantChanges).toBe(1);
    const milestone = record?.milestones[record.milestones.length - 1];
    expect(milestone?.detail?.significance).toBe('major');
    expect(milestone?.detail?.componentsAdded).toBe(2);
    expect(milestone?.detail?.connectionsAdded).toBe(3);
    expect(milestone?.detail?.connectionsRemoved).toBe(1);
  });
});

// =============================================================================
// REMOVAL — soft (event) vs hard (removeProjectMemory)
// =============================================================================

describe('project.removed event', () => {
  it('marks status removed WITHOUT deleting the record', async () => {
    const projectPath = path.join(homeDir, 'projects', 'goner');

    await recordMemoryEvent({ projectPath, kind: 'project.registered', summary: 'Registered' });
    await recordMemoryEvent({ projectPath, kind: 'project.removed', summary: 'Unregistered' });

    const record = readProjectMemory(projectPath);
    expect(record).not.toBeNull();
    expect(record?.status).toBe('removed');
    expect(fs.existsSync(projectMemoryPath(slug(projectPath)))).toBe(true);
  });
});

describe('removeProjectMemory — hard delete', () => {
  it('deletes the record and drops it from the index', async () => {
    const projectPath = path.join(homeDir, 'projects', 'to-forget');
    await recordMemoryEvent({ projectPath, kind: 'project.registered', summary: 'Registered' });

    expect(removeProjectMemory(projectPath)).toBe(true);
    expect(readProjectMemory(projectPath)).toBeNull();
    expect(listProjectMemories().some((r) => r.slug === slug(projectPath))).toBe(false);
  });

  it('returns false when there was nothing to remove', () => {
    expect(removeProjectMemory(path.join(homeDir, 'projects', 'never-existed'))).toBe(false);
  });
});

// =============================================================================
// BOUND TEST — milestones capped at MAX_MILESTONES, oldest evicted first
// =============================================================================

describe('milestone bound', () => {
  it(`caps milestones at MAX_MILESTONES (${MAX_MILESTONES}) and evicts the OLDEST`, async () => {
    const projectPath = path.join(homeDir, 'projects', 'bounded');
    const total = MAX_MILESTONES + 25;

    for (let i = 0; i < total; i++) {
      await recordMemoryEvent({
        projectPath,
        kind: 'project.scanned',
        summary: `event-${i}`,
        ts: 1000 + i,
      });
    }

    const record = readProjectMemory(projectPath);
    expect(record?.milestones).toHaveLength(MAX_MILESTONES);

    // The oldest 25 (event-0 .. event-24) must have been evicted — assert the
    // newest SURVIVOR's identity, not just the length, so a bug that keeps
    // the wrong 40 (e.g. the oldest 40) cannot pass this test.
    const oldestSurvivorIndex = total - MAX_MILESTONES; // 25
    expect(record?.milestones[0]?.summary).toBe(`event-${oldestSurvivorIndex}`);
    expect(record?.milestones[MAX_MILESTONES - 1]?.summary).toBe(`event-${total - 1}`);
  }, 30_000);
});

// =============================================================================
// ROTATION — events.jsonl -> events.1.jsonl, one generation, bound holds
// =============================================================================

describe('events.jsonl rotation', () => {
  it('rotates to events.1.jsonl and keeps total bytes under the documented bound', async () => {
    process.env.NAVGATOR_MEMORY_MAX_EVENT_BYTES = '2000';
    const projectPath = path.join(homeDir, 'projects', 'rotated');

    // Each record is roughly 90-120 bytes; 60 records comfortably exceeds a
    // 2000-byte threshold at least twice over, forcing at least one rotation.
    for (let i = 0; i < 60; i++) {
      await recordMemoryEvent({
        projectPath,
        kind: 'project.scanned',
        summary: `rotate-${i}`,
        ts: 3000 + i,
      });
    }

    expect(fs.existsSync(rotatedEventsPath())).toBe(true);

    const liveBytes = fs.statSync(eventsPath()).size;
    const rotatedBytes = fs.statSync(rotatedEventsPath()).size;
    const maxEventBytes = 2000;
    // The documented bound: 2 * maxEventBytes + 1 record. A generous single
    // record ceiling (1000 bytes) is used since these are short summaries.
    expect(liveBytes + rotatedBytes).toBeLessThan(2 * maxEventBytes + 1000);

    // The live generation actually restarted rather than just being small by
    // coincidence: it must contain the MOST RECENT record.
    const liveContent = fs.readFileSync(eventsPath(), 'utf-8');
    expect(liveContent).toContain('rotate-59');
  }, 30_000);
});

// =============================================================================
// CORRUPTION RECOVERY
// =============================================================================

describe('corrupt project record', () => {
  it('reads as null, does not throw, and recordMemoryEvent recovers by rebuilding', async () => {
    const projectPath = path.join(homeDir, 'projects', 'corrupt');
    const projectSlug = slug(projectPath);
    const filePath = projectMemoryPath(projectSlug);

    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, 'not json');

    expect(() => readProjectMemory(projectPath)).not.toThrow();
    expect(readProjectMemory(projectPath)).toBeNull();

    await recordMemoryEvent({
      projectPath,
      kind: 'project.registered',
      summary: 'Recovered',
    });

    const record = readProjectMemory(projectPath);
    expect(record).not.toBeNull();
    expect(record?.milestones).toHaveLength(1);
  });
});

describe('torn events.jsonl line', () => {
  it('skips the torn line and still returns the intact records', async () => {
    const projectPath = path.join(homeDir, 'projects', 'torn');
    await recordMemoryEvent({ projectPath, kind: 'project.registered', summary: 'First' });
    await recordMemoryEvent({ projectPath, kind: 'project.scanned', summary: 'Second' });

    // Simulate a process killed mid-append: a torn (unparseable) final line.
    fs.appendFileSync(eventsPath(), '{"ts":123,"slug":"x","kind":"proj'); // no trailing newline, truncated

    const events = readMemoryEvents({ limit: 100 });
    expect(events.some((e) => e.summary === 'First')).toBe(true);
    expect(events.some((e) => e.summary === 'Second')).toBe(true);
    expect(events.every((e) => typeof e.ts === 'number')).toBe(true);
  });
});

// =============================================================================
// UNWRITABLE DIRECTORY — fail-open
// =============================================================================

describe('unwritable memory directory', () => {
  it('resolves without throwing (fail-open)', async () => {
    if (process.platform === 'win32') return; // chmod semantics differ

    const dir = memoryDir();
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.chmodSync(dir, 0o500);

    try {
      await expect(
        recordMemoryEvent({
          projectPath: path.join(homeDir, 'projects', 'blocked'),
          kind: 'project.registered',
          summary: 'Should not throw',
        })
      ).resolves.toBeUndefined();
    } finally {
      fs.chmodSync(dir, 0o700);
    }
  });
});

// =============================================================================
// SLUG — determinism, uniqueness, sanitization
// =============================================================================

describe('slug', () => {
  it('is deterministic for the same absolute path', () => {
    const p = path.join(homeDir, 'projects', 'stable');
    expect(slug(p)).toBe(slug(p));
  });

  it('produces DIFFERENT slugs for two different paths sharing a basename', () => {
    const a = path.join(homeDir, 'one', 'web');
    const b = path.join(homeDir, 'two', 'web');
    expect(slug(a)).not.toBe(slug(b));
    // Both still carry the kebab-cased basename as a prefix.
    expect(slug(a).startsWith('web-')).toBe(true);
    expect(slug(b).startsWith('web-')).toBe(true);
  });
});

describe('summary sanitization', () => {
  it('strips ANSI escape and newline characters from a stored summary', async () => {
    const projectPath = path.join(homeDir, 'projects', 'ansi');
    const dirty = '\x1b[31mRed alert\x1b[0m\nSecond line';

    await recordMemoryEvent({ projectPath, kind: 'project.registered', summary: dirty });

    const record = readProjectMemory(projectPath);
    const stored = record?.milestones[0]?.summary ?? '';
    expect(stored).not.toContain('\x1b');
    expect(stored).not.toContain('\n');
  });
});

// =============================================================================
// NAVGATOR_MEMORY=0 — memory capture fully disabled
// =============================================================================

describe('NAVGATOR_MEMORY=0', () => {
  it('writes nothing at all — the memory directory never appears', async () => {
    process.env.NAVGATOR_MEMORY = '0';
    expect(memoryEnabled()).toBe(false);

    await recordMemoryEvent({
      projectPath: path.join(homeDir, 'projects', 'disabled'),
      kind: 'project.registered',
      summary: 'Should not be written',
    });

    expect(fs.existsSync(memoryDir())).toBe(false);
  });
});

// =============================================================================
// FILE MODES
// =============================================================================

describe('file permissions', () => {
  it('creates the memory dir 0o700 and project/index files 0o600', async () => {
    if (process.platform === 'win32') return; // POSIX modes don't apply

    const projectPath = path.join(homeDir, 'projects', 'perms');
    await recordMemoryEvent({ projectPath, kind: 'project.registered', summary: 'Perms' });

    const dirMode = fs.statSync(memoryDir()).mode & 0o777;
    expect(dirMode).toBe(0o700);

    const projectFileMode = fs.statSync(projectMemoryPath(slug(projectPath))).mode & 0o777;
    expect(projectFileMode).toBe(0o600);

    const eventsFileMode = fs.statSync(eventsPath()).mode & 0o777;
    expect(eventsFileMode).toBe(0o600);

    // The index is written by the hygiene path, not by capture — so it has to
    // be materialized before its mode can be asserted.
    rebuildMemoryIndex();
    const indexFileMode = fs.statSync(indexPath()).mode & 0o777;
    expect(indexFileMode).toBe(0o600);
  });
});

// =============================================================================
// listProjectMemories / readMemoryEvents / memoryStoreStats
// =============================================================================

describe('listProjectMemories', () => {
  it('returns every recorded project', async () => {
    await recordMemoryEvent({
      projectPath: path.join(homeDir, 'projects', 'p1'),
      kind: 'project.registered',
      summary: 'P1',
    });
    await recordMemoryEvent({
      projectPath: path.join(homeDir, 'projects', 'p2'),
      kind: 'project.registered',
      summary: 'P2',
    });

    const all = listProjectMemories();
    expect(all).toHaveLength(2);
    expect(all.map((r) => r.name).sort()).toEqual(['p1', 'p2']);
  });

  it('returns an empty array when the store does not exist', () => {
    expect(listProjectMemories()).toEqual([]);
  });
});

describe('readMemoryEvents', () => {
  it('filters by slug and kind', async () => {
    const a = path.join(homeDir, 'projects', 'alpha');
    const b = path.join(homeDir, 'projects', 'beta');

    await recordMemoryEvent({ projectPath: a, kind: 'project.registered', summary: 'A reg' });
    await recordMemoryEvent({ projectPath: a, kind: 'project.scanned', summary: 'A scan' });
    await recordMemoryEvent({ projectPath: b, kind: 'project.registered', summary: 'B reg' });

    const aOnly = readMemoryEvents({ slug: slug(a), limit: 100 });
    expect(aOnly).toHaveLength(2);
    expect(aOnly.every((e) => e.slug === slug(a))).toBe(true);

    const scannedOnly = readMemoryEvents({ kind: 'project.scanned', limit: 100 });
    expect(scannedOnly).toHaveLength(1);
    expect(scannedOnly[0]?.summary).toBe('A scan');
  });
});

describe('memoryStoreStats', () => {
  it('reports exists:false with zeroed counts when nothing has been written', () => {
    const stats = memoryStoreStats();
    expect(stats.exists).toBe(false);
    expect(stats.projects).toBe(0);
    expect(stats.events).toBe(0);
    expect(stats.lastEventAt).toBeNull();
  });

  it('reports accurate counts after writes', async () => {
    await recordMemoryEvent({
      projectPath: path.join(homeDir, 'projects', 'stat-a'),
      kind: 'project.registered',
      summary: 'A',
      ts: 500,
    });
    await recordMemoryEvent({
      projectPath: path.join(homeDir, 'projects', 'stat-b'),
      kind: 'project.registered',
      summary: 'B',
      ts: 600,
    });

    const stats = memoryStoreStats();
    expect(stats.exists).toBe(true);
    expect(stats.projects).toBe(2);
    expect(stats.events).toBe(2);
    expect(stats.lastEventAt).toBe(600);
    expect(stats.bytes).toBeGreaterThan(0);
  });
});

// =============================================================================
// INDEX IS OFF THE CAPTURE PATH
// =============================================================================

describe('index.json is not on the capture write path', () => {
  const indexFile = () => path.join(memoryDir(), 'index.json');

  it('recordMemoryEvent writes NO index.json', async () => {
    // The falsifier for the concurrency argument in the module header. If a
    // future change reintroduces a shared-rollup write here, scanPortfolio's
    // concurrent workers race on one unserialized file — the exact
    // lost-update defect closed in src/projects.ts, one layer up.
    await recordMemoryEvent({
      projectPath: '/repos/alpha',
      kind: 'project.registered',
      summary: 'registered',
    });

    expect(fs.existsSync(projectMemoryPath(slug('/repos/alpha')))).toBe(true);
    expect(fs.existsSync(indexFile())).toBe(false);
  });

  it('rebuildMemoryIndex materializes the rollup from the per-project records', async () => {
    await recordMemoryEvent({
      projectPath: '/repos/alpha',
      kind: 'project.registered',
      summary: 'registered',
    });
    await recordMemoryEvent({
      projectPath: '/repos/beta',
      kind: 'project.registered',
      summary: 'registered',
    });

    const result = rebuildMemoryIndex();
    expect(result.projects).toBe(2);

    const index = JSON.parse(fs.readFileSync(indexFile(), 'utf-8'));
    expect(Object.keys(index.projects).sort()).toEqual(
      [slug('/repos/alpha'), slug('/repos/beta')].sort()
    );
  });

  it('listProjectMemories ignores a stale index rather than trusting it', async () => {
    await recordMemoryEvent({
      projectPath: '/repos/alpha',
      kind: 'project.registered',
      summary: 'registered',
    });
    rebuildMemoryIndex();

    // A project captured AFTER the last rebuild. A reader that used the index
    // for its slug list would silently omit it — the "tool says it's fine and
    // it isn't" failure this store exists to avoid.
    await recordMemoryEvent({
      projectPath: '/repos/gamma',
      kind: 'project.registered',
      summary: 'registered',
    });

    const paths = listProjectMemories().map((r) => r.path);
    expect(paths).toContain('/repos/gamma');
    expect(paths).toHaveLength(2);
  });

  it('listProjectMemories survives a corrupt index', async () => {
    await recordMemoryEvent({
      projectPath: '/repos/alpha',
      kind: 'project.registered',
      summary: 'registered',
    });
    fs.writeFileSync(indexFile(), 'not json at all');

    expect(listProjectMemories().map((r) => r.path)).toEqual(['/repos/alpha']);
  });
});

describe('concurrent capture across different projects', () => {
  it('does not lose a record when two projects are captured together', async () => {
    // scanPortfolio runs N concurrent in-process workers, each reaching
    // registerProject. Single-project-scoped writes mean they never contend.
    const projects = Array.from({ length: 8 }, (_, i) => `/repos/worker-${i}`);

    await Promise.all(
      projects.map((p) =>
        recordMemoryEvent({
          projectPath: p,
          kind: 'project.registered',
          summary: 'registered',
        })
      )
    );

    const stored = listProjectMemories().map((r) => r.path).sort();
    expect(stored).toEqual([...projects].sort());
  });
});

describe('reconcileMemory', () => {
  it('reports records whose path is no longer in the registry', async () => {
    await recordMemoryEvent({
      projectPath: '/repos/live',
      kind: 'project.registered',
      summary: 'registered',
    });
    await recordMemoryEvent({
      projectPath: '/repos/deleted-via-dashboard',
      kind: 'project.registered',
      summary: 'registered',
    });

    const { orphaned } = reconcileMemory(['/repos/live']);
    expect(orphaned.map((r) => r.path)).toEqual(['/repos/deleted-via-dashboard']);
  });

  it('does not re-report a record already marked removed', async () => {
    await recordMemoryEvent({
      projectPath: '/repos/gone',
      kind: 'project.registered',
      summary: 'registered',
    });
    await recordMemoryEvent({
      projectPath: '/repos/gone',
      kind: 'project.removed',
      summary: 'removed',
    });

    expect(reconcileMemory([]).orphaned).toEqual([]);
  });

  it('returns nothing when every record is registered', async () => {
    await recordMemoryEvent({
      projectPath: '/repos/live',
      kind: 'project.registered',
      summary: 'registered',
    });
    expect(reconcileMemory(['/repos/live']).orphaned).toEqual([]);
  });
});

// =============================================================================
// SYMLINK RESISTANCE
// =============================================================================

describe('events.jsonl append refuses a pre-planted symlink', () => {
  it('does not write through a symlinked events.jsonl', async () => {
    // The O_NOFOLLOW flag on the append path was documented in the module
    // header and asserted NOWHERE — the security review (2026-08-03, SEC-008)
    // flagged that the control's most-cited property had no test. Without it,
    // anything able to write to ~/.navgator could pre-plant the journal path
    // as a link and redirect every append into an arbitrary file.
    if (process.platform === 'win32') return;

    const victim = path.join(homeDir, 'victim.txt');
    fs.writeFileSync(victim, 'original\n');

    const memDir = memoryDir();
    fs.mkdirSync(path.join(memDir, 'projects'), { recursive: true, mode: 0o700 });
    fs.symlinkSync(victim, path.join(memDir, 'events.jsonl'));

    // Fail-open: this must not throw regardless of the outcome.
    await recordMemoryEvent({
      projectPath: '/repos/symlink-probe',
      kind: 'project.registered',
      summary: 'registered',
    });

    // The victim file must be untouched — the append refused to follow.
    expect(fs.readFileSync(victim, 'utf-8')).toBe('original\n');
  });
});

// =============================================================================
// f2 — SAME-PATH CONCURRENT CAPTURE (per-slug CAS)
// =============================================================================

describe('f2 — same-path concurrent capture is no longer a lost-update race', () => {
  it('Promise.all of 50 recordMemoryEvent calls for the SAME project loses nothing', async () => {
    // MUTANT: revert writeProjectRecordWithCAS to a plain
    // readProjectMemoryBySlug -> applyEventToRecord -> atomicWriteJSONFile
    // (no re-read, no retry) and this drops to counters.scans === 1,
    // milestones.length === 1 — the exact defect the auditor measured.
    const projectPath = path.join(homeDir, 'projects', 'same-path-race');
    const total = 50;

    await Promise.all(
      Array.from({ length: total }, (_, i) =>
        recordMemoryEvent({
          projectPath,
          kind: 'project.scanned',
          summary: `race-${i}`,
          ts: 1000 + i,
        })
      )
    );

    const record = readProjectMemory(projectPath);
    expect(record?.counters.scans).toBe(total);
    expect(record?.milestones).toHaveLength(Math.min(total, MAX_MILESTONES));

    // The append-only chronology was never the defect; confirm it still kept
    // every line too.
    const events = readMemoryEvents({ slug: slug(projectPath), limit: total + 5 });
    expect(events).toHaveLength(total);
  }, 30_000);

  it('keeps the different-projects property unchanged (regression guard)', async () => {
    const projects = Array.from({ length: 8 }, (_, i) => `/repos/f2-worker-${i}`);

    await Promise.all(
      projects.map((p) =>
        recordMemoryEvent({ projectPath: p, kind: 'project.registered', summary: 'registered' })
      )
    );

    const stored = listProjectMemories()
      .map((r) => r.path)
      .sort();
    expect(stored).toEqual([...projects].sort());
  });
});

// =============================================================================
// f3 — HOME-CONFIG WIRING: maxMilestonesPerProject / maxEventBytes
// =============================================================================

describe('f3 — maxMilestonesPerProject and maxEventBytes are no longer inert', () => {
  it('file config caps milestones AND rotates events at the configured threshold', async () => {
    // MUTANT: revert maxMilestones()/maxEventBytes() to read only the
    // MAX_MILESTONES constant / DEFAULT_MAX_EVENT_BYTES (ignoring
    // loadHomeConfig()) and milestones.length lands at 40 instead of 5, and
    // events.1.jsonl never appears.
    fs.mkdirSync(path.dirname(homeConfigPath()), { recursive: true });
    fs.writeFileSync(
      homeConfigPath(),
      JSON.stringify({ memory: { maxMilestonesPerProject: 5, maxEventBytes: 500 } })
    );
    resetHomeConfigCache();

    const projectPath = path.join(homeDir, 'projects', 'wired');
    for (let i = 0; i < 60; i++) {
      await recordMemoryEvent({
        projectPath,
        kind: 'project.scanned',
        summary: `wired-${i}`,
        ts: 4000 + i,
      });
    }

    const record = readProjectMemory(projectPath);
    expect(record?.milestones).toHaveLength(5);
    expect(fs.existsSync(rotatedEventsPath())).toBe(true);
  }, 30_000);

  it('env var beats file for maxEventBytes', async () => {
    fs.mkdirSync(path.dirname(homeConfigPath()), { recursive: true });
    fs.writeFileSync(homeConfigPath(), JSON.stringify({ memory: { maxEventBytes: 5_000_000 } }));
    resetHomeConfigCache();
    process.env.NAVGATOR_MEMORY_MAX_EVENT_BYTES = '500';

    const projectPath = path.join(homeDir, 'projects', 'env-beats-file-bytes');
    for (let i = 0; i < 40; i++) {
      await recordMemoryEvent({
        projectPath,
        kind: 'project.scanned',
        summary: `e-${i}`,
        ts: 5000 + i,
      });
    }

    // If the 5MB file value had won, nothing would rotate at 40 tiny records.
    expect(fs.existsSync(rotatedEventsPath())).toBe(true);
  }, 30_000);

  it('env var beats file for maxMilestonesPerProject', async () => {
    fs.mkdirSync(path.dirname(homeConfigPath()), { recursive: true });
    fs.writeFileSync(
      homeConfigPath(),
      JSON.stringify({ memory: { maxMilestonesPerProject: 100 } })
    );
    resetHomeConfigCache();
    process.env.NAVGATOR_MEMORY_MAX_MILESTONES = '3';

    const projectPath = path.join(homeDir, 'projects', 'env-beats-file-milestones');
    for (let i = 0; i < 10; i++) {
      await recordMemoryEvent({
        projectPath,
        kind: 'project.scanned',
        summary: `m-${i}`,
        ts: 6000 + i,
      });
    }

    const record = readProjectMemory(projectPath);
    expect(record?.milestones).toHaveLength(3);
  });
});

describe('f3 — nonsense config values fall back to the default rather than breaking capture', () => {
  it.each([0, -1, 'abc'] as const)(
    'maxMilestonesPerProject=%s falls back to MAX_MILESTONES rather than breaking capture',
    async (bad) => {
      fs.mkdirSync(path.dirname(homeConfigPath()), { recursive: true });
      fs.writeFileSync(
        homeConfigPath(),
        JSON.stringify({ memory: { maxMilestonesPerProject: bad } })
      );
      resetHomeConfigCache();

      const projectPath = path.join(homeDir, 'projects', `nonsense-${String(bad)}`);
      for (let i = 0; i < 5; i++) {
        await recordMemoryEvent({
          projectPath,
          kind: 'project.scanned',
          summary: `n-${i}`,
          ts: 7000 + i,
        });
      }

      // Falls back to the 40-record default, not 0 (which would evict
      // everything) or -1/NaN (which would break `.slice()`), or the string
      // (already caught by loadHomeConfig's own type guard).
      const record = readProjectMemory(projectPath);
      expect(record?.milestones).toHaveLength(5);
    }
  );
});

// =============================================================================
// f8 — TRUNCATE FALLBACK WHEN THE ROTATION RENAME FAILS PERSISTENTLY
// =============================================================================

describe('f8 — truncate fallback when the rotation rename fails persistently', () => {
  it('holds events.jsonl near the threshold instead of growing without bound', async () => {
    // MUTANT: delete the `fs.truncateSync(liveEventsPath, 0)` call in
    // `rotateEventsIfNeeded` and this assertion fails — the live file grows
    // past 10KB because every append after the blocked rotation just keeps
    // appending to the un-rotated, un-truncated file.
    process.env.NAVGATOR_MEMORY_MAX_EVENT_BYTES = '5000';
    const projectPath = path.join(homeDir, 'projects', 'truncate-fallback');

    // Seed the tree, then pre-plant events.1.jsonl as a non-empty DIRECTORY —
    // portable, no chmod needed — so every subsequent rotation attempt's
    // `fs.renameSync(events.jsonl, events.1.jsonl)` fails persistently
    // (EEXIST/ENOTEMPTY/EISDIR depending on platform) and falls through to
    // the truncate fallback.
    await recordMemoryEvent({ projectPath, kind: 'project.registered', summary: 'seed' });
    fs.mkdirSync(rotatedEventsPath());
    fs.writeFileSync(path.join(rotatedEventsPath(), 'blocker.txt'), 'occupied');

    for (let i = 0; i < 3000; i++) {
      await recordMemoryEvent({
        projectPath,
        kind: 'project.scanned',
        summary: `t-${i}`,
        ts: 8000 + i,
      });
    }

    // The rename never succeeded — the planted directory is still there.
    expect(fs.statSync(rotatedEventsPath()).isDirectory()).toBe(true);

    // Load-bearing assertion: without the truncate fallback, 3000 appends at
    // ~90-120 bytes each would leave events.jsonl well past 270KB. The
    // fallback keeps it near the 5000-byte threshold.
    const liveBytes = fs.statSync(eventsPath()).size;
    expect(liveBytes).toBeLessThan(10_000);
  }, 60_000);
});
