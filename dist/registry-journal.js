/**
 * NavGator Registry Operation Journal
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
 * This module is mirrored at `web/lib/server/registry-journal.ts` because the
 * web app compiles separately (own tsconfig, own node_modules, `@/` alias).
 * The two copies are held to one contract by
 * `src/__tests__/registry-concurrency-oracle.test.ts`, the same arrangement
 * `web/lib/server/atomic-write.ts` uses.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
// =============================================================================
// CONSTANTS
// =============================================================================
export const JOURNAL_FILENAME = 'registry-journal.jsonl';
export const JOURNAL_ROTATED_FILENAME = 'registry-journal.1.jsonl';
/**
 * Conflict records are ALSO written to their own file.
 *
 * The main journal rotates by size, and its volume is dominated by routine
 * `load` records whose rate is set by callers — including, before the loopback
 * guard landed, unauthenticated HTTP GETs. That means a flood of worthless
 * reads could rotate away the handful of `conflict` records the journal exists
 * to produce: the eviction predicate discards the highest-value records
 * alongside the highest-volume ones.
 *
 * Conflicts are rare by construction (each one is a real detected race), so a
 * dedicated file with its own budget holds far more history in far less space,
 * and no amount of read traffic can flush it.
 */
export const CONFLICTS_FILENAME = 'registry-conflicts.jsonl';
export const CONFLICTS_ROTATED_FILENAME = 'registry-conflicts.1.jsonl';
/**
 * Owner-only. These files record when the user's projects are read and written;
 * on a shared host that is nobody else's business.
 */
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;
/**
 * Open the journal WITHOUT following a symlink.
 *
 * A plain append opens through a symlink, so anything that can write to
 * `~/.navgator` could pre-plant the journal path as a link and redirect every
 * append into an arbitrary file. The neighbouring `atomicWriteJSON` is already
 * symlink-safe at its destination by virtue of temp+rename; this brings the
 * append path to the same posture. `O_NOFOLLOW` is absent on Windows, where
 * this degrades to a normal append.
 */
const APPEND_FLAGS = fs.constants.O_WRONLY |
    fs.constants.O_APPEND |
    fs.constants.O_CREAT |
    (fs.constants.O_NOFOLLOW || 0);
/**
 * Default rotation threshold.
 *
 * Records measure 110-140 bytes, so this holds roughly 40,000 RECORDS. That is
 * not the same as 40,000 operations: one registry write emits about three
 * records (the caller's load, the compare-and-swap re-read, and the write
 * itself), so the practical capacity is ~13,000 operations before the live
 * generation rotates.
 */
export const DEFAULT_MAX_BYTES = 5_000_000;
/** Notes are context, not payload. Anything longer is a payload in disguise. */
const NOTE_MAX_CHARS = 120;
// =============================================================================
// CONFIGURATION
// =============================================================================
/** Journaling is on by default; `NAVGATOR_REGISTRY_JOURNAL=0` turns it off. */
export function journalEnabled() {
    const raw = process.env.NAVGATOR_REGISTRY_JOURNAL;
    if (raw === undefined)
        return true;
    return raw !== '0' && raw.toLowerCase() !== 'false';
}
function maxBytes() {
    const raw = process.env.NAVGATOR_REGISTRY_JOURNAL_MAX_BYTES;
    if (!raw)
        return DEFAULT_MAX_BYTES;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_BYTES;
}
/**
 * The default registry directory. Resolved through `os.homedir()`, which
 * honours `$HOME` on POSIX — the same resolution `src/projects.ts` uses, so a
 * test that redirects HOME redirects the journal with it.
 */
export function defaultRegistryDir() {
    return path.join(os.homedir(), '.navgator');
}
/**
 * Journal path derived from whichever directory holds the registry being
 * operated on — NOT hardcoded to the home directory.
 *
 * This is what keeps a test that points a reader at a tmp registry (see
 * `loadRegisteredProjectPaths`, which takes an arbitrary `registryPath`) from
 * appending to the user's real journal.
 */
export function journalPathForDir(dir) {
    return path.join(dir, JOURNAL_FILENAME);
}
/** Path of the dedicated conflict log for a registry directory. */
export function conflictsPathForDir(dir) {
    return path.join(dir, CONFLICTS_FILENAME);
}
/** Journal path for a registry *file* path. */
export function journalPathForRegistry(registryPath) {
    return journalPathForDir(path.dirname(registryPath));
}
// =============================================================================
// ACTOR DETECTION
// =============================================================================
let cachedActor = null;
/**
 * Resolve which surface we are. `NAVGATOR_JOURNAL_ACTOR` wins so the MCP server
 * and the dashboard can declare themselves explicitly; otherwise the entry
 * script name decides.
 *
 * Not cached when the env var is set, so a test can flip actors without a
 * module reload.
 */
export function resolveActor() {
    const declared = process.env.NAVGATOR_JOURNAL_ACTOR;
    if (declared === 'cli' || declared === 'mcp' || declared === 'web-route') {
        return declared;
    }
    if (cachedActor)
        return cachedActor;
    const entry = (process.argv[1] || '').replace(/\\/g, '/');
    let actor = 'unknown';
    if (/\/mcp\/server(\.[cm]?js|\.ts)?$/.test(entry)) {
        actor = 'mcp';
    }
    else if (entry) {
        actor = 'cli';
    }
    cachedActor = actor;
    return actor;
}
/** Test seam: forget a previously detected actor. */
export function resetActorCache() {
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
export function registryDigest(value) {
    try {
        return crypto
            .createHash('sha256')
            .update(JSON.stringify(value) ?? '')
            .digest('hex')
            .slice(0, 16);
    }
    catch {
        return 'undigestable';
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
function rotateIfNeededSync(journalPath, rotatedName) {
    let size;
    try {
        size = fs.statSync(journalPath).size;
    }
    catch {
        return; // No journal yet — nothing to rotate.
    }
    if (size < maxBytes())
        return;
    const rotated = path.join(path.dirname(journalPath), rotatedName);
    try {
        fs.renameSync(journalPath, rotated);
        return;
    }
    catch {
        // Fall through to the truncate fallback below.
    }
    // The rename can fail persistently — an immutable or permission-denied
    // rotated destination, or a Windows sharing lock held by a second NavGator
    // process. Swallowing that error and appending anyway would silently retire
    // the size cap for the life of the process and let the live file grow without
    // limit, which is the one thing this function exists to prevent. Truncating
    // costs the older half of the history but keeps the bound real.
    try {
        fs.truncateSync(journalPath, 0);
    }
    catch {
        // Both paths failed. Appending is still better than losing the record.
    }
}
// =============================================================================
// APPEND
// =============================================================================
/**
 * Strip control characters from a note.
 *
 * Every note in the tree today is an internal literal, so nothing untrusted
 * reaches this field yet. That invariant is one commit from breaking — the
 * adjacent error path already interpolates a project path and a raw error
 * message into a log line — and the moment it does, `navgator registry-log`
 * becomes an ANSI/OSC escape sink for whatever text got in. Neutralizing at
 * write time means the stored record is safe regardless of who renders it.
 */
function sanitizeNote(note) {
    // eslint-disable-next-line no-control-regex
    return note.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').slice(0, NOTE_MAX_CHARS);
}
function buildRecord(input) {
    const event = {
        ts: Date.now(),
        actor: input.actor ?? resolveActor(),
        pid: process.pid,
        op: input.op,
        rev: input.rev,
        entries: input.entries,
    };
    if (input.delta !== undefined)
        event.delta = input.delta;
    if (input.digest !== undefined)
        event.digest = input.digest;
    if (input.locked !== undefined)
        event.locked = input.locked;
    if (input.base !== undefined)
        event.base = input.base;
    if (input.found !== undefined)
        event.found = input.found;
    if (input.note !== undefined)
        event.note = sanitizeNote(input.note);
    return event;
}
/**
 * Append one line via an explicit open/write/close.
 *
 * `appendFileSync`'s typings only accept a string flag, and the numeric flag is
 * the point here — it is what carries `O_NOFOLLOW`. Opening directly keeps the
 * symlink guard and the 0600 creation mode without lying to the type system.
 * `O_APPEND` still makes each small write a single atomic append, so concurrent
 * writers interleave whole lines rather than shredding each other's.
 */
function appendLineSync(filePath, line) {
    const fd = fs.openSync(filePath, APPEND_FLAGS, FILE_MODE);
    try {
        fs.writeSync(fd, line);
    }
    finally {
        fs.closeSync(fd);
    }
}
async function appendLine(filePath, line) {
    const handle = await fs.promises.open(filePath, APPEND_FLAGS, FILE_MODE);
    try {
        await handle.write(line);
    }
    finally {
        await handle.close();
    }
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
export function appendJournalEventSync(dir, input) {
    if (!journalEnabled())
        return;
    try {
        const record = buildRecord(input);
        const line = JSON.stringify(record) + '\n';
        fs.mkdirSync(dir, { recursive: true, mode: DIR_MODE });
        const journalPath = journalPathForDir(dir);
        rotateIfNeededSync(journalPath, JOURNAL_ROTATED_FILENAME);
        appendLineSync(journalPath, line);
        if (record.op === 'conflict') {
            const conflictsPath = conflictsPathForDir(dir);
            rotateIfNeededSync(conflictsPath, CONFLICTS_ROTATED_FILENAME);
            appendLineSync(conflictsPath, line);
        }
    }
    catch {
        // Fail-open.
    }
}
/**
 * Append one record without blocking the event loop.
 *
 * Resolves even on failure, so `await` at a call site can never turn a journal
 * problem into a registry problem.
 */
export async function appendJournalEvent(dir, input) {
    if (!journalEnabled())
        return;
    try {
        const record = buildRecord(input);
        const line = JSON.stringify(record) + '\n';
        await fs.promises.mkdir(dir, { recursive: true, mode: DIR_MODE });
        const journalPath = journalPathForDir(dir);
        rotateIfNeededSync(journalPath, JOURNAL_ROTATED_FILENAME);
        await appendLine(journalPath, line);
        // A conflict is the record this whole subsystem exists to produce. It goes
        // to the dedicated log as well, where routine read volume cannot rotate it
        // away.
        if (record.op === 'conflict') {
            const conflictsPath = conflictsPathForDir(dir);
            rotateIfNeededSync(conflictsPath, CONFLICTS_ROTATED_FILENAME);
            await appendLine(conflictsPath, line);
        }
    }
    catch {
        // Fail-open.
    }
}
/** Parse a line into a record, or null when it is torn / not a journal record. */
function parseRecord(line) {
    const trimmed = line.trim();
    if (!trimmed)
        return null;
    try {
        const parsed = JSON.parse(trimmed);
        if (typeof parsed?.op !== 'string' || typeof parsed?.ts !== 'number')
            return null;
        return parsed;
    }
    catch {
        return null; // Torn or hand-edited line.
    }
}
function matchesFilter(event, options) {
    if (options.conflictsOnly)
        return event.op === 'conflict';
    if (options.op && event.op !== options.op)
        return false;
    if (options.actor && event.actor !== options.actor)
        return false;
    return true;
}
function matchCount(lines, options) {
    let count = 0;
    for (const line of lines) {
        const record = parseRecord(line);
        if (record && matchesFilter(record, options))
            count++;
    }
    return count;
}
function readLines(filePath) {
    try {
        return fs.readFileSync(filePath, 'utf-8').split('\n');
    }
    catch {
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
export function readJournal(options = {}) {
    const dir = options.dir ?? defaultRegistryDir();
    const limit = options.limit ?? 50;
    const includeRotated = options.includeRotated ?? true;
    // Conflicts are read from their own log, which routine `load` volume cannot
    // rotate away — so `--conflicts` still answers "has this registry ever lost a
    // race" long after the main journal has cycled.
    const livePath = options.conflictsOnly ? conflictsPathForDir(dir) : journalPathForDir(dir);
    const rotatedName = options.conflictsOnly
        ? CONFLICTS_ROTATED_FILENAME
        : JOURNAL_ROTATED_FILENAME;
    // Read the rotated generation when the LIVE file cannot satisfy the limit
    // after filtering. Gating on raw line count instead would make
    // `registry-log --conflicts` skip the rotated file whenever the live one held
    // `limit` lines of routine traffic — silently hiding the history the user
    // asked for.
    let lines = readLines(livePath);
    if (includeRotated && matchCount(lines, options) < limit) {
        lines = [...readLines(path.join(dir, rotatedName)), ...lines];
    }
    const filtered = [];
    for (const line of lines) {
        const record = parseRecord(line);
        if (record && matchesFilter(record, options))
            filtered.push(record);
    }
    return filtered.slice(-limit);
}
// =============================================================================
// FORMATTING
// =============================================================================
function pad(value, width) {
    return value.length >= width ? value : value + ' '.repeat(width - value.length);
}
/** Human-readable rendering for `navgator registry-log`. */
export function formatJournal(events, options = {}) {
    if (events.length === 0) {
        // "The journal is empty" and "nothing matched your filter" are different
        // facts, and reporting the first when the second is true tells the user the
        // journal is not working. `--conflicts` on a healthy registry hits this.
        return options.filtered
            ? 'No registry journal entries match that filter. Run `navgator registry-log` with no filters to see recent activity.'
            : 'No registry journal entries yet. The journal records every read and write of ~/.navgator/projects.json.';
    }
    const lines = [];
    lines.push('Registry Journal');
    lines.push('─'.repeat(88));
    lines.push(`${pad('TIME', 20)}${pad('ACTOR', 11)}${pad('PID', 8)}${pad('OP', 10)}${pad('REV', 7)}${pad('ENTRIES', 9)}DETAIL`);
    for (const e of events) {
        const time = new Date(e.ts).toISOString().replace('T', ' ').slice(0, 19);
        const detail = [];
        if (e.delta !== undefined && e.delta !== 0) {
            detail.push(`${e.delta > 0 ? '+' : ''}${e.delta}`);
        }
        if (e.op === 'conflict') {
            detail.push(`base ${e.base} != disk ${e.found}`);
        }
        if (e.digest)
            detail.push(e.digest);
        if (e.note)
            detail.push(e.note);
        lines.push(`${pad(time, 20)}${pad(e.actor, 11)}${pad(String(e.pid), 8)}${pad(e.op, 10)}${pad(String(e.rev), 7)}${pad(String(e.entries), 9)}${detail.join('  ')}`);
    }
    const conflicts = events.filter((e) => e.op === 'conflict').length;
    lines.push('─'.repeat(88));
    if (conflicts > 0) {
        lines.push(`${events.length} entries, ${conflicts} lost-update conflict${conflicts === 1 ? '' : 's'} detected and merged.`);
    }
    else if (options.filtered) {
        // "No conflicts" would be a claim about the whole journal, and this is a
        // filtered slice of it. `--op register` must not report the registry clean.
        lines.push(`${events.length} entries matching the filter.`);
    }
    else {
        lines.push(`${events.length} entries, no lost-update conflicts detected.`);
    }
    return lines.join('\n');
}
//# sourceMappingURL=registry-journal.js.map