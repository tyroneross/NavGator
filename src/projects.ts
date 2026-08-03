/**
 * NavGator Project Registry
 * Manages ~/.navgator/projects.json with enhanced per-project context
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DiffSignificance, GitInfo } from './types.js';
import { atomicWriteJSON } from './storage.js';
import {
  appendJournalEvent,
  registryDigest,
  type JournalOp,
} from './registry-journal.js';
import { withRegistryFileLock } from './registry-lock.js';

// =============================================================================
// TYPES
// =============================================================================

export interface ProjectEntry {
  path: string;
  name: string;
  addedAt: number;
  lastScan: number | null;
  scanCount: number;
  stats?: {
    components: number;
    connections: number;
    prompts: number;
  };
  lastSignificantChange?: number;
  lastSignificance?: DiffSignificance;
  git?: { branch: string; commit: string };
  /**
   * Where this project's code lives. 'local' is the default for anything
   * scanned from a path already on disk; 'remote' marks a repo cloned by
   * the remote-scan chunk (C7), which also carries `url` and `cachePath`.
   * Optional and additive — registry `version` stays 2 (docs/plans/
   * 2026-08-03-portfolio-remote-gitaware.md, C6).
   */
  origin?: { kind: 'local' | 'remote'; url?: string; cachePath?: string };
  /** Set when this project was discovered/scanned as part of a portfolio sweep. */
  portfolio?: { root: string };
}

export interface ProjectRegistry {
  version: number;
  /**
   * Monotonic write counter, bumped once per successful save.
   *
   * A writer that loads revision N and finds revision M != N on disk when it
   * goes to save has detected that someone else committed underneath it — a
   * lost-update race. See `mutateRegistry`.
   *
   * Optional and additive: `version` stays 2, and a v2 file written before this
   * field existed loads as revision 0. That keeps a registry written by a new
   * CLI readable by an older dashboard build and vice versa.
   */
  revision?: number;
  projects: ProjectEntry[];
}

// =============================================================================
// REGISTRY I/O
// =============================================================================

function getRegistryDir(): string {
  return path.join(os.homedir(), '.navgator');
}

function getRegistryPath(): string {
  return path.join(getRegistryDir(), 'projects.json');
}

/**
 * Load the project registry with v1→v2 auto-migration.
 *
 * Every call journals a `load` record. The registry has readers in two
 * compilation units and no other record of access, so "who read this, when"
 * was previously unanswerable.
 */
export async function loadRegistry(note?: string): Promise<ProjectRegistry> {
  const registryPath = getRegistryPath();
  let registry: ProjectRegistry;

  try {
    const content = await fs.promises.readFile(registryPath, 'utf-8');
    const raw = JSON.parse(content) as ProjectRegistry;

    // v1→v2 migration: add missing fields
    if (raw.version === 1) {
      raw.version = 2;
      for (const p of raw.projects) {
        if (p.scanCount === undefined) p.scanCount = p.lastScan ? 1 : 0;
      }
    }

    // A v2 file written before `revision` existed reads as revision 0. This is
    // the whole backward-compatibility story: no migration write, no version
    // bump, and the first CAS write after upgrade simply stamps revision 1.
    if (typeof raw.revision !== 'number' || !Number.isFinite(raw.revision)) {
      raw.revision = 0;
    }
    if (!Array.isArray(raw.projects)) raw.projects = [];

    registry = raw;
  } catch {
    registry = { version: 2, revision: 0, projects: [] };
  }

  await appendJournalEvent(getRegistryDir(), {
    op: 'load',
    rev: registry.revision ?? 0,
    entries: registry.projects.length,
    note,
  });

  return registry;
}

/**
 * Save the project registry.
 *
 * Uses `atomicWriteJSON` (write-to-temp + rename) so a reader never observes
 * a partially-written file. This does NOT by itself prevent the
 * read-modify-write race between concurrent callers — see `mutateRegistry`
 * below, which serializes the load-mutate-save body in-process and detects the
 * cross-process case by comparing revisions.
 *
 * Callers that go through `mutateRegistry` get their revision stamped for them.
 * A direct call here bumps the revision too, so no write can leave the counter
 * standing still and make a real conflict look like agreement.
 *
 * UNSAFE for concurrent use. This takes NEITHER mutex and performs NO
 * compare-and-swap — it overwrites whatever is on disk. It exists for callers
 * that already hold the whole registry and genuinely mean to replace it. Every
 * production writer must go through `registerProject`, `updateProjectMeta`, or
 * `removeProject`, which route through `mutateRegistry`.
 */
export async function saveRegistry(registry: ProjectRegistry): Promise<void> {
  await writeRegistry(registry, 'save');
}

/** Shared write tail: stamp the revision, write atomically, journal the result. */
async function writeRegistry(
  registry: ProjectRegistry,
  op: JournalOp,
  options: {
    entriesBefore?: number;
    note?: string;
    stamped?: boolean;
    /** Whether the cross-process file lock was held. Recorded on the write. */
    locked?: boolean;
  } = {}
): Promise<void> {
  if (!options.stamped) {
    registry.revision = (registry.revision ?? 0) + 1;
  }

  await atomicWriteJSON(getRegistryPath(), registry);

  await appendJournalEvent(getRegistryDir(), {
    op,
    rev: registry.revision ?? 0,
    entries: registry.projects.length,
    delta:
      options.entriesBefore === undefined
        ? undefined
        : registry.projects.length - options.entriesBefore,
    digest: registryDigest(registry),
    locked: options.locked,
    note: options.note,
  });
}

/**
 * Read only the revision currently on disk, for the compare-and-swap check.
 *
 * Journaled as a `load` (it is a real read of the file) tagged `cas-check` so
 * the journal distinguishes a caller reading the registry from a writer
 * verifying its base.
 */
async function readDiskRevision(): Promise<number> {
  let revision = 0;
  let entries = 0;
  try {
    const content = await fs.promises.readFile(getRegistryPath(), 'utf-8');
    const raw = JSON.parse(content) as ProjectRegistry;
    revision = typeof raw.revision === 'number' && Number.isFinite(raw.revision) ? raw.revision : 0;
    entries = Array.isArray(raw.projects) ? raw.projects.length : 0;
  } catch {
    // Missing or unparseable reads as revision 0 — the same pre-image
    // loadRegistry would have produced, so base and disk still agree.
  }

  await appendJournalEvent(getRegistryDir(), {
    op: 'load',
    rev: revision,
    entries,
    note: 'cas-check',
  });

  return revision;
}

// =============================================================================
// CONCURRENCY
// =============================================================================

/**
 * In-process mutex for registry read-modify-write sections.
 *
 * `scanPortfolio` runs N concurrent workers in a single process
 * (src/portfolio/scan.ts), each of which calls `registerProject` via
 * `scan()`. Without serialization, two workers finishing close together
 * both `loadRegistry()` the same pre-image, mutate their own in-memory copy,
 * and `saveRegistry()` — the last writer wins and the other worker's
 * registration is silently lost (measured: 6 workers registered only 2 of 6
 * entries at concurrency 4). Chaining every load-mutate-save body onto a
 * single promise queue makes them run one at a time, so each sees the
 * previous writer's result.
 *
 * This is an in-process mutex ONLY. Cross-process contention (two `navgator`
 * invocations, or a CLI scan against the dashboard) is handled one layer out by
 * `withRegistryFileLock`; see `mutateRegistry` for how the two compose. This
 * mutex remains load-bearing because the file lock fails open, and when it does
 * this is what still keeps same-process writers correct.
 */
let registryLock: Promise<unknown> = Promise.resolve();

function withRegistryLock<T>(fn: () => Promise<T>): Promise<T> {
  const result = registryLock.then(fn, fn);
  // Swallow rejections in the chain itself so one failed writer doesn't
  // permanently wedge the queue for everyone after it; the real result
  // (including its rejection) is still returned to this call's caller.
  registryLock = result.catch(() => undefined);
  return result;
}

/**
 * What a mutation decided. `commit: false` means the mutation was a no-op
 * (e.g. adding a project that is already registered) and no write should
 * happen — which also means no revision bump and no spurious conflict for the
 * next writer.
 */
export interface MutationOutcome<T> {
  commit: boolean;
  value: T;
}

/**
 * How many times a writer will re-read and re-apply before giving up on
 * agreement and taking last-writer-wins on the merged result.
 */
const MAX_CAS_ATTEMPTS = 5;

/**
 * Serialize and version-stamp a registry read-modify-write.
 *
 * Three mechanisms, covering three different races. They are ordered outermost
 * to innermost, and each one exists because the next one out does not cover
 * its case:
 *
 * 1. **`withRegistryLock`** serializes the whole load-mutate-save body against
 *    other callers *in this process*. That is what stops `scanPortfolio`'s
 *    concurrent workers from clobbering each other. It does nothing for another
 *    process.
 *
 * 2. **`withRegistryFileLock`** serializes against writers in *other* processes
 *    — a second `navgator` invocation, or the dashboard route, which compiles
 *    separately and mirrors the same lock protocol. This is the mechanism that
 *    actually prevents cross-process loss.
 *
 *    It is load-bearing, not belt-and-braces: CAS alone cannot prevent this.
 *    Two writers starting in the same tick both read revision R before either
 *    saves, so both pass their own CAS check and both write R+1. One entry is
 *    lost and *neither writer sees a mismatch to report* — silent loss, exactly
 *    the failure this whole change exists to eliminate.
 *
 * 3. **Compare-and-swap on `revision`** is the detector of last resort, for
 *    anything that slips past the lock: a writer that could not acquire it
 *    within the budget and proceeded unlocked, a stale-lock steal, a
 *    filesystem that does not honour O_EXCL, or an older dashboard build that
 *    predates the lock entirely. On a mismatch we journal a `conflict`,
 *    re-read the winner's registry, and **re-apply the same mutation closure**
 *    to it.
 *
 * The closure is the reason (3) merges instead of clobbering. Replaying intent
 * against fresh state is idempotent for every mutation here — find-or-create,
 * field patch, filter-out — whereas replaying a captured *result* would drop
 * whatever the winner wrote. It also means derived values recompute correctly:
 * `scanCount + 1` increments once off the winner's count, not twice off a
 * stale one. A mutation that decides it has nothing to do returns
 * `commit: false`, which skips the write entirely rather than replaying a
 * duplicate insert.
 *
 * Honest limit: when the file lock cannot be acquired the write proceeds
 * unlocked, and POSIX offers no atomic compare-and-swap on a rename, so a
 * sub-millisecond window remains in that degraded path. It is recorded — the
 * write's journal note says the lock was not held — rather than hidden.
 */
async function mutateRegistry<T>(
  op: JournalOp,
  mutate: (registry: ProjectRegistry) => MutationOutcome<T>,
  note?: string
): Promise<T> {
  return withRegistryLock(() =>
    withRegistryFileLock(getRegistryDir(), async (lockHeld) => {
      let attempt = 0;

      // Bounded by MAX_CAS_ATTEMPTS: each `continue` increments, and the final
      // attempt skips the CAS check and commits unconditionally.
      for (;;) {
        const registry = await loadRegistry(note);
        const base = registry.revision ?? 0;
        const entriesBefore = registry.projects.length;

        const outcome = mutate(registry);
        if (!outcome.commit) return outcome.value;

        if (attempt < MAX_CAS_ATTEMPTS) {
          const diskRevision = await readDiskRevision();
          if (diskRevision !== base) {
            // A decrease means a writer that does not preserve `revision`
            // committed — an older dashboard build reconstructs the registry as
            // `{version, projects}` and drops the field. Worth naming separately
            // in the journal: it is a compatibility signal, not contention.
            const kind = diskRevision < base ? 'revision-regression' : 'concurrent-write';
            await appendJournalEvent(getRegistryDir(), {
              op: 'conflict',
              rev: diskRevision,
              entries: registry.projects.length,
              base,
              found: diskRevision,
              note: `${note ?? op}: ${kind}, replaying (attempt ${attempt + 1})`,
            });
            attempt++;
            continue;
          }
        }

        const notes = [note ?? op];
        if (attempt > 0) notes.push(`merged after ${attempt} conflict(s)`);

        registry.revision = base + 1;
        await writeRegistry(registry, op, {
          entriesBefore,
          note: notes.join('; '),
          stamped: true,
          locked: lockHeld,
        });
        return outcome.value;
      }
    })
  );
}

// =============================================================================
// REGISTRATION
// =============================================================================

/**
 * Register or update a project after scan.
 * Replaces the inline registry code previously in cli/index.ts.
 */
export async function registerProject(
  projectRoot: string,
  stats?: { components: number; connections: number; prompts: number },
  significance?: DiffSignificance,
  gitInfo?: GitInfo
): Promise<void> {
  try {
    // The mutation is expressed as a closure so `mutateRegistry` can replay it
    // against a fresh registry after a detected conflict. Find-or-create is
    // idempotent under replay, and `scanCount + 1` recomputes off the winner's
    // count rather than double-incrementing a stale one.
    await mutateRegistry(
      'register',
      (registry) => {
        const existing = registry.projects.find((p) => p.path === projectRoot);
        if (existing) {
          existing.lastScan = Date.now();
          existing.scanCount = (existing.scanCount || 0) + 1;
          if (stats) existing.stats = stats;
          if (significance && significance !== 'patch') {
            existing.lastSignificantChange = Date.now();
            existing.lastSignificance = significance;
          }
          if (gitInfo) {
            existing.git = { branch: gitInfo.branch, commit: gitInfo.commit };
          }
        } else {
          const dirName = projectRoot.split(path.sep).pop() || 'project';
          const name = dirName
            .replace(/[-_]/g, ' ')
            .replace(/\b\w/g, (c) => c.toUpperCase())
            .trim();
          registry.projects.push({
            path: projectRoot,
            name,
            addedAt: Date.now(),
            lastScan: Date.now(),
            scanCount: 1,
            stats,
            lastSignificantChange: significance && significance !== 'patch' ? Date.now() : undefined,
            lastSignificance: significance && significance !== 'patch' ? significance : undefined,
            git: gitInfo ? { branch: gitInfo.branch, commit: gitInfo.commit } : undefined,
          });
        }
        return { commit: true, value: undefined };
      },
      'register'
    );
  } catch (err) {
    // Non-critical to the caller's scan — but surface it so it isn't
    // completely invisible (was a bare `catch {}` before this fix). A save
    // failure must not be reported as a silent success.
    console.error(
      `navgator: failed to register project ${projectRoot} in ~/.navgator/projects.json: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }
}

/**
 * Read-modify-write a project's metadata, preserving every field the caller
 * doesn't name in `patch`. Used by the remote-scan chunk (C7) to record a
 * remote origin without disturbing scan stats, git info, or portfolio data
 * a sibling writer already set.
 *
 * Serialized through `withRegistryLock` for the same reason as
 * `registerProject` — see that function's comment.
 */
export async function updateProjectMeta(
  root: string,
  patch: Partial<Omit<ProjectEntry, 'path'>>
): Promise<void> {
  await mutateRegistry(
    'update',
    (registry) => {
      const existing = registry.projects.find((p) => p.path === root);

      if (existing) {
        Object.assign(existing, patch);
      } else {
        const dirName = root.split(path.sep).pop() || 'project';
        const name = dirName
          .replace(/[-_]/g, ' ')
          .replace(/\b\w/g, (c) => c.toUpperCase())
          .trim();
        registry.projects.push({
          path: root,
          name,
          addedAt: Date.now(),
          lastScan: null,
          scanCount: 0,
          ...patch,
        });
      }

      return { commit: true, value: undefined };
    },
    'update'
  );
}

/**
 * Remove a project from the registry. Returns true when an entry was actually
 * removed, false when the path was not registered.
 *
 * Shares the CAS write path so a removal cannot silently resurrect entries a
 * concurrent writer added — the filter is replayed against the winner's
 * registry rather than overwriting it with a stale list.
 */
export async function removeProject(root: string): Promise<boolean> {
  return mutateRegistry(
    'remove',
    (registry) => {
      const before = registry.projects.length;
      registry.projects = registry.projects.filter((p) => p.path !== root);
      const removed = registry.projects.length !== before;
      return { commit: removed, value: removed };
    },
    'remove'
  );
}

// =============================================================================
// LISTING
// =============================================================================

/**
 * List all registered projects
 */
export async function listProjects(): Promise<ProjectEntry[]> {
  const registry = await loadRegistry('listProjects');
  return registry.projects;
}

/**
 * Format the project list for CLI display
 */
export function formatProjectsList(projects: ProjectEntry[], json?: boolean): string {
  if (json) {
    return JSON.stringify(projects, null, 2);
  }

  if (projects.length === 0) {
    return 'No projects registered yet. Run `navgator scan` in a project to register it.';
  }

  const lines: string[] = [];
  lines.push('Registered Projects');
  lines.push('─'.repeat(60));

  for (const p of projects) {
    const lastScan = p.lastScan
      ? timeSince(p.lastScan)
      : 'never';
    const stale = p.lastScan && (Date.now() - p.lastScan) > 24 * 60 * 60 * 1000;
    const staleIndicator = stale ? ' (stale)' : '';

    lines.push('');
    lines.push(`  ${p.name}${staleIndicator}`);
    lines.push(`  ${p.path}`);
    lines.push(`  Scans: ${p.scanCount || 0} | Last: ${lastScan}`);

    if (p.stats) {
      lines.push(`  Components: ${p.stats.components} | Connections: ${p.stats.connections} | Prompts: ${p.stats.prompts}`);
    }

    if (p.git) {
      lines.push(`  Branch: ${p.git.branch} @ ${p.git.commit}`);
    }

    if (p.origin) {
      const detail = p.origin.kind === 'remote' && p.origin.url ? ` (${p.origin.url})` : '';
      lines.push(`  Origin: ${p.origin.kind}${detail}`);
    }

    if (p.portfolio) {
      lines.push(`  Portfolio: ${p.portfolio.root}`);
    }

    if (p.lastSignificance && p.lastSignificantChange) {
      lines.push(`  Last significant change: ${p.lastSignificance.toUpperCase()} (${timeSince(p.lastSignificantChange)})`);
    }
  }

  return lines.join('\n');
}

function timeSince(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
