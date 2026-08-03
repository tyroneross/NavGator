/**
 * gator-memory — the durable narrative store for `~/.navgator/memory/`.
 *
 * Why this exists: `~/.navgator/` already holds three things, and none of them
 * answer "what happened to this project over time?". `projects.json` is the
 * live registry (current state only, overwritten in place).
 * `registry-journal.jsonl` is a forensic op log — it records digests and
 * entry-count deltas, not project identity, and it is deliberately
 * size-rotated so it CANNOT serve as history (see `registry-journal.ts`'s own
 * header for why payloads don't belong there). `lessons/global-lessons.json`
 * captures patterns, not events. Nothing records the narrative: which
 * projects exist, when they entered, what materially changed and when. This
 * module is that narrative layer.
 *
 * THE SOURCE OF TRUTH IS `projects/<slug>.json`, not `index.json` or
 * `events.jsonl`. This is the property that makes compaction/rotation safe:
 * `index.json` is a derived rollup (regenerable from the per-project files —
 * see `rebuildMemoryIndex`) and `events.jsonl` is a derived chronology (each
 * event is ALSO folded into the owning project's `milestones[]`).
 *
 * Be precise about that last part rather than overclaiming, because the
 * tempting shorthand — "both can be deleted without losing knowledge" — is
 * FALSE. `milestones[]` is capped at `maxMilestones()` and evicts oldest
 * first, so a project with more lifetime events than the cap has older
 * chronology that exists ONLY in `events.jsonl` until rotation drops it. The
 * accurate statement is narrower and still strong: deleting the derived files
 * preserves every project's identity, counters, latest stats, and most recent
 * milestones, and `projects/<slug>.json` is the only file whose loss is
 * unrecoverable. Losing a rotated event generation costs old cross-project
 * ordering and the tail of a long-lived project's history — an accepted trade
 * for a hard bound, not a free one.
 *
 * `index.json` IS NOT ON THE CAPTURE WRITE PATH, and that is a correctness
 * requirement rather than a performance preference. Capture deliberately runs
 * OUTSIDE the registry's in-process mutex and cross-process file lock, because
 * a memory write must never extend the ~8-9 ms critical section that
 * `registerProject` holds. But `scanPortfolio` runs N concurrent in-process
 * workers and every one of them reaches `registerProject`
 * (`src/projects.ts:216-222` — the call path that measurably registered only
 * 2 of 6 entries at concurrency 4 before the lock landed). If every capture
 * also read-modify-wrote ONE shared rollup file, those workers would race on
 * it with no mutex and no compare-and-swap, reintroducing the exact
 * lost-update defect this repo just closed, one layer up. It would also make
 * each capture O(registered projects); the concurrency oracle's header cites a
 * real 541-project registry.
 *
 * So `recordMemoryEvent` writes exactly two things: one `O_APPEND` line to
 * `events.jsonl` (atomic for a record this small) and one temp+rename of
 * `projects/<slug>.json` (single-project scope, so workers scanning different
 * projects never contend for the same file). `index.json` is written ONLY by
 * `rebuildMemoryIndex`, called from hygiene and mirror paths that are
 * single-threaded by construction. Readers never depend on it being current.
 *
 * Single-project scope stops DIFFERENT projects from contending for the same
 * file, but says nothing about the SAME project scanned concurrently — the
 * dashboard and a CLI scan hitting one repo together, or a future caller that
 * reaches `recordMemoryEvent` without `scanPortfolio`'s per-project
 * partitioning. `writeProjectRecordWithCAS` closes that gap with a per-slug
 * compare-and-swap, NOT a store-wide mutex or lock file — the whole point of
 * this design is that capture stays off the shared-rollup path and outside
 * the registry's locks. It reads the record, computes the candidate, and
 * immediately re-reads the same file with nothing but two more `*Sync` calls
 * in between; if the file changed since the first read, the SAME event is
 * re-applied to the fresh winner and the attempt retries, bounded at 5
 * (mirroring `MAX_CAS_ATTEMPTS` in `src/projects.ts:272`), then commits
 * unconditionally on the last attempt. Because the whole read-compare-write
 * runs on synchronous fs calls with no `await` in between, one in-process
 * call cannot be interleaved by another in-process call at all — the first
 * iteration always wins against same-process contention. Across processes,
 * true OS-level parallelism remains possible in the syscall-width window
 * between the check-read and the rename; the same honest limit
 * `mutateRegistry`'s header documents for the registry applies here too.
 *
 * Bounded by construction, mirroring `registry-journal.ts`'s posture exactly:
 *   - `milestones[]` on a project record is capped at `maxMilestones()`
 *     (env `NAVGATOR_MEMORY_MAX_MILESTONES` > `memory.maxMilestonesPerProject`
 *     in `~/.navgator/config.json` > the `MAX_MILESTONES` default), oldest
 *     evicted first, so a single long-lived project's file cannot grow
 *     without limit no matter how many scans it accumulates.
 *   - `events.jsonl` rotates to `events.1.jsonl` at `maxEventBytes()` (same
 *     ladder: env `NAVGATOR_MEMORY_MAX_EVENT_BYTES` > `memory.maxEventBytes`
 *     in the file > `DEFAULT_MAX_EVENT_BYTES`), one generation only, so the
 *     chronology is capped at
 *     `2 * maxEventBytes + 1 record` even if the rotate rename fails
 *     persistently (falls back to truncation — see `rotateEventsIfNeeded`,
 *     copied from `rotateIfNeededSync` in `registry-journal.ts:279-307`, and
 *     the same reasoning applies: swallowing a failed rename and appending
 *     anyway would silently retire the cap).
 *   - `summary` is sanitized (control characters stripped) and capped at
 *     `SUMMARY_MAX_CHARS`. Project *paths* flow into summaries, and a path is
 *     user-controlled text that ends up rendered in a terminal — neutralizing
 *     at write time means the stored record is safe regardless of who renders
 *     it later, the same argument as `sanitizeNote` in `registry-journal.ts`.
 *
 * Fail-open by construction: every exported entry point swallows its own
 * errors and degrades — a corrupt `projects/<slug>.json` reads as `null`
 * rather than throwing, a torn final line in `events.jsonl` is skipped rather
 * than aborting the whole read, an unwritable memory directory makes
 * `recordMemoryEvent` a silent no-op. A broken memory store must never break
 * a scan or a registry write; memory is a record of what happened, not a gate
 * on what happens next.
 *
 * Security posture: directory mode `0o700`, file mode `0o600` — these files
 * name every project on the machine, which on a shared host is nobody else's
 * business. The `events.jsonl` append opens with `O_NOFOLLOW` for the same
 * reason `registry-journal.ts` does: without it, anything that can write to
 * `~/.navgator` could pre-plant the path as a symlink and redirect every
 * append into an arbitrary file. JSON writes go through write-temp-then-rename
 * with a per-call-unique temp suffix (pid + timestamp + random hex) — this
 * repo has already been burned once by a temp suffix of `pid + Date.now()`
 * alone (see `web/lib/server/atomic-write.ts`'s header: 123 of 400 rounds
 * published unparseable JSON at 8 concurrent writers before the random
 * component was added).
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';

import { loadHomeConfig } from '../home-config.js';

// =============================================================================
// TYPES
// =============================================================================

export type MemoryEventKind =
  | 'project.registered'
  | 'project.scanned'
  | 'project.removed'
  | 'architecture.changed';

export interface MemoryEvent {
  ts: number;
  slug: string;
  kind: MemoryEventKind;
  /** One line, sanitized (control characters stripped), capped at 200 chars. */
  summary: string;
  detail?: {
    components?: number;
    connections?: number;
    prompts?: number;
    significance?: 'major' | 'minor';
    componentsAdded?: number;
    componentsRemoved?: number;
    connectionsAdded?: number;
    connectionsRemoved?: number;
    branch?: string;
    commit?: string;
  };
}

export interface ProjectMemory {
  schema_version: string;
  slug: string;
  name: string;
  path: string;
  firstSeen: number;
  lastSeen: number;
  status: 'active' | 'removed';
  counters: { scans: number; significantChanges: number };
  latest?: {
    components?: number;
    connections?: number;
    prompts?: number;
    branch?: string;
    commit?: string;
  };
  /** Capped at MAX_MILESTONES, oldest evicted first, newest last. */
  milestones: MemoryEvent[];
}

/** What `recordMemoryEvent` accepts; `ts` and `slug` are filled in here. */
export type RecordMemoryEventInput = Omit<MemoryEvent, 'ts' | 'slug'> & {
  /** Absolute or relative project path. Resolved and slugged internally. */
  projectPath: string;
  /** Display name. Defaults to the resolved path's basename. */
  name?: string;
  /** Epoch milliseconds. Defaults to `Date.now()`. */
  ts?: number;
};

// =============================================================================
// CONSTANTS
// =============================================================================

export const MEMORY_SCHEMA_VERSION = '1.0.0';

/**
 * Default rotation threshold for `events.jsonl`. See `maxEventBytes()` below
 * for the full env > file > default ladder (env var used directly by the
 * rotation test — see `src/__tests__/memory-store.test.ts`).
 */
export const DEFAULT_MAX_EVENT_BYTES = 2_000_000;

/**
 * Default per-project milestone cap, oldest evicted first when exceeded. See
 * `maxMilestones()` below for the full env > file > default ladder.
 */
export const MAX_MILESTONES = 40;

/** Summaries are context, not payload. Anything longer is a payload in disguise. */
const SUMMARY_MAX_CHARS = 200;

const EVENTS_FILENAME = 'events.jsonl';
const ROTATED_EVENTS_FILENAME = 'events.1.jsonl';
const INDEX_FILENAME = 'index.json';
const PROJECTS_DIRNAME = 'projects';

/**
 * Owner-only. These files record which projects exist on this machine and
 * when they changed; on a shared host that is nobody else's business.
 */
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

/**
 * Open `events.jsonl` WITHOUT following a symlink — see the module header.
 * `O_NOFOLLOW` is absent on Windows, where this degrades to a normal append.
 */
const APPEND_FLAGS =
  fs.constants.O_WRONLY |
  fs.constants.O_APPEND |
  fs.constants.O_CREAT |
  (fs.constants.O_NOFOLLOW || 0);

// =============================================================================
// CONFIGURATION
// =============================================================================

/**
 * Memory capture is on by default. `NAVGATOR_MEMORY=0` (or `false`,
 * case-insensitive) turns it off — this mirrors `journalEnabled()` in
 * `registry-journal.ts:167-171` exactly. When the env var is unset, the
 * decision falls through to `memory.enabled` in `~/.navgator/config.json`
 * (via `loadHomeConfig()`, which already applies its own env override for
 * `NAVGATOR_MEMORY` — checking the raw env var here first is what lets this
 * function short-circuit without touching the home-config file at all when
 * the env var is set).
 */
export function memoryEnabled(): boolean {
  const raw = process.env.NAVGATOR_MEMORY;
  if (raw !== undefined) {
    return raw !== '0' && raw.toLowerCase() !== 'false';
  }
  return loadHomeConfig().memory.enabled;
}

/**
 * The memory directory. Resolved PER CALL, never a module-level const — see
 * `registry-journal.ts:179-187` and `web/lib/server/registry-store.ts:89` for
 * the reasoning this mirrors, and `src/__tests__/registry-concurrency-oracle
 * .test.ts` for the regression that a cached path would reintroduce. A test
 * that redirects `$HOME` before calling into this module must actually
 * redirect every path derived from it.
 */
export function memoryDir(): string {
  return path.join(os.homedir(), '.navgator', 'memory');
}

export function projectMemoryPath(projectSlug: string): string {
  return path.join(memoryDir(), PROJECTS_DIRNAME, `${projectSlug}.json`);
}

function eventsPath(dir: string): string {
  return path.join(dir, EVENTS_FILENAME);
}

function rotatedEventsPath(dir: string): string {
  return path.join(dir, ROTATED_EVENTS_FILENAME);
}

function indexPath(dir: string): string {
  return path.join(dir, INDEX_FILENAME);
}

/**
 * Rotation threshold ladder: env `NAVGATOR_MEMORY_MAX_EVENT_BYTES` > file
 * `memory.maxEventBytes` (`~/.navgator/config.json`, via `loadHomeConfig()`)
 * > `DEFAULT_MAX_EVENT_BYTES`. A nonsense file value (non-finite, `<= 0`, or
 * the wrong type — the latter already caught by `loadHomeConfig`'s own
 * `deepMerge`) falls back to the default, mirroring `maxBytes()` in
 * `registry-journal.ts:172-177` exactly.
 */
function maxEventBytes(): number {
  const raw = process.env.NAVGATOR_MEMORY_MAX_EVENT_BYTES;
  if (raw) {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  const fromFile = loadHomeConfig().memory.maxEventBytes;
  return Number.isFinite(fromFile) && fromFile > 0 ? fromFile : DEFAULT_MAX_EVENT_BYTES;
}

/**
 * Per-project milestone cap ladder: env `NAVGATOR_MEMORY_MAX_MILESTONES` >
 * file `memory.maxMilestonesPerProject` > the `MAX_MILESTONES` default. Same
 * nonsense-value guard as `maxEventBytes()` above. `MAX_MILESTONES` stays
 * exported as the DEFAULT (tests and `src/index.ts` reference it) — this
 * function, not the constant, is what `applyEventToRecord` calls, which is
 * what makes the file config key change actual behavior instead of being
 * parsed, typed, defaulted, and inert.
 */
function maxMilestones(): number {
  const raw = process.env.NAVGATOR_MEMORY_MAX_MILESTONES;
  if (raw) {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  const fromFile = loadHomeConfig().memory.maxMilestonesPerProject;
  return Number.isFinite(fromFile) && fromFile > 0 ? fromFile : MAX_MILESTONES;
}

// =============================================================================
// SLUG
// =============================================================================

/**
 * Collapse arbitrary text into a lowercase, hyphen-separated token.
 *
 * Every run of non-`[a-z0-9]` characters collapses to a single `-`; the
 * result is trimmed of leading/trailing `-` and capped at 32 chars (trimmed
 * again after capping, in case the cut lands mid-run). An empty result (an
 * input that was ALL non-alphanumeric, e.g. `"..."` or `"///"`) falls back to
 * `'project'` so `slug()` never produces a bare `-<digest>`.
 */
function kebab(input: string): string {
  let result = input.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  result = result.replace(/^-+|-+$/g, '');
  result = result.slice(0, 32);
  result = result.replace(/^-+|-+$/g, '');
  return result || 'project';
}

/**
 * `slug(projectPath)` = `kebab(basename(resolved))` + `'-'` + first 8 hex
 * chars of `sha256(resolved)`.
 *
 * Two properties fall out of this construction, both load-bearing:
 *
 *   1. Two directories that happen to share a basename (two checkouts both
 *      named `web`) get DISTINCT slugs, because the digest is computed off
 *      the full resolved path, not the basename.
 *   2. A crafted basename containing `..` or `/` cannot escape
 *      `~/.navgator/memory/projects/` — not "is unlikely to", but
 *      structurally cannot: `kebab()` already collapses every `/` and `.`
 *      run to a single `-` before the digest is even computed, and the
 *      digest suffix guarantees uniqueness on top of that regardless of what
 *      survived the kebab filter. `projectMemoryPath()` therefore only ever
 *      joins a `[a-z0-9-]+` segment plus `.json` onto the projects directory.
 *
 * Deterministic: the same absolute path always produces the same slug,
 * because `path.resolve` and `sha256` are both pure functions of their input.
 */
export function slug(projectPath: string): string {
  const resolved = path.resolve(projectPath);
  const base = kebab(path.basename(resolved));
  const digest = crypto.createHash('sha256').update(resolved).digest('hex').slice(0, 8);
  return `${base}-${digest}`;
}

// =============================================================================
// SANITIZATION
// =============================================================================

/**
 * Strip control characters from a summary and cap its length.
 *
 * A summary routinely carries a project path built from user-controlled
 * text (directory names chosen by whoever cloned the repo), and it is later
 * rendered in a terminal (a future `navgator memory` command, or a status
 * line). Neutralizing at write time means the stored record is safe
 * regardless of who renders it, the same argument `sanitizeNote` makes in
 * `registry-journal.ts:314-326`.
 */
function sanitizeSummary(summary: string): string {
  // eslint-disable-next-line no-control-regex
  return summary.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').slice(0, SUMMARY_MAX_CHARS);
}

// =============================================================================
// ATOMIC JSON WRITE
// =============================================================================

/**
 * Build a per-call-unique temp path for a write-temp-then-rename.
 *
 * The suffix must be unique PER CALL, not per millisecond: `pid + Date.now()`
 * alone collides whenever two writes to the SAME target land in the same
 * process in the same millisecond (concurrent `recordMemoryEvent` calls
 * updating `index.json`, for instance), and the loser's rename then lands a
 * half-written file at the target. `web/lib/server/atomic-write.ts` measured
 * this at 8 concurrent writers: 123 of 400 rounds published unparseable JSON
 * before the random component was added. The random hex closes that.
 */
function uniqueTempPath(target: string): string {
  return `${target}.${process.pid}.${Date.now()}.${crypto.randomBytes(6).toString('hex')}.tmp`;
}

function atomicWriteJSONFileSync(target: string, value: unknown): void {
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: DIR_MODE });
  const tmp = uniqueTempPath(target);
  try {
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { encoding: 'utf-8', mode: FILE_MODE });
    fs.renameSync(tmp, target);
  } catch (error) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      // best effort
    }
    throw error;
  }
}

function readJsonFileSafe<T>(filePath: string): T | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return null; // Absent, unreadable, or corrupt — the caller falls back.
  }
}

// =============================================================================
// EVENTS.JSONL — ROTATION AND APPEND
// =============================================================================

/**
 * Rotate `events.jsonl` when it has reached `maxEventBytes()`. One generation
 * only: the previous rotation is replaced, so the chronology can never grow
 * past `2 * maxEventBytes` no matter how long NavGator runs.
 *
 * Copied from `rotateIfNeededSync` in `registry-journal.ts:279-307`,
 * including the truncate fallback: the rename can fail persistently (an
 * immutable or permission-denied rotated destination), and swallowing that
 * failure and appending anyway would silently retire the size cap for the
 * life of the process. Truncating costs the older half of the chronology but
 * keeps the bound real.
 */
function rotateEventsIfNeeded(liveEventsPath: string): void {
  let size: number;
  try {
    size = fs.statSync(liveEventsPath).size;
  } catch {
    return; // No events file yet — nothing to rotate.
  }
  if (size < maxEventBytes()) return;

  const rotated = rotatedEventsPath(path.dirname(liveEventsPath));
  try {
    fs.renameSync(liveEventsPath, rotated);
    return;
  } catch {
    // Fall through to the truncate fallback below.
  }

  try {
    fs.truncateSync(liveEventsPath, 0);
  } catch {
    // Both paths failed. Appending is still better than losing the record.
  }
}

async function appendEventRecord(dir: string, event: MemoryEvent): Promise<void> {
  const live = eventsPath(dir);
  rotateEventsIfNeeded(live);
  const line = JSON.stringify(event) + '\n';
  const handle = await fs.promises.open(live, APPEND_FLAGS, FILE_MODE);
  try {
    await handle.write(line);
  } finally {
    await handle.close();
  }
}

// =============================================================================
// PROJECT RECORD
// =============================================================================

function readProjectMemoryBySlug(projectSlug: string): ProjectMemory | null {
  return readJsonFileSafe<ProjectMemory>(projectMemoryPath(projectSlug));
}

/**
 * Fold one event into a project's durable record.
 *
 * `firstSeen` is set once, at creation, and never overwritten by a later
 * event — the whole point of the field. `status` flips to `'removed'` on a
 * `project.removed` event and back to `'active'` on any subsequent event for
 * the same slug (a re-registration after removal is a fact worth recording,
 * not an error). `milestones` is capped at `maxMilestones()`, oldest evicted
 * first.
 */
function applyEventToRecord(
  existing: ProjectMemory | null,
  projectSlug: string,
  resolvedPath: string,
  name: string,
  event: MemoryEvent
): ProjectMemory {
  const base: ProjectMemory =
    existing ?? {
      schema_version: MEMORY_SCHEMA_VERSION,
      slug: projectSlug,
      name,
      path: resolvedPath,
      firstSeen: event.ts,
      lastSeen: event.ts,
      status: 'active',
      counters: { scans: 0, significantChanges: 0 },
      milestones: [],
    };

  const record: ProjectMemory = {
    ...base,
    name: name || base.name,
    path: resolvedPath,
    lastSeen: event.ts,
    status: event.kind === 'project.removed' ? 'removed' : 'active',
    counters: { ...base.counters },
    milestones: [...base.milestones],
  };

  if (event.kind === 'project.scanned') {
    record.counters.scans += 1;
    const detail = event.detail;
    if (detail) {
      record.latest = {
        ...base.latest,
        ...(detail.components !== undefined ? { components: detail.components } : {}),
        ...(detail.connections !== undefined ? { connections: detail.connections } : {}),
        ...(detail.prompts !== undefined ? { prompts: detail.prompts } : {}),
        ...(detail.branch !== undefined ? { branch: detail.branch } : {}),
        ...(detail.commit !== undefined ? { commit: detail.commit } : {}),
      };
    }
  } else if (event.kind === 'architecture.changed') {
    record.counters.significantChanges += 1;
  }

  record.milestones.push(event);
  const cap = maxMilestones();
  if (record.milestones.length > cap) {
    record.milestones = record.milestones.slice(record.milestones.length - cap);
  }

  return record;
}

/** Bounded retries for the same-path CAS below — mirrors `MAX_CAS_ATTEMPTS` in `src/projects.ts:272`. */
const MAX_MEMORY_CAS_ATTEMPTS = 5;

/**
 * Fingerprint a record for the CAS equality check. `null` (no record on disk
 * yet) gets its own sentinel so "absent" and "present" never compare equal.
 */
function fingerprintRecord(record: ProjectMemory | null): string {
  return record ? JSON.stringify(record) : '__ABSENT__';
}

/**
 * Per-slug compare-and-swap write for `projects/<slug>.json` — see the
 * module header's write-path section for the full reasoning. Read, compute
 * the candidate, and immediately re-read the same file with nothing but two
 * `*Sync` calls in between; if the on-disk record changed since the first
 * read, re-apply the SAME event to the fresh winner and retry (bounded at
 * `MAX_MEMORY_CAS_ATTEMPTS`), committing unconditionally on the final
 * attempt exactly as `mutateRegistry` does.
 *
 * Deliberately built on `*Sync` fs calls with no `await` anywhere in this
 * function: within one process nothing can interleave a call that never
 * yields, so the first iteration already wins against every OTHER
 * in-process `recordMemoryEvent` call. That is what makes 50 concurrent
 * same-path `Promise.all` calls land all 50 updates instead of losing 49.
 */
function writeProjectRecordWithCAS(
  projectSlug: string,
  resolvedPath: string,
  name: string,
  event: MemoryEvent
): void {
  const target = projectMemoryPath(projectSlug);
  let base = readProjectMemoryBySlug(projectSlug);

  for (let attempt = 0; ; attempt++) {
    const candidate = applyEventToRecord(base, projectSlug, resolvedPath, name, event);

    if (attempt < MAX_MEMORY_CAS_ATTEMPTS) {
      const onDisk = readProjectMemoryBySlug(projectSlug);
      if (fingerprintRecord(onDisk) !== fingerprintRecord(base)) {
        // Someone else committed since `base` was read. Re-apply the SAME
        // event to their winning state rather than clobbering it.
        base = onDisk;
        continue;
      }
    }

    atomicWriteJSONFileSync(target, candidate);
    return;
  }
}

/** Read a project's durable record. `null` on missing, unreadable, or corrupt. */
export function readProjectMemory(projectPath: string): ProjectMemory | null {
  try {
    return readProjectMemoryBySlug(slug(projectPath));
  } catch {
    return null;
  }
}

// =============================================================================
// INDEX.JSON — DERIVED ROLLUP
// =============================================================================

interface MemoryIndexEntry {
  slug: string;
  name: string;
  path: string;
  firstSeen: number;
  lastSeen: number;
  status: 'active' | 'removed';
  counters: { scans: number; significantChanges: number };
  latest?: ProjectMemory['latest'];
}

interface MemoryIndexFile {
  schema_version: string;
  projects: Record<string, MemoryIndexEntry>;
}

function isMemoryIndexFile(value: unknown): value is MemoryIndexFile {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as MemoryIndexFile).projects === 'object' &&
    (value as MemoryIndexFile).projects !== null
  );
}

function readIndexFile(dir: string): MemoryIndexFile {
  const parsed = readJsonFileSafe<MemoryIndexFile>(indexPath(dir));
  if (isMemoryIndexFile(parsed)) return parsed;
  return { schema_version: MEMORY_SCHEMA_VERSION, projects: {} };
}

function toIndexEntry(record: ProjectMemory): MemoryIndexEntry {
  return {
    slug: record.slug,
    name: record.name,
    path: record.path,
    firstSeen: record.firstSeen,
    lastSeen: record.lastSeen,
    status: record.status,
    counters: record.counters,
    ...(record.latest !== undefined ? { latest: record.latest } : {}),
  };
}

/**
 * Regenerate `index.json` from the per-project records.
 *
 * The ONLY writer of the index. Deliberately not called by
 * `recordMemoryEvent` — see the module header for why a shared rollup on the
 * capture path would reintroduce a lost-update race across `scanPortfolio`'s
 * concurrent workers. Callers are hygiene (`doctor`) and the mirror, both
 * single-threaded.
 *
 * Fail-open: returns a count of 0 rather than throwing when the store is
 * missing or unwritable.
 */
export function rebuildMemoryIndex(): { projects: number } {
  try {
    const dir = memoryDir();
    const records = listProjectMemories();
    const index: MemoryIndexFile = {
      schema_version: MEMORY_SCHEMA_VERSION,
      projects: {},
    };
    for (const record of records) {
      index.projects[record.slug] = toIndexEntry(record);
    }
    fs.mkdirSync(dir, { recursive: true, mode: DIR_MODE });
    atomicWriteJSONFileSync(indexPath(dir), index);
    return { projects: records.length };
  } catch {
    return { projects: 0 };
  }
}

function removeIndexEntrySync(dir: string, projectSlug: string): boolean {
  const index = readIndexFile(dir);
  if (!(projectSlug in index.projects)) return false;
  delete index.projects[projectSlug];
  atomicWriteJSONFileSync(indexPath(dir), index);
  return true;
}

// =============================================================================
// PUBLIC WRITE ENTRY POINT
// =============================================================================

/**
 * The single write entry point. Appends one line to `events.jsonl` and writes
 * `projects/<slug>.json`. It does NOT touch `index.json` — see the module
 * header: a shared rollup on this path would race across `scanPortfolio`'s
 * concurrent workers, which is the defect class this repo just closed.
 *
 * Fail-open: swallows every error. A broken or unwritable memory store must
 * never break a scan or a registry write — see the module header.
 */
export async function recordMemoryEvent(input: RecordMemoryEventInput): Promise<void> {
  if (!memoryEnabled()) return;
  try {
    const dir = memoryDir();
    await fs.promises.mkdir(path.join(dir, PROJECTS_DIRNAME), {
      recursive: true,
      mode: DIR_MODE,
    });

    const resolvedPath = path.resolve(input.projectPath);
    const projectSlug = slug(resolvedPath);
    const ts = input.ts ?? Date.now();
    const summary = sanitizeSummary(input.summary);

    const event: MemoryEvent = {
      ts,
      slug: projectSlug,
      kind: input.kind,
      summary,
      ...(input.detail !== undefined ? { detail: input.detail } : {}),
    };

    await appendEventRecord(dir, event);

    const name = input.name ?? path.basename(resolvedPath);
    writeProjectRecordWithCAS(projectSlug, resolvedPath, name, event);
  } catch {
    // Fail-open by construction — see module header.
  }
}

// =============================================================================
// PUBLIC READ ENTRY POINTS
// =============================================================================

/**
 * All project records, enumerated from `projects/` — the source of truth.
 *
 * Deliberately does NOT consult `index.json`, even as a hint. Since capture no
 * longer maintains the index (see the module header), the index is stale by
 * default: it reflects the last `rebuildMemoryIndex` call, not the store. A
 * reader that trusted it for the slug list would silently omit every project
 * registered since that rebuild — which is precisely the class of "the tool
 * says it's fine and it isn't" failure this store exists to avoid. The
 * directory listing is authoritative and costs one `readdir`.
 */
export function listProjectMemories(): ProjectMemory[] {
  try {
    const dir = memoryDir();
    let slugs: string[];
    try {
      slugs = fs
        .readdirSync(path.join(dir, PROJECTS_DIRNAME))
        .filter((f) => f.endsWith('.json'))
        .map((f) => f.slice(0, -'.json'.length));
    } catch {
      return [];
    }

    const records: ProjectMemory[] = [];
    for (const projectSlug of slugs) {
      const record = readProjectMemoryBySlug(projectSlug);
      if (record) records.push(record);
    }
    return records;
  } catch {
    return [];
  }
}

/**
 * Cross-check memory records against the live registry.
 *
 * Why reconcile on READ instead of emitting `project.removed` on every delete:
 * the dashboard removes projects through `web/lib/server/registry-store.ts`,
 * a SEPARATE compilation unit that cannot import this module. A UI-initiated
 * delete therefore can never emit a removal event, and a write-side mirror
 * would need a fourth hand-maintained twin alongside registry-store,
 * registry-journal, and registry-lock. Deriving the answer at read time needs
 * no web-side code and stays correct no matter which surface performed the
 * delete — including a hand-edited `projects.json`.
 *
 * Pure over the caller's list: this module does not import `src/projects.ts`,
 * so the memory store stays free of a dependency on the registry.
 */
export function reconcileMemory(registeredPaths: string[]): {
  orphaned: ProjectMemory[];
} {
  try {
    const registered = new Set(registeredPaths.map((p) => path.resolve(p)));
    const orphaned = listProjectMemories().filter(
      (record) => record.status !== 'removed' && !registered.has(path.resolve(record.path))
    );
    return { orphaned };
  } catch {
    return { orphaned: [] };
  }
}

function parseEventLine(line: string): MemoryEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed) as MemoryEvent;
    if (
      typeof parsed?.ts !== 'number' ||
      typeof parsed?.slug !== 'string' ||
      typeof parsed?.kind !== 'string'
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null; // Torn or hand-edited line.
  }
}

function readLinesSafe(filePath: string): string[] {
  try {
    return fs.readFileSync(filePath, 'utf-8').split('\n');
  } catch {
    return [];
  }
}

function matchesEventFilter(
  event: MemoryEvent,
  opts: { slug?: string; kind?: MemoryEventKind }
): boolean {
  if (opts.slug && event.slug !== opts.slug) return false;
  if (opts.kind && event.kind !== opts.kind) return false;
  return true;
}

function countEventMatches(
  lines: string[],
  opts: { slug?: string; kind?: MemoryEventKind }
): number {
  let count = 0;
  for (const line of lines) {
    const record = parseEventLine(line);
    if (record && matchesEventFilter(record, opts)) count++;
  }
  return count;
}

/**
 * Read recent events, newest last. A torn final line (a process killed
 * mid-append) is skipped rather than aborting the read — the point of an
 * append-only log is that the intact records stay readable when one is not.
 */
export function readMemoryEvents(
  opts: {
    limit?: number;
    slug?: string;
    kind?: MemoryEventKind;
    includeRotated?: boolean;
  } = {}
): MemoryEvent[] {
  try {
    const dir = memoryDir();
    const limit = opts.limit ?? 50;
    const includeRotated = opts.includeRotated ?? true;

    let lines = readLinesSafe(eventsPath(dir));
    if (includeRotated && countEventMatches(lines, opts) < limit) {
      lines = [...readLinesSafe(rotatedEventsPath(dir)), ...lines];
    }

    const events: MemoryEvent[] = [];
    for (const line of lines) {
      const parsed = parseEventLine(line);
      if (parsed && matchesEventFilter(parsed, opts)) events.push(parsed);
    }
    return events.slice(-limit);
  } catch {
    return [];
  }
}

function dirSizeBytes(dir: string): number {
  let total = 0;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        total += dirSizeBytes(full);
      } else {
        try {
          total += fs.statSync(full).size;
        } catch {
          // Skip an entry that vanished between readdir and stat.
        }
      }
    }
  } catch {
    // Directory unreadable — report zero for this branch rather than throw.
  }
  return total;
}

export function memoryStoreStats(): {
  exists: boolean;
  projects: number;
  events: number;
  bytes: number;
  lastEventAt: number | null;
} {
  try {
    const dir = memoryDir();
    if (!fs.existsSync(dir)) {
      return { exists: false, projects: 0, events: 0, bytes: 0, lastEventAt: null };
    }

    const events = readMemoryEvents({ limit: Number.MAX_SAFE_INTEGER });
    const lastEventAt = events.length > 0 ? events[events.length - 1]!.ts : null;

    let projectsCount = 0;
    try {
      projectsCount = fs
        .readdirSync(path.join(dir, PROJECTS_DIRNAME))
        .filter((f) => f.endsWith('.json')).length;
    } catch {
      projectsCount = 0;
    }

    return {
      exists: true,
      projects: projectsCount,
      events: events.length,
      bytes: dirSizeBytes(dir),
      lastEventAt,
    };
  } catch {
    return { exists: false, projects: 0, events: 0, bytes: 0, lastEventAt: null };
  }
}

/**
 * Hard-delete a project's durable record and drop it from `index.json`.
 *
 * Distinct from a `project.removed` event: that event keeps the record
 * (with `status: 'removed'`) because removal is a fact worth keeping. This
 * function is the hygiene primitive a later chunk's cleanup command uses
 * when the user explicitly asks to forget a project rather than merely
 * unregister it.
 */
export function removeProjectMemory(projectPath: string): boolean {
  try {
    const projectSlug = slug(projectPath);
    const filePath = projectMemoryPath(projectSlug);

    let existed = false;
    try {
      fs.unlinkSync(filePath);
      existed = true;
    } catch {
      existed = false;
    }

    const dir = memoryDir();
    removeIndexEntrySync(dir, projectSlug);

    return existed;
  } catch {
    return false;
  }
}
