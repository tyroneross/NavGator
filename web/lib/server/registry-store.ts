/**
 * NavGator Project Registry — web-route load/mutate/save owner.
 *
 * This is the web twin of the CAS + mutex pattern in `src/projects.ts`
 * (`mutateRegistry` / `loadRegistry` / `writeRegistry` / `readDiskRevision` /
 * `withRegistryLock`). The web app compiles separately from the CLI (own
 * tsconfig, own node_modules, `@/` alias), so the pattern is duplicated here
 * rather than imported across the package boundary — the same reasoning
 * `web/lib/server/atomic-write.ts` documents for its own duplication of
 * `src/storage.ts`'s atomic-write helper.
 *
 * Before this module existed, `web/app/api/projects/route.ts` did an unguarded
 * load-mutate-save with no serialization at all: Next.js serves concurrent
 * requests to one route in a single process, so two concurrent POSTs raced
 * the same in-memory read with no mutex between them, in addition to the
 * cross-process race against the CLI. Measured: 300 lost registrations across
 * 300 rounds through this route.
 *
 * The mutex below fixes the in-process half. The cross-process half is
 * prevented by `withRegistryFileLock` (web/lib/server/registry-lock.ts), whose
 * lock file and record shape the CLI mirrors exactly — that shared protocol is
 * the whole mechanism, since neither compilation unit can import the other. The
 * revision compare-and-swap sits underneath both as the detector for anything
 * that gets past them, replaying the mutation against the winner's registry
 * instead of clobbering it.
 *
 * This file is deliberately alias-free (no `@/` imports, no `next/*` imports)
 * so `src/__tests__/registry-concurrency-oracle.test.ts` holds both copies to
 * one contract by relative-path import, mirroring `web/lib/server/coverage.ts`.
 */

import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { atomicWriteFile } from "./atomic-write";
import {
  appendJournalEvent,
  registryDigest,
  type JournalOp,
} from "./registry-journal";
import { withRegistryFileLock } from "./registry-lock";

// =============================================================================
// TYPES
// =============================================================================

export interface RegisteredProject {
  path: string;
  name: string;
  addedAt: number;
  lastScan: number | null;
  // Optional fields owned by src/projects.ts's richer ProjectEntry shape.
  // This route never reconstructs an existing entry (GET spreads `...project`,
  // POST only pushes brand-new entries) so these are never stripped from
  // sibling entries on a read-modify-write — declared here only so the
  // types below don't have to widen to `any`.
  scanCount?: number;
  stats?: { components: number; connections: number; prompts: number };
  git?: { branch: string; commit: string };
  origin?: { kind: "local" | "remote"; url?: string; cachePath?: string };
  portfolio?: { root: string };
}

export interface ProjectRegistry {
  version: 2;
  /**
   * Monotonic write counter, bumped once per successful save.
   *
   * A writer that loads revision N and finds revision M != N on disk when it
   * goes to save has detected that someone else committed underneath it — a
   * lost-update race. See `mutateRegistry`.
   *
   * Optional and additive: `version` stays 2 (src/projects.ts owns any future
   * migration past 2), and a v2 file written before this field existed loads
   * as revision 0. That keeps a registry written by a new CLI readable by an
   * older dashboard build and vice versa.
   */
  revision?: number;
  projects: RegisteredProject[];
}

// =============================================================================
// REGISTRY PATH
// =============================================================================

/**
 * Resolved per call, never captured at import time.
 *
 * A module-level `const REGISTRY_DIR = path.join(os.homedir(), ...)` freezes
 * the path at first import. The shared oracle in
 * `src/__tests__/registry-concurrency-oracle.test.ts` redirects `$HOME` to a
 * tmp directory in `beforeEach` — after this module is imported — so a captured
 * constant would point every test at the developer's real `~/.navgator` and
 * corrupt it. `web/lib/server/coverage.ts` avoids the same trap by taking
 * `registryPath` as an argument.
 */
export function registryDir(): string {
  return path.join(os.homedir(), ".navgator");
}

export function registryPath(): string {
  return path.join(registryDir(), "projects.json");
}

// =============================================================================
// LOAD / SAVE
// =============================================================================

/**
 * Load the project registry, normalizing `revision` and `projects` and
 * journaling the read.
 *
 * Every call journals a `load` record. The registry has readers in two
 * compilation units and no other record of access, so "who read this, when"
 * was previously unanswerable from this side either.
 *
 * On parse failure (missing file, corrupt JSON) returns a fresh v2 registry —
 * this preserves the existing route behavior of degrading to an empty project
 * list rather than throwing (see the comment at the old
 * web/app/api/projects/route.ts:65-68, migrated here).
 */
export async function loadRegistry(note?: string): Promise<ProjectRegistry> {
  let registry: ProjectRegistry;

  try {
    const content = await fs.readFile(registryPath(), "utf-8");
    const raw = JSON.parse(content) as Partial<ProjectRegistry> & Record<string, unknown>;
    // Spread first so top-level fields this route does not model survive a
    // dashboard write. Reconstructing the literal instead dropped them, and
    // worse, hardcoding `version: 2` rewrote a v1 file as v2 WITHOUT running the
    // v1->v2 migration — after which src/projects.ts sees version === 2, skips
    // the migration permanently, and every entry is stranded without scanCount.
    registry = {
      ...raw,
      version: (typeof raw.version === "number" ? raw.version : 2) as ProjectRegistry["version"],
      revision:
        typeof raw.revision === "number" && Number.isFinite(raw.revision) ? raw.revision : 0,
      projects: Array.isArray(raw.projects) ? raw.projects : [],
    };
  } catch {
    registry = { version: 2, revision: 0, projects: [] };
  }

  await appendJournalEvent(registryDir(), {
    op: "load",
    rev: registry.revision ?? 0,
    entries: registry.projects.length,
    note,
  });

  return registry;
}

/**
 * Shared write tail: write atomically via `atomicWriteFile`, then journal the
 * result. Callers stamp `registry.revision` themselves before calling this
 * (mirrors `writeRegistry`'s `stamped` option in src/projects.ts — every call
 * site here goes through `mutateRegistry`, which always stamps first).
 */
async function writeRegistry(
  registry: ProjectRegistry,
  op: JournalOp,
  options: { entriesBefore?: number; note?: string; locked?: boolean } = {}
): Promise<void> {
  await fs.mkdir(registryDir(), { recursive: true });
  await atomicWriteFile(registryPath(), JSON.stringify(registry, null, 2));

  await appendJournalEvent(registryDir(), {
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
    const content = await fs.readFile(registryPath(), "utf-8");
    const raw = JSON.parse(content) as Partial<ProjectRegistry>;
    revision = typeof raw.revision === "number" && Number.isFinite(raw.revision) ? raw.revision : 0;
    entries = Array.isArray(raw.projects) ? raw.projects.length : 0;
  } catch {
    // Missing or unparseable reads as revision 0 — the same pre-image
    // loadRegistry would have produced, so base and disk still agree.
  }

  await appendJournalEvent(registryDir(), {
    op: "load",
    rev: revision,
    entries,
    note: "cas-check",
  });

  return revision;
}

// =============================================================================
// CONCURRENCY
// =============================================================================

/**
 * In-process mutex for registry read-modify-write sections.
 *
 * Next.js serves concurrent requests to this route in a single process, so
 * without serialization two concurrent POST handlers both `loadRegistry()`
 * the same pre-image, mutate their own in-memory copy, and save — the last
 * writer wins and the other's registration or removal is silently lost
 * (measured: 300 of 300 rounds lost a registration). Chaining every
 * load-mutate-save body onto a single promise queue makes them run one at a
 * time, so each sees the previous writer's result.
 *
 * This is an in-process mutex ONLY. Cross-process contention (a `navgator` CLI
 * invocation writing projects.json at the same time) is prevented by
 * `withRegistryFileLock` one layer out — NOT by the compare-and-swap, which is
 * blind to two writers that load the same revision in the same tick. This mutex
 * stays load-bearing because the file lock fails open. Mirrors
 * `withRegistryLock` in src/projects.ts.
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
 * Three mechanisms, covering three different races, ordered outermost to
 * innermost. This mirrors src/projects.ts's `mutateRegistry` exactly; any
 * change here must be made there too.
 *
 * 1. **`withRegistryLock`** serializes the whole load-mutate-save body against
 *    other callers *in this process*. That is what stops two concurrent
 *    dashboard POSTs from clobbering each other, and it is the direct fix for
 *    the measured 300-of-300 loss.
 *
 * 2. **`withRegistryFileLock`** serializes against writers in *other* processes
 *    — a `navgator` CLI invocation or the MCP server, which mirror the same
 *    lock protocol on the same file.
 *
 *    It is load-bearing, not belt-and-braces: CAS alone cannot prevent this.
 *    Two writers starting in the same tick both read revision R before either
 *    saves, so both pass their own CAS check and both write R+1. One entry is
 *    lost and *neither writer sees a mismatch to report* — silent loss, which
 *    is precisely what this change exists to eliminate.
 *
 * 3. **Compare-and-swap on `revision`** is the detector of last resort, for
 *    anything that slips past the lock: a writer that could not acquire it
 *    within the budget, a stale-lock steal, a filesystem that does not honour
 *    O_EXCL, or an older build that predates the lock. On a mismatch we journal
 *    a `conflict`, re-read the winner's registry, and **re-apply the same
 *    mutation closure** to it.
 *
 * The closure is the reason (3) merges instead of clobbering. Replaying intent
 * against fresh state is idempotent for every mutation here (add-if-absent,
 * filter-out), whereas replaying a captured *result* would drop whatever the
 * winner wrote. A mutation that decides it has nothing to do returns
 * `commit: false`, which skips the write rather than replaying a duplicate
 * insert.
 *
 * Honest limit: when the file lock cannot be acquired the write proceeds
 * unlocked, and POSIX offers no atomic compare-and-swap on a rename, so a
 * sub-millisecond window remains in that degraded path. It is recorded — the
 * write's journal note says the lock was not held — rather than hidden.
 */
export async function mutateRegistry<T>(
  op: JournalOp,
  mutate: (registry: ProjectRegistry) => MutationOutcome<T>,
  note?: string
): Promise<T> {
  return withRegistryLock(() =>
    withRegistryFileLock(registryDir(), async (lockHeld) => {
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
            // committed — an older dashboard build reconstructed the registry
            // as `{version, projects}` and dropped the field. Worth naming
            // separately: it is a compatibility signal, not contention.
            const kind = diskRevision < base ? "revision-regression" : "concurrent-write";
            await appendJournalEvent(registryDir(), {
              op: "conflict",
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
          note: notes.join("; "),
          locked: lockHeld,
        });
        return outcome.value;
      }
    })
  );
}

// =============================================================================
// CONVENIENCE WRAPPERS
// =============================================================================

/**
 * Add a project if not already registered. Returns `{ added: true }` when a
 * new entry was pushed, `{ added: false }` when the path was already present
 * (no-op — no write, no revision bump).
 *
 * The duplicate check runs INSIDE the mutation closure so a replay after a
 * detected conflict re-checks against the winner's registry, not a stale
 * pre-conflict snapshot — otherwise a conflict replay could push a duplicate
 * entry the winner had already added.
 */
export async function addProject(
  resolvedPath: string,
  entry: Omit<RegisteredProject, "path">
): Promise<{ added: boolean }> {
  return mutateRegistry<{ added: boolean }>(
    "register",
    (registry) => {
      if (registry.projects.some((p) => p.path === resolvedPath)) {
        return { commit: false, value: { added: false } };
      }
      registry.projects.push({ path: resolvedPath, ...entry });
      return { commit: true, value: { added: true } };
    },
    "add"
  );
}

/**
 * Remove a project from the registry. Returns whether an entry was actually
 * removed. Shares the CAS write path so a removal cannot silently resurrect
 * entries a concurrent writer added — the filter is replayed against the
 * winner's registry rather than overwriting it with a stale list.
 */
export async function removeProject(resolvedPath: string): Promise<{ removed: boolean }> {
  return mutateRegistry(
    "remove",
    (registry) => {
      const before = registry.projects.length;
      registry.projects = registry.projects.filter((p) => p.path !== resolvedPath);
      const removed = registry.projects.length !== before;
      return { commit: removed, value: { removed } };
    },
    "remove"
  );
}
