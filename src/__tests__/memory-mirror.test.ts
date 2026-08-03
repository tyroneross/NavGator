/**
 * gator-memory -> build-loop-memory mirror — `src/memory/mirror.ts`.
 *
 * Redirects `$HOME` to a fresh `mkdtemp` per test (in addition to the
 * suite-wide per-FILE redirect in `src/__tests__/setup/home-redirect.ts`),
 * and points `NAVGATOR_MEMORY_MIRROR_TARGET` at a SECOND, independent
 * `mkdtemp` directory standing in for a fake build-loop-memory tree. Every
 * env var this module reads is saved and restored with the undefined guard,
 * per the project convention (`memory-store.test.ts` is the canonical
 * example of getting this right for the sibling gator-memory module).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { mirrorStatus, mirrorProjectMemory, mirrorAll } from '../memory/mirror.js';
import { recordMemoryEvent } from '../memory/store.js';
import { resetHomeConfigCache } from '../home-config.js';

let homeDir: string;
let targetDir: string;
let prevHome: string | undefined;
let prevMirrorEnv: string | undefined;
let prevMirrorTargetEnv: string | undefined;

beforeEach(() => {
  homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-mirror-home-'));
  targetDir = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-mirror-target-'));

  prevHome = process.env.HOME;
  process.env.HOME = homeDir;

  prevMirrorEnv = process.env.NAVGATOR_MEMORY_MIRROR;
  prevMirrorTargetEnv = process.env.NAVGATOR_MEMORY_MIRROR_TARGET;
  delete process.env.NAVGATOR_MEMORY_MIRROR;
  process.env.NAVGATOR_MEMORY_MIRROR_TARGET = targetDir;

  resetHomeConfigCache();
});

afterEach(() => {
  if (prevHome === undefined) delete process.env.HOME;
  else process.env.HOME = prevHome;

  if (prevMirrorEnv === undefined) delete process.env.NAVGATOR_MEMORY_MIRROR;
  else process.env.NAVGATOR_MEMORY_MIRROR = prevMirrorEnv;

  if (prevMirrorTargetEnv === undefined) delete process.env.NAVGATOR_MEMORY_MIRROR_TARGET;
  else process.env.NAVGATOR_MEMORY_MIRROR_TARGET = prevMirrorTargetEnv;

  resetHomeConfigCache();
  fs.rmSync(homeDir, { recursive: true, force: true });
  fs.rmSync(targetDir, { recursive: true, force: true });
});

function enableMirror(target = targetDir): void {
  process.env.NAVGATOR_MEMORY_MIRROR = '1';
  process.env.NAVGATOR_MEMORY_MIRROR_TARGET = target;
  resetHomeConfigCache();
}

function projectDirsUnder(target: string): string[] {
  try {
    return fs.readdirSync(path.join(target, 'projects'));
  } catch {
    return [];
  }
}

function mirrorJsonPath(target: string, slug: string): string {
  return path.join(target, 'projects', slug, 'architecture', 'navgator-memory.json');
}

function mirrorMdPath(target: string, slug: string): string {
  return path.join(target, 'projects', slug, 'architecture', 'navgator-memory.md');
}

// =============================================================================
// 1. OFF (default) — the gate is `enabled`, not target presence
// =============================================================================

describe('mirroring OFF (default)', () => {
  it('writes nothing even when the target exists, and mirrorStatus reports disabled', async () => {
    const projectPath = path.join(homeDir, 'projects', 'off-project');
    await recordMemoryEvent({ projectPath, kind: 'project.registered', summary: 'Registered' });

    // Prove the target dir is untouched EVEN THOUGH IT EXISTS -- the gate
    // must be the `enabled` flag, not merely target presence.
    expect(fs.existsSync(targetDir)).toBe(true);

    const result = await mirrorProjectMemory(projectPath);
    expect(result).toBe(false);
    expect(fs.readdirSync(targetDir)).toEqual([]);

    const status = mirrorStatus();
    expect(status.enabled).toBe(false);
  });
});

// =============================================================================
// 2. ON, target exists — writes both files, status reports correctly
// =============================================================================

describe('mirroring ON, target exists', () => {
  it('writes both files, JSON round-trips, markdown frontmatter carries source_path', async () => {
    enableMirror();
    const projectPath = path.join(homeDir, 'projects', 'on-project');
    await recordMemoryEvent({ projectPath, kind: 'project.registered', summary: 'Registered' });
    await recordMemoryEvent({
      projectPath,
      kind: 'architecture.changed',
      summary: 'Added a queue consumer',
      detail: { significance: 'major', componentsAdded: 4, connectionsRemoved: 1 },
    });

    const ok = await mirrorProjectMemory(projectPath);
    expect(ok).toBe(true);

    const dirs = projectDirsUnder(targetDir);
    expect(dirs).toHaveLength(1);
    const slug = dirs[0]!;
    expect(slug.startsWith('on-project')).toBe(true);

    const jsonPath = mirrorJsonPath(targetDir, slug);
    const mdPath = mirrorMdPath(targetDir, slug);
    expect(fs.existsSync(jsonPath)).toBe(true);
    expect(fs.existsSync(mdPath)).toBe(true);

    const parsed = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
    expect(parsed.source_path).toBe(path.resolve(projectPath));
    expect(parsed.name).toBe('on-project');
    expect(parsed.source_tool).toBe('navgator');
    expect(typeof parsed.source_version).toBe('string');

    const md = fs.readFileSync(mdPath, 'utf-8');
    expect(md).toContain(`source_path: ${path.resolve(projectPath)}`);
    expect(md).toContain('architecture.changed');

    const status = mirrorStatus();
    expect(status.targetExists).toBe(true);
    expect(status.lastMirroredAt).not.toBeNull();
    expect(status.projectsMirrored).toBe(1);
  });
});

// =============================================================================
// 3. ON, target absent — never conjured, no throw
// =============================================================================

describe('mirroring ON, target absent', () => {
  it('returns false, creates nothing, and mirrorStatus reports targetExists:false', async () => {
    const ghostTarget = path.join(targetDir, 'does-not-exist-yet');
    enableMirror(ghostTarget);

    const projectPath = path.join(homeDir, 'projects', 'ghost-project');
    await recordMemoryEvent({ projectPath, kind: 'project.registered', summary: 'Registered' });

    const ok = await mirrorProjectMemory(projectPath);
    expect(ok).toBe(false);
    // The target root must never be conjured -- its absence is the signal.
    expect(fs.existsSync(ghostTarget)).toBe(false);

    const status = mirrorStatus();
    expect(status.enabled).toBe(true);
    expect(status.targetExists).toBe(false);
  });
});

// =============================================================================
// 4. Collision — two different paths, same basename
// =============================================================================

describe('collision handling', () => {
  it('keeps both records at distinct paths when basenames match but paths differ', async () => {
    enableMirror();
    const projectA = path.join(homeDir, 'a', 'web');
    const projectB = path.join(homeDir, 'b', 'web');

    await recordMemoryEvent({ projectPath: projectA, kind: 'project.registered', summary: 'A' });
    await recordMemoryEvent({ projectPath: projectB, kind: 'project.registered', summary: 'B' });

    expect(await mirrorProjectMemory(projectA)).toBe(true);
    expect(await mirrorProjectMemory(projectB)).toBe(true);

    const dirs = projectDirsUnder(targetDir);
    expect(dirs).toHaveLength(2);

    const sourcePaths = dirs.map((d) => {
      const parsed = JSON.parse(fs.readFileSync(mirrorJsonPath(targetDir, d), 'utf-8'));
      return parsed.source_path as string;
    });

    expect(sourcePaths.sort()).toEqual([path.resolve(projectA), path.resolve(projectB)].sort());
  });
});

// =============================================================================
// 5. Idempotence — mirroring twice produces the same file set, no duplication
// =============================================================================

describe('idempotence', () => {
  it('produces the same file set and no duplicated milestone lines on a second mirror', async () => {
    enableMirror();
    const projectPath = path.join(homeDir, 'projects', 'idempotent-project');
    await recordMemoryEvent({ projectPath, kind: 'project.registered', summary: 'Registered' });
    await recordMemoryEvent({ projectPath, kind: 'project.scanned', summary: 'Scan 1' });

    expect(await mirrorProjectMemory(projectPath)).toBe(true);
    const dirsAfterFirst = projectDirsUnder(targetDir);
    const slug = dirsAfterFirst[0]!;
    const mdAfterFirst = fs.readFileSync(mirrorMdPath(targetDir, slug), 'utf-8');

    expect(await mirrorProjectMemory(projectPath)).toBe(true);
    const dirsAfterSecond = projectDirsUnder(targetDir);
    const mdAfterSecond = fs.readFileSync(mirrorMdPath(targetDir, slug), 'utf-8');

    expect(dirsAfterSecond).toEqual(dirsAfterFirst);
    expect(mdAfterSecond).toBe(mdAfterFirst);
    // No duplication: "Scan 1" milestone line appears exactly once.
    expect(mdAfterSecond.split('Scan 1')).toHaveLength(2);
  });
});

// =============================================================================
// 6. Guest discipline — never touches build-loop's own tooling files
// =============================================================================

describe('guest discipline', () => {
  it('leaves a pre-existing snapshot.json and INDEX.jsonl byte-identical', async () => {
    enableMirror();
    const snapshotPath = path.join(targetDir, 'snapshot.json');
    const indexPath = path.join(targetDir, 'INDEX.jsonl');
    const snapshotContent = JSON.stringify({ provenance: 'navgator', components: [] });
    const indexContent = '{"kind":"entry-1"}\n{"kind":"entry-2"}\n';

    fs.writeFileSync(snapshotPath, snapshotContent);
    fs.writeFileSync(indexPath, indexContent);

    const projectPath = path.join(homeDir, 'projects', 'guest-project');
    await recordMemoryEvent({ projectPath, kind: 'project.registered', summary: 'Registered' });
    expect(await mirrorProjectMemory(projectPath)).toBe(true);

    expect(fs.readFileSync(snapshotPath, 'utf-8')).toBe(snapshotContent);
    expect(fs.readFileSync(indexPath, 'utf-8')).toBe(indexContent);
  });
});

// =============================================================================
// 7. Fail-open on unwritable destination
// =============================================================================

describe('unwritable destination', () => {
  it('returns false and does not throw when projects/ is unwritable', async () => {
    if (process.platform === 'win32') return; // chmod semantics differ

    enableMirror();
    const projectsDir = path.join(targetDir, 'projects');
    fs.mkdirSync(projectsDir, { recursive: true });
    fs.chmodSync(projectsDir, 0o500);

    try {
      const projectPath = path.join(homeDir, 'projects', 'blocked-project');
      await recordMemoryEvent({ projectPath, kind: 'project.registered', summary: 'Registered' });

      await expect(mirrorProjectMemory(projectPath)).resolves.toBe(false);
    } finally {
      fs.chmodSync(projectsDir, 0o700);
    }
  });
});

// =============================================================================
// 8. No memory record — mirroring an unrecorded project
// =============================================================================

describe('no gator-memory record', () => {
  it('returns false without creating an empty mirror file', async () => {
    enableMirror();
    const projectPath = path.join(homeDir, 'projects', 'never-recorded');

    const ok = await mirrorProjectMemory(projectPath);
    expect(ok).toBe(false);
    expect(projectDirsUnder(targetDir)).toEqual([]);
  });
});

// =============================================================================
// 9. mirrorAll — accurate mirrored/skipped counts
// =============================================================================

describe('mirrorAll', () => {
  it('mirrors every recorded project when enabled', async () => {
    enableMirror();
    const paths = ['p1', 'p2', 'p3'].map((name) => path.join(homeDir, 'projects', name));
    for (const p of paths) {
      await recordMemoryEvent({ projectPath: p, kind: 'project.registered', summary: 'Registered' });
    }

    const result = await mirrorAll();
    expect(result).toEqual({ mirrored: 3, skipped: 0 });
    expect(projectDirsUnder(targetDir)).toHaveLength(3);
  });

  it('reports every project skipped when mirroring is disabled', async () => {
    // enabled stays false (default) -- mirrorProjectMemory returns false for
    // every record without touching the target at all.
    const paths = ['q1', 'q2'].map((name) => path.join(homeDir, 'projects', name));
    for (const p of paths) {
      await recordMemoryEvent({ projectPath: p, kind: 'project.registered', summary: 'Registered' });
    }

    const result = await mirrorAll();
    expect(result).toEqual({ mirrored: 0, skipped: 2 });
    expect(fs.readdirSync(targetDir)).toEqual([]);
  });
});

// =============================================================================
// SECURITY POSTURE
// =============================================================================

describe('mirror preserves the owner-only posture of the data it exports', () => {
  it('writes 0700 dirs and 0600 files into the target', async () => {
    // REGRESSION (security review 2026-08-03, SEC-003). The mirror exports the
    // SAME content the store keeps at 0700/0600 — every project path on the
    // machine, with dates and a change chronology. Writing it at the default
    // umask (0755/0644) on the way out would silently retire that decision and
    // let any other local user enumerate the inventory.
    if (process.platform === 'win32') return;

    enableMirror();
    await recordMemoryEvent({
      projectPath: '/repos/mode-check',
      kind: 'project.registered',
      summary: 'registered',
    });
    expect(await mirrorProjectMemory('/repos/mode-check')).toBe(true);

    const archDir = path.join(targetDir, 'projects', 'mode-check', 'architecture');
    expect(fs.statSync(archDir).mode & 0o777).toBe(0o700);
    expect(fs.statSync(path.join(archDir, 'navgator-memory.json')).mode & 0o777).toBe(0o600);
    expect(fs.statSync(path.join(archDir, 'navgator-memory.md')).mode & 0o777).toBe(0o600);
  });

  it('strips control characters from the project path it renders into markdown', async () => {
    // REGRESSION (SEC-004). The mirrored markdown is read by OTHER agents as
    // reference material, so filesystem-controlled text reaching it verbatim
    // is a trust-boundary crossing, not just a cosmetic issue.
    enableMirror();
    const hostile = '/repos/inj' + String.fromCharCode(27) + '[31m' + 'ected';
    await recordMemoryEvent({
      projectPath: hostile,
      kind: 'project.registered',
      summary: 'registered',
    });
    await mirrorProjectMemory(hostile);

    const files = fs
      .readdirSync(path.join(targetDir, 'projects'))
      .map((d) => path.join(targetDir, 'projects', d, 'architecture', 'navgator-memory.md'))
      .filter((f) => fs.existsSync(f));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      expect(fs.readFileSync(f, 'utf-8')).not.toContain(String.fromCharCode(27));
    }
  });
});
