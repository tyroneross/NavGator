/**
 * NavGator Registry Operation Journal (web twin)
 *
 * Append-only record of every read and every write of the project registry
 * (`~/.navgator/projects.json`), so a lost update leaves a trace instead of
 * vanishing.
 *
 * Why this exists: the registry has readers and writers in two separate
 * compilation units (the CLI/MCP process and the Next.js dashboard). Each
 * individual write is atomic, but the load-mutate-save *cycle* is not
 * serialized across them, and before this journal existed nothing recorded that
 * an op had happened at all — a dropped registration was indistinguishable from
 * a registration that never occurred.
 *
 * The journal proved its own case within minutes of existing. Reading back the
 * real `~/.navgator` journal over a window when the compare-and-swap was in
 * place but the cross-process lock was not: 9 collisions, 13 registrations
 * silently lost, and ZERO conflict records — because CAS is blind to writers
 * that load the same revision in the same tick. Over the equivalent window
 * after the lock landed: 144 writes, 0 collisions. Reproduce with
 * `node scripts/measure-registry-collisions.mjs`.
 *
 * Bounded by construction:
 *   - Records carry a content digest and an entry-count delta, never payloads.
 *     The registry runs to hundreds of KB; journaling payloads would produce
 *     hundreds of MB.
 *   - Size-based rotation caps the footprint at two generations. The check runs
 *     before every append, so a generation can overshoot by at most one record:
 *     the real bound is 2 x maxBytes + 2 records, and it holds even when the
 *     rotate rename fails persistently, because that path falls back to
 *     truncation rather than giving up on the cap.
 *
 * Fail-open by construction: every entry point swallows its own errors. A
 * broken or unwritable journal must never break a registry operation — the
 * journal is evidence, not a gate.
 *
 * This is the web-side mirror of `src/registry-journal.ts`. The web app
 * compiles separately (own tsconfig, own node_modules, `@/` alias), so the
 * helper lives here rather than importing across the package boundary. Both
 * copies write the SAME on-disk journal file — the record shape, env vars,
 * rotation policy, fail-open policy, actor resolution, digest, and the
 * path-derived-from-registry-dir rule must stay byte-for-byte compatible with
 * `src/registry-journal.ts`. This file is deliberately alias-free (no `@/`
 * imports, no `next/*` imports) so `src/__tests__` can import it directly by
 * relative path — the same constraint `web/lib/server/coverage.ts` documents.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as crypto from "crypto";

// =============================================================================
// TYPES
// =============================================================================

/** Which surface performed the operation. */
export type JournalActor = "cli" | "mcp" | "web-route" | "unknown";

/**
 * `load` covers every read of the registry file, including the compare-and-swap
 * revision re-check (distinguished by `note`). Writes use the op that names the
 * caller's intent so the journal reads as a history of decisions, not of
 * syscalls. `conflict` records a detected lost-update race.
 */
export type JournalOp = "load" | "save" | "register" | "update" | "remove" | "conflict";

export interface RegistryJournalEvent {
  /** Epoch milliseconds. */
  ts: number;
  actor: JournalActor;
  pid: number;
  op: JournalOp;
  /** Revision observed (reads) or written (writes). */
  rev: number;
  /** Project count observed (reads) or resulting (writes). */
  entries: number;
  /** Writes only: change in project count. */
  delta?: number;
  /** Writes only: 16-hex sha256 prefix of the serialized registry. */
  digest?: string;
  /** Conflict only: the revision this writer loaded. */
  base?: number;
  /** Conflict only: the revision found on disk when the writer went to save. */
  found?: number;
  /**
   * Writes only: whether the cross-process file lock was actually held.
   *
   * A positive marker, not just a failure note. Without it a write made while
   * holding the lock and a write from a build that has no lock code at all
   * produce byte-identical records, so a collision found in an old journal
   * cannot be dated to before or after the lock landed — which is exactly the
   * question the journal gets asked.
   */
  locked?: boolean;
  /** Short free-text context. Truncated to NOTE_MAX_CHARS. */
  note?: string;
}

/** What the caller supplies; `ts`, `actor`, and `pid` are filled in here. */
export type JournalEventInput = Omit<RegistryJournalEvent, "ts" | "actor" | "pid"> & {
  actor?: JournalActor;
};

// =============================================================================
// CONSTANTS
// =============================================================================

export const JOURNAL_FILENAME = "registry-journal.jsonl";
export const JOURNAL_ROTATED_FILENAME = "registry-journal.1.jsonl";

/**
 * Conflict records are ALSO written to their own file.
 *
 * The main journal rotates by size, and its volume is dominated by routine
 * `load` records whose rate is set by callers — including unauthenticated HTTP
 * GETs before the loopback guard landed. A flood of worthless reads could
 * otherwise rotate away the handful of `conflict` records the journal exists to
 * produce: the eviction predicate discards the highest-value records alongside
 * the highest-volume ones.
 *
 * Conflicts are rare by construction (each one is a real detected race), so a
 * dedicated file with its own budget holds far more history in far less space,
 * and no amount of read traffic can flush it.
 *
 * Must stay identical to src/registry-journal.ts — both units write these files.
 */
export const CONFLICTS_FILENAME = "registry-conflicts.jsonl";
export const CONFLICTS_ROTATED_FILENAME = "registry-conflicts.1.jsonl";

/**
 * Owner-only. These files record when the user's projects are read and written;
 * on a shared host that is nobody else's business.
 */
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

/**
 * Open the journal WITHOUT following a symlink. A plain append opens through a
 * symlink, so anything that can write to `~/.navgator` could pre-plant the
 * journal path as a link and redirect every append into an arbitrary file.
 * `O_NOFOLLOW` is absent on Windows, where this degrades to a normal append.
 */
const APPEND_FLAGS =
  fs.constants.O_WRONLY |
  fs.constants.O_APPEND |
  fs.constants.O_CREAT |
  (fs.constants.O_NOFOLLOW || 0);

/**
 * Default rotation threshold. At ~150 bytes per record this holds roughly
 * 33,000 operations before rotating, and the two-file cap bounds the total at
 * ~10 MB regardless of how long the journal runs.
 */
export const DEFAULT_MAX_BYTES = 5_000_000;

/** Notes are context, not payload. Anything longer is a payload in disguise. */
const NOTE_MAX_CHARS = 120;

// =============================================================================
// CONFIGURATION
// =============================================================================

/** Journaling is on by default; `NAVGATOR_REGISTRY_JOURNAL=0` turns it off. */
export function journalEnabled(): boolean {
  const raw = process.env.NAVGATOR_REGISTRY_JOURNAL;
  if (raw === undefined) return true;
  return raw !== "0" && raw.toLowerCase() !== "false";
}

function maxBytes(): number {
  const raw = process.env.NAVGATOR_REGISTRY_JOURNAL_MAX_BYTES;
  if (!raw) return DEFAULT_MAX_BYTES;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_BYTES;
}

/**
 * The default registry directory. Resolved through `os.homedir()`, which
 * honours `$HOME` on POSIX — the same resolution `src/projects.ts` uses, so a
 * test that redirects HOME redirects the journal with it.
 */
export function defaultRegistryDir(): string {
  return path.join(os.homedir(), ".navgator");
}

/**
 * Journal path derived from whichever directory holds the registry being
 * operated on — NOT hardcoded to the home directory.
 *
 * This is what keeps a test that points a reader at a tmp registry (see
 * `loadRegisteredProjectPaths`, which takes an arbitrary `registryPath`) from
 * appending to the user's real journal.
 */
export function journalPathForDir(dir: string): string {
  return path.join(dir, JOURNAL_FILENAME);
}

/** Path of the dedicated conflict log for a registry directory. */
export function conflictsPathForDir(dir: string): string {
  return path.join(dir, CONFLICTS_FILENAME);
}

/** Journal path for a registry *file* path. */
export function journalPathForRegistry(registryPath: string): string {
  return journalPathForDir(path.dirname(registryPath));
}

// =============================================================================
// ACTOR DETECTION
// =============================================================================

let cachedActor: JournalActor | null = null;

/**
 * Resolve which surface we are. `NAVGATOR_JOURNAL_ACTOR` wins so the MCP server
 * and the dashboard can declare themselves explicitly; otherwise this
 * compilation unit defaults to `web-route` (unlike the CLI twin, which infers
 * `cli`/`mcp` from the entry script — there is only one entry surface here).
 *
 * Not cached when the env var is set, so a test can flip actors without a
 * module reload.
 */
export function resolveActor(): JournalActor {
  const declared = process.env.NAVGATOR_JOURNAL_ACTOR;
  if (declared === "cli" || declared === "mcp" || declared === "web-route") {
    return declared;
  }
  if (cachedActor) return cachedActor;

  cachedActor = "web-route";
  return cachedActor;
}

/** Test seam: forget a previously detected actor. */
export function resetActorCache(): void {
  cachedActor = null;
}

// =============================================================================
// DIGEST
// =============================================================================

/**
 * 16-hex sha256 prefix of a registry's serialized form. Enough to answer "did
 * this write land the content I built?" across ~33k journal records without
 * storing any of the content itself.
 */
export function registryDigest(value: unknown): string {
  try {
    return crypto
      .createHash("sha256")
      .update(JSON.stringify(value) ?? "")
      .digest("hex")
      .slice(0, 16);
  } catch {
    return "undigestable";
  }
}

// =============================================================================
// ROTATION
// =============================================================================

/**
 * Rotate when the journal has reached the threshold. One generation only: the
 * previous rotation is replaced, so the journal can never grow past
 * 2 x maxBytes no matter how long NavGator runs.
 */
function rotateIfNeededSync(journalPath: string, rotatedName: string): void {
  let size: number;
  try {
    size = fs.statSync(journalPath).size;
  } catch {
    return; // No journal yet — nothing to rotate.
  }
  if (size < maxBytes()) return;

  const rotated = path.join(path.dirname(journalPath), rotatedName);
  try {
    fs.renameSync(journalPath, rotated);
    return;
  } catch {
    // Fall through to the truncate fallback below.
  }

  // The rename can fail persistently — an immutable or permission-denied
  // rotated destination, or a Windows sharing lock held by a second NavGator
  // process. Swallowing that and appending anyway would silently retire the
  // size cap for the life of the process and let the live file grow without
  // limit, which is the one thing this function exists to prevent.
  try {
    fs.truncateSync(journalPath, 0);
  } catch {
    // Both paths failed. Appending is still better than losing the record.
  }
}

/**
 * Append one line via an explicit open/write/close.
 *
 * `appendFileSync`'s typings only accept a string flag, and the numeric flag is
 * the point here — it is what carries `O_NOFOLLOW`. `O_APPEND` still makes each
 * small write a single atomic append, so concurrent writers interleave whole
 * lines rather than shredding each other's.
 */
function appendLineSync(filePath: string, line: string): void {
  const fd = fs.openSync(filePath, APPEND_FLAGS, FILE_MODE);
  try {
    fs.writeSync(fd, line);
  } finally {
    fs.closeSync(fd);
  }
}

async function appendLine(filePath: string, line: string): Promise<void> {
  const handle = await fs.promises.open(filePath, APPEND_FLAGS, FILE_MODE);
  try {
    await handle.write(line);
  } finally {
    await handle.close();
  }
}

/**
 * Strip control characters from a note. Every note in the tree today is an
 * internal literal, but the moment untrusted text reaches this field a reader
 * like `navgator registry-log` becomes an ANSI/OSC escape sink. Neutralizing at
 * write time keeps the stored record safe regardless of who renders it.
 */
function sanitizeNote(note: string): string {
  // eslint-disable-next-line no-control-regex
  return note.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").slice(0, NOTE_MAX_CHARS);
}

// =============================================================================
// APPEND
// =============================================================================

function buildRecord(input: JournalEventInput): RegistryJournalEvent {
  const event: RegistryJournalEvent = {
    ts: Date.now(),
    actor: input.actor ?? resolveActor(),
    pid: process.pid,
    op: input.op,
    rev: input.rev,
    entries: input.entries,
  };
  if (input.delta !== undefined) event.delta = input.delta;
  if (input.digest !== undefined) event.digest = input.digest;
  if (input.locked !== undefined) event.locked = input.locked;
  if (input.base !== undefined) event.base = input.base;
  if (input.found !== undefined) event.found = input.found;
  if (input.note !== undefined) event.note = sanitizeNote(input.note);
  return event;
}

/**
 * Append one record, synchronously.
 *
 * `appendFileSync` with the default `'a'` flag issues a single O_APPEND write.
 * For a record this small that is atomic against concurrent appenders on both
 * Linux and macOS, which is why interleaved writers from several processes
 * produce whole lines rather than shredded ones.
 *
 * Errors are swallowed deliberately — see the module comment.
 */
export function appendJournalEventSync(dir: string, input: JournalEventInput): void {
  if (!journalEnabled()) return;
  try {
    const record = buildRecord(input);
    const line = JSON.stringify(record) + "\n";
    fs.mkdirSync(dir, { recursive: true, mode: DIR_MODE });

    const journalPath = journalPathForDir(dir);
    rotateIfNeededSync(journalPath, JOURNAL_ROTATED_FILENAME);
    appendLineSync(journalPath, line);

    if (record.op === "conflict") {
      const conflictsPath = conflictsPathForDir(dir);
      rotateIfNeededSync(conflictsPath, CONFLICTS_ROTATED_FILENAME);
      appendLineSync(conflictsPath, line);
    }
  } catch {
    // Fail-open.
  }
}

/**
 * Append one record without blocking the event loop.
 *
 * Resolves even on failure, so `await` at a call site can never turn a journal
 * problem into a registry problem.
 */
export async function appendJournalEvent(dir: string, input: JournalEventInput): Promise<void> {
  if (!journalEnabled()) return;
  try {
    const record = buildRecord(input);
    const line = JSON.stringify(record) + "\n";
    await fs.promises.mkdir(dir, { recursive: true, mode: DIR_MODE });

    const journalPath = journalPathForDir(dir);
    rotateIfNeededSync(journalPath, JOURNAL_ROTATED_FILENAME);
    await appendLine(journalPath, line);

    // A conflict is the record this whole subsystem exists to produce. It goes
    // to the dedicated log as well, where routine read volume cannot rotate it
    // away.
    if (record.op === "conflict") {
      const conflictsPath = conflictsPathForDir(dir);
      rotateIfNeededSync(conflictsPath, CONFLICTS_ROTATED_FILENAME);
      await appendLine(conflictsPath, line);
    }
  } catch {
    // Fail-open.
  }
}

// =============================================================================
// READ
// =============================================================================

export interface ReadJournalOptions {
  /** Registry directory. Defaults to `~/.navgator`. */
  dir?: string;
  /** Most recent N records. Default 50. */
  limit?: number;
  /** Only records from this actor. */
  actor?: JournalActor;
  /** Only records with this op. */
  op?: JournalOp;
  /** Only `conflict` records. Overrides `op`. */
  conflictsOnly?: boolean;
  /** Include the rotated generation when the live file is short. Default true. */
  includeRotated?: boolean;
}

function readLines(filePath: string): string[] {
  try {
    return fs.readFileSync(filePath, "utf-8").split("\n");
  } catch {
    return [];
  }
}

/**
 * Read recent journal records, newest last.
 *
 * A truncated final line (a process killed mid-append) is skipped rather than
 * throwing — the point of an append-only log is that the intact records stay
 * readable when one is not.
 */
export function readJournal(options: ReadJournalOptions = {}): RegistryJournalEvent[] {
  const dir = options.dir ?? defaultRegistryDir();
  const limit = options.limit ?? 50;
  const includeRotated = options.includeRotated ?? true;

  const journalPath = journalPathForDir(dir);
  let lines = readLines(journalPath);

  if (includeRotated && lines.filter((l) => l.trim()).length < limit) {
    const rotated = path.join(dir, JOURNAL_ROTATED_FILENAME);
    lines = [...readLines(rotated), ...lines];
  }

  const events: RegistryJournalEvent[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as RegistryJournalEvent;
      if (typeof parsed?.op !== "string" || typeof parsed?.ts !== "number") continue;
      events.push(parsed);
    } catch {
      continue; // Torn or hand-edited line.
    }
  }

  const filtered = events.filter((e) => {
    if (options.conflictsOnly) return e.op === "conflict";
    if (options.op && e.op !== options.op) return false;
    if (options.actor && e.actor !== options.actor) return false;
    return true;
  });

  return filtered.slice(-limit);
}
