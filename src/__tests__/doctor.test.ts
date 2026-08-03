/**
 * `navgator doctor` — `src/memory/health.ts` (the computation) and
 * `src/cli/commands/doctor.ts` (the CLI wiring around it).
 *
 * Redirects `$HOME` to a fresh `mkdtemp` directory per test (in addition to
 * the suite-wide per-FILE redirect in `src/__tests__/setup/home-redirect.ts`)
 * because several tests here need a fresh, EMPTY home — the schema and
 * empty-registry tests both depend on starting from nothing. Restored in
 * `afterEach` with the undefined guard, per the project convention
 * (`registry-concurrency-oracle.test.ts` is the canonical example).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  computeHealth,
  isTmpRootedPath,
  classifyRegistryEntries,
  selectPrunableEntries,
} from '../memory/health.js';
import { registerProject, loadRegistry } from '../projects.js';
import { recordMemoryEvent, readProjectMemory } from '../memory/store.js';
import { readJournal, defaultRegistryDir, journalPathForDir } from '../registry-journal.js';
import { resetHomeConfigCache } from '../home-config.js';
import { fixRegistry, describeMirrorRun } from '../cli/commands/doctor.js';

let homeDir: string;
let prevHome: string | undefined;

beforeEach(() => {
  homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-doctor-home-'));
  prevHome = process.env.HOME;
  process.env.HOME = homeDir;
  resetHomeConfigCache();
});

afterEach(() => {
  if (prevHome === undefined) delete process.env.HOME;
  else process.env.HOME = prevHome;
  resetHomeConfigCache();
  fs.rmSync(homeDir, { recursive: true, force: true });
});

// =============================================================================
// 1. EMPTY REGISTRY
// =============================================================================

describe('computeHealth — empty registry', () => {
  it('reports healthy with no crash, and memory.exists false with memory-absent finding', async () => {
    const report = await computeHealth();

    expect(report.verdict).toBe('healthy');
    expect(report.registry.entries).toBe(0);
    expect(report.registry.prunable).toBe(0);
    expect(report.memory.exists).toBe(false);
    expect(report.findings.some((f) => f.code === 'memory-absent')).toBe(true);
    // No warn-severity finding on a genuinely empty, fresh install.
    expect(report.findings.every((f) => f.severity !== 'warn')).toBe(true);
  });
});

// =============================================================================
// 2. REAL PATH + TMP-ROOTED MISSING PATH
// =============================================================================

describe('computeHealth — one real entry, one tmp-rooted-missing entry', () => {
  it('counts exactly one prunable entry and flips the verdict to attention', async () => {
    const realPath = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-doctor-real-'));
    const missingPath = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-doctor-missing-'));
    try {
      await registerProject(realPath, { components: 1, connections: 1, prompts: 0 });
      await registerProject(missingPath, { components: 1, connections: 1, prompts: 0 });
      // Simulate the temp fixture vanishing on its own after registration —
      // exactly the case `doctor --fix` exists to clean up.
      fs.rmSync(missingPath, { recursive: true, force: true });

      const report = await computeHealth();

      expect(report.registry.entries).toBe(2);
      expect(report.registry.missing).toBeGreaterThanOrEqual(1);
      expect(report.registry.prunable).toBe(1);
      expect(report.verdict).toBe('attention');
      expect(report.findings.some((f) => f.code === 'registry-prunable' && f.severity === 'warn')).toBe(
        true
      );
    } finally {
      fs.rmSync(realPath, { recursive: true, force: true });
    }
  });
});

// =============================================================================
// 3. THE PREDICATE — the three cases that stop cleanup from deleting real work
// =============================================================================

describe('isTmpRootedPath', () => {
  it('is true for a REAL existing directory under os.tmpdir(), but that entry is not prunable (it exists)', () => {
    const realTmpProject = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-doctor-existing-'));
    try {
      expect(isTmpRootedPath(realTmpProject)).toBe(true);

      const [classification] = classifyRegistryEntries([
        { path: realTmpProject, name: 'existing', addedAt: 0, lastScan: null, scanCount: 0 },
      ]);
      expect(classification!.tmpRooted).toBe(true);
      expect(classification!.missing).toBe(false);
      expect(classification!.prunable).toBe(false);
    } finally {
      fs.rmSync(realTmpProject, { recursive: true, force: true });
    }
  });

  it('is false for a missing NON-tmp path — missing but never prunable', () => {
    const missingNonTmp = '/nonexistent-doctor-test-path-abc123/inner-project';
    expect(isTmpRootedPath(missingNonTmp)).toBe(false);

    const [classification] = classifyRegistryEntries([
      { path: missingNonTmp, name: 'gone', addedAt: 0, lastScan: null, scanCount: 0 },
    ]);
    expect(classification!.tmpRooted).toBe(false);
    expect(classification!.missing).toBe(true);
    expect(classification!.prunable).toBe(false);
  });

  it('is false for a real project whose NAME merely contains the substring "tmp"', () => {
    // A directory-boundary prefix match against the REAL tmp roots, never a
    // substring match against the path text — /repos/my-tmp-tool is not
    // rooted under any tmp directory no matter what it's named.
    expect(isTmpRootedPath('/repos/my-tmp-tool')).toBe(false);
  });
});

// =============================================================================
// 4. JOURNAL GROWTH MATH
// =============================================================================

describe('computeHealth — journal growth math', () => {
  it('computes registersPerDay over the retained window and always reports estimated: true', async () => {
    const dir = defaultRegistryDir();
    fs.mkdirSync(dir, { recursive: true });
    const journalFile = journalPathForDir(dir);

    const now = Date.now();
    const twoDaysAgo = now - 2 * 86_400_000;
    const oneDayAgo = now - 1 * 86_400_000;

    const lines = [
      { ts: twoDaysAgo, actor: 'cli', pid: 1, op: 'register', rev: 1, entries: 1, delta: 1 },
      { ts: oneDayAgo, actor: 'cli', pid: 1, op: 'register', rev: 2, entries: 2, delta: 1 },
      { ts: now, actor: 'cli', pid: 1, op: 'register', rev: 3, entries: 3, delta: 1 },
    ]
      .map((r) => JSON.stringify(r))
      .join('\n');
    fs.writeFileSync(journalFile, lines + '\n');

    const report = await computeHealth();

    expect(report.journal.estimated).toBe(true);
    // Window is ~2 days (computeHealth's own `doctor` load record lands a
    // moment after `now`, nudging the window very slightly wider).
    expect(report.journal.windowDays).toBeGreaterThan(1.9);
    expect(report.journal.windowDays).toBeLessThan(2.2);
    expect(report.journal.registersInWindow).toBe(3);
    expect(report.journal.registersPerDay).toBeGreaterThan(1.3);
    expect(report.journal.registersPerDay).toBeLessThan(1.6);
  });

  it('reports zero rather than dividing by zero when the journal has no data yet', async () => {
    const report = await computeHealth();
    // The `doctor` load record itself is the only journal entry at this
    // point, so there is no `register` op and no elapsed window to speak of
    // in terms of registrations.
    expect(report.journal.registersInWindow).toBe(0);
    expect(report.journal.registersPerDay).toBe(0);
    expect(report.journal.estimated).toBe(true);
  });

  it('refuses to extrapolate a daily rate from a sub-day window', async () => {
    // REGRESSION. Measured on the real registry before the guard existed: a
    // 0.10-day window holding 323 `register` records reported
    // "3222.9 new entries/day" and raised a `warn`, flipping a registry with
    // 2 entries and nothing prunable to verdict: attention.
    //
    // A noisy gate is worse than no gate — a user shown an alarming number on
    // a clean registry learns to ignore the verdict, which disarms the
    // findings that are real. The honest answer for a short window is "not
    // enough history", not a large number.
    const dir = defaultRegistryDir();
    fs.mkdirSync(dir, { recursive: true });

    const now = Date.now();
    const twoHoursAgo = now - 2 * 3_600_000;
    const lines = Array.from({ length: 60 }, (_, i) =>
      JSON.stringify({
        ts: twoHoursAgo + i * 60_000,
        actor: 'cli',
        pid: 1,
        op: 'register',
        rev: i + 1,
        entries: i + 1,
        delta: 1,
      })
    ).join('\n');
    fs.writeFileSync(journalPathForDir(dir), lines + '\n');

    const report = await computeHealth();

    expect(report.journal.windowDays).toBeLessThan(1);
    expect(report.journal.registersInWindow).toBe(60);
    expect(report.journal.insufficientWindow).toBe(true);
    // Naive math here would be 60 / ~0.083 = ~720/day.
    expect(report.journal.registersPerDay).toBe(0);
    expect(report.findings.map((f) => f.code)).not.toContain('registry-growth');
  });

  it('does estimate once the window is long enough to support it', async () => {
    const dir = defaultRegistryDir();
    fs.mkdirSync(dir, { recursive: true });

    const now = Date.now();
    const tenDaysAgo = now - 10 * 86_400_000;
    const lines = Array.from({ length: 100 }, (_, i) =>
      JSON.stringify({
        ts: tenDaysAgo + i * (10 * 86_400_000 / 99),
        actor: 'cli',
        pid: 1,
        op: 'register',
        rev: i + 1,
        entries: i + 1,
        delta: 1,
      })
    ).join('\n');
    fs.writeFileSync(journalPathForDir(dir), lines + '\n');

    const report = await computeHealth();

    expect(report.journal.insufficientWindow).toBe(false);
    expect(report.journal.registersPerDay).toBeGreaterThan(5);
    expect(report.findings.map((f) => f.code)).toContain('registry-growth');
  });
});

// =============================================================================
// 5 & 6. --fix END-TO-END, PLUS THE G3 JOURNALED/LOCKED PROOF
// =============================================================================

describe('fixRegistry — end to end', () => {
  it('backs up, prunes only the prunable set, and removes the matching memory records', async () => {
    const realPath = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-doctor-fix-real-'));
    const missingPath = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-doctor-fix-missing-'));
    try {
      await registerProject(realPath, { components: 1, connections: 1, prompts: 0 });
      await registerProject(missingPath, { components: 1, connections: 1, prompts: 0 });
      await recordMemoryEvent({
        projectPath: missingPath,
        kind: 'project.registered',
        summary: 'Registered (about to be pruned)',
      });
      fs.rmSync(missingPath, { recursive: true, force: true });

      const outcome = await fixRegistry({ yes: true });

      expect(outcome.status).toBe('cleaned');
      expect(outcome.cleanup).toBeDefined();
      expect(outcome.cleanup!.removedFromRegistry).toBe(1);
      expect(outcome.cleanup!.removedFromMemory).toBe(1);

      // Backup exists AND parses. Non-null assertion is safe here: status
      // 'cleaned' always carries a real backup path (only 'nothing-to-clean'
      // reports null — see FixCleanupResult's header).
      const backupPath = outcome.cleanup!.backupPath!;
      expect(fs.existsSync(backupPath)).toBe(true);
      const backupContent = JSON.parse(fs.readFileSync(backupPath, 'utf-8'));
      expect(Array.isArray(backupContent.projects)).toBe(true);

      // Only the prunable entry is gone; the real one survives.
      const registry = await loadRegistry();
      const paths = registry.projects.map((p) => p.path);
      expect(paths).toContain(realPath);
      expect(paths).not.toContain(missingPath);

      // Memory record for the pruned path is gone.
      expect(readProjectMemory(missingPath)).toBeNull();
    } finally {
      fs.rmSync(realPath, { recursive: true, force: true });
    }
  });

  it('G3 — the journal shows a `remove` record with locked: true, proving mutateRegistry (not a raw write) ran', async () => {
    const missingPath = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-doctor-g3-missing-'));
    await registerProject(missingPath, { components: 1, connections: 1, prompts: 0 });
    fs.rmSync(missingPath, { recursive: true, force: true });

    const outcome = await fixRegistry({ yes: true });
    expect(outcome.status).toBe('cleaned');

    const records = readJournal({ limit: 10_000 });
    const removeRecord = records.find((r) => r.op === 'remove' && r.locked === true);
    expect(removeRecord).toBeDefined();
  });

  it('does nothing, writes no backup, and makes no mutation when nothing is prunable', async () => {
    const realPath = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-doctor-nothing-real-'));
    try {
      await registerProject(realPath, { components: 1, connections: 1, prompts: 0 });
      const before = await loadRegistry();

      const outcome = await fixRegistry({ yes: true });

      expect(outcome.status).toBe('nothing-to-clean');
      // f6: nothing-to-clean now ALWAYS carries a `cleanup` object with
      // explicit zero counts and a null backup path — an ABSENT `cleanup`
      // is what made the dashboard misdiagnose a healthy registry as a
      // broken CLI build (see web/app/api/registry-health/route.ts:135-143).
      expect(outcome.cleanup).toEqual({
        removedFromRegistry: 0,
        removedFromMemory: 0,
        backupPath: null,
      });

      const registryDir = defaultRegistryDir();
      const backups = fs
        .readdirSync(registryDir)
        .filter((f) => f.startsWith('projects.json.backup-'));
      expect(backups).toHaveLength(0);

      const after = await loadRegistry();
      expect(after.projects.length).toBe(before.projects.length);
    } finally {
      fs.rmSync(realPath, { recursive: true, force: true });
    }
  });
});

// =============================================================================
// 7. f1 — ORPHANED MEMORY RECORDS (no registry entry at all, not just a
//    missing/tmp-rooted one) MUST be reachable and removable by `--fix`.
//
// Reproduces the dashboard delete path: `web/lib/server/registry-store.ts` is
// a separate compilation unit that writes `projects.json` directly and
// cannot import the memory store, so it can never emit a `project.removed`
// event. These tests write `projects.json` directly for the same reason —
// simulating exactly that bypass, not exercising `pruneProjects` (which
// remains the only registry-mutation path `fixRegistry` itself is allowed to
// use).
// =============================================================================

describe('fixRegistry — orphaned memory records (f1)', () => {
  it('closes f1: an orphan is reported, --fix removes it, and the record is gone', async () => {
    const keptPath = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-doctor-orphan-kept-'));
    const droppedPath = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-doctor-orphan-dropped-'));
    try {
      await registerProject(keptPath, { components: 1, connections: 1, prompts: 0 });
      await registerProject(droppedPath, { components: 1, connections: 1, prompts: 0 });

      // Simulate the dashboard's delete path: drop one entry from
      // projects.json directly, leaving its gator-memory record behind with
      // no registry entry to shadow it — the definition of an orphan.
      const registryPath = path.join(defaultRegistryDir(), 'projects.json');
      const raw = JSON.parse(fs.readFileSync(registryPath, 'utf-8'));
      raw.projects = raw.projects.filter((p: { path: string }) => p.path !== droppedPath);
      fs.writeFileSync(registryPath, JSON.stringify(raw, null, 2));

      const before = await computeHealth();
      expect(before.memory.orphaned).toBe(1);
      expect(before.findings.some((f) => f.code === 'memory-orphaned')).toBe(true);

      const outcome = await fixRegistry({ yes: true });
      expect(outcome.status).toBe('cleaned');
      expect(outcome.cleanup!.removedFromMemory).toBe(1);
      // Nothing was prunable from the registry side — the dropped path was
      // never a registry entry by the time --fix ran, only its orphaned
      // memory record was.
      expect(outcome.cleanup!.removedFromRegistry).toBe(0);

      const after = await computeHealth();
      expect(after.memory.orphaned).toBe(0);
      expect(readProjectMemory(droppedPath)).toBeNull();

      // The surviving project's registry entry and memory record are
      // untouched.
      const registry = await loadRegistry();
      expect(registry.projects.map((p) => p.path)).toContain(keptPath);
      expect(readProjectMemory(keptPath)).not.toBeNull();
    } finally {
      fs.rmSync(keptPath, { recursive: true, force: true });
      fs.rmSync(droppedPath, { recursive: true, force: true });
    }
  });

  it('backs up an orphan record before deleting it', async () => {
    const droppedPath = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-doctor-orphan-backup-'));
    try {
      await registerProject(droppedPath, { components: 1, connections: 1, prompts: 0 });

      const registryPath = path.join(defaultRegistryDir(), 'projects.json');
      const raw = JSON.parse(fs.readFileSync(registryPath, 'utf-8'));
      raw.projects = raw.projects.filter((p: { path: string }) => p.path !== droppedPath);
      fs.writeFileSync(registryPath, JSON.stringify(raw, null, 2));

      const outcome = await fixRegistry({ yes: true });
      expect(outcome.status).toBe('cleaned');
      expect(outcome.cleanup!.backupPath).not.toBeNull();

      const memoryBackupDir = `${outcome.cleanup!.backupPath}.memory`;
      expect(fs.existsSync(memoryBackupDir)).toBe(true);
      const backedUpFiles = fs.readdirSync(memoryBackupDir);
      expect(backedUpFiles.length).toBe(1);

      const parsed = JSON.parse(fs.readFileSync(path.join(memoryBackupDir, backedUpFiles[0]!), 'utf-8'));
      expect(parsed.path).toBe(droppedPath);
    } finally {
      fs.rmSync(droppedPath, { recursive: true, force: true });
    }
  });

  it('is NOT nothing-to-clean when the registry has nothing prunable but one orphan exists', async () => {
    const keptPath = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-doctor-orphan-onlyorphan-'));
    const droppedPath = fs.mkdtempSync(
      path.join(os.tmpdir(), 'navgator-doctor-orphan-onlyorphan-dropped-')
    );
    try {
      await registerProject(keptPath, { components: 1, connections: 1, prompts: 0 });
      await registerProject(droppedPath, { components: 1, connections: 1, prompts: 0 });

      const registryPath = path.join(defaultRegistryDir(), 'projects.json');
      const raw = JSON.parse(fs.readFileSync(registryPath, 'utf-8'));
      raw.projects = raw.projects.filter((p: { path: string }) => p.path !== droppedPath);
      fs.writeFileSync(registryPath, JSON.stringify(raw, null, 2));

      // Nothing tmp-rooted-and-missing in the surviving registry — the only
      // thing `--fix` has to do here is the orphan.
      const registry = await loadRegistry();
      const classifications = classifyRegistryEntries(registry.projects);
      expect(selectPrunableEntries(classifications)).toHaveLength(0);

      const outcome = await fixRegistry({ yes: true });
      expect(outcome.status).toBe('cleaned');
      expect(outcome.cleanup!.removedFromRegistry).toBe(0);
      expect(outcome.cleanup!.removedFromMemory).toBe(1);
    } finally {
      fs.rmSync(keptPath, { recursive: true, force: true });
      fs.rmSync(droppedPath, { recursive: true, force: true });
    }
  });

  it('IS nothing-to-clean, with a zero-count cleanup object, when there is nothing prunable and no orphans (f6)', async () => {
    const realPath = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-doctor-orphan-clean-'));
    try {
      await registerProject(realPath, { components: 1, connections: 1, prompts: 0 });

      const outcome = await fixRegistry({ yes: true });

      expect(outcome.status).toBe('nothing-to-clean');
      // f6 closure: the zero-count `cleanup` object must be present (not
      // omitted) so a JSON/agent caller can distinguish "ran, found nothing"
      // from "didn't run" / "build broken".
      expect(outcome.cleanup).toEqual({
        removedFromRegistry: 0,
        removedFromMemory: 0,
        backupPath: null,
      });
    } finally {
      fs.rmSync(realPath, { recursive: true, force: true });
    }
  });
});

// =============================================================================
// 8. SCHEMA CONTRACT — must not drift from web/lib/types.ts's RegistryHealthReport
// =============================================================================

describe('computeHealth — schema contract', () => {
  it('emits schema_version 1.0.0 and every top-level key the dashboard expects', async () => {
    const report = await computeHealth();

    expect(report.schema_version).toBe('1.0.0');

    for (const key of ['schema_version', 'registry', 'journal', 'memory', 'mirror', 'findings', 'verdict']) {
      expect(Object.prototype.hasOwnProperty.call(report, key)).toBe(true);
    }
    for (const key of ['path', 'entries', 'revision', 'bytes', 'tmpRooted', 'missing', 'prunable']) {
      expect(Object.prototype.hasOwnProperty.call(report.registry, key)).toBe(true);
    }
    for (const key of [
      'records',
      'windowDays',
      'registersInWindow',
      'registersPerDay',
      'estimated',
      'conflicts',
      'degradedWrites',
    ]) {
      expect(Object.prototype.hasOwnProperty.call(report.journal, key)).toBe(true);
    }
    for (const key of ['exists', 'projects', 'orphaned', 'events', 'bytes', 'lastEventAt']) {
      expect(Object.prototype.hasOwnProperty.call(report.memory, key)).toBe(true);
    }
    for (const key of ['enabled', 'target', 'targetExists']) {
      expect(Object.prototype.hasOwnProperty.call(report.mirror, key)).toBe(true);
    }
  });
});

// =============================================================================
// 9. --mirror WITH THE MIRROR DISABLED
// =============================================================================

describe('describeMirrorRun', () => {
  it('reports the disabled state with a reason, rather than a zero count that looks like it tried', async () => {
    const result = await describeMirrorRun();
    expect(result.ran).toBe(false);
    expect(result.mirrored).toBe(0);
    expect(result.skipped).toBe(0);
    expect(typeof result.reason).toBe('string');
    expect(result.reason).toMatch(/disabled/i);
  });
});
