/**
 * gator-memory / registry hygiene — the single health computation behind
 * `navgator doctor`.
 *
 * Why one module: the CLI (`src/cli/commands/doctor.ts`) and the dashboard
 * (`web/app/api/registry-health/route.ts`, via the shipped `--json` CLI
 * output) both need EXACTLY the same numbers. Computing them twice — once in
 * the CLI's formatter, once in a hypothetical web-side reimplementation —
 * would let the two drift the moment either side changed a filter or a
 * threshold. `computeHealth()` is therefore the only place that reads the
 * registry, the journal, gator-memory, and the mirror config and turns them
 * into a verdict; `doctor.ts` only renders what this returns.
 *
 * The output shape is FROZEN: `web/app/api/registry-health/route.ts` and
 * `web/lib/types.ts`'s `RegistryHealthReport` are already shipped against it.
 * Do not rename, add, or reorder top-level fields without updating both.
 *
 * `isTmpRootedPath` decides what `doctor --fix` is allowed to delete, so it
 * is exported and tested independently of everything else in this module —
 * see its own header for the three properties that make it safe.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { loadRegistry } from '../projects.js';
import { readJournal, defaultRegistryDir } from '../registry-journal.js';
import { memoryStoreStats, reconcileMemory } from './store.js';
import { mirrorStatus } from './mirror.js';
// =============================================================================
// SCHEMA
// =============================================================================
/** Frozen contract version — see the module header. Semver; only a MAJOR bump
 * signals a shape the dashboard doesn't understand (see the route's own
 * `SUPPORTED_SCHEMA_MAJOR` check). */
export const HEALTH_SCHEMA_VERSION = '1.0.0';
// =============================================================================
// TMP-ROOT PREDICATE
// =============================================================================
const TMP_ROOT_LITERALS = ['/tmp', '/var/folders', '/private/var/folders'];
/**
 * The set of known tmp roots, in BOTH their plain-resolved spelling and
 * their realpath-resolved (symlink-free) spelling. Computed fresh per call
 * (never cached at module scope) because `os.tmpdir()` honours `TMPDIR` at
 * call time, and a cached value would go stale the moment a test — or a
 * future caller — changes it.
 *
 * Both spellings matter, not just the realpath one. `isTmpRootedPath` only
 * realpaths its TARGET when the target still exists (see that function's own
 * comment on why a missing path is exactly the case this predicate must
 * still classify correctly). A missing target therefore keeps whatever
 * spelling was registered — on macOS that is routinely the `/var/folders/...`
 * form `os.tmpdir()` returns, NOT the `/private/var/folders/...` form
 * `fs.realpathSync` would report. If this function only emitted the
 * realpath'd root, a missing entry spelled the plain way would fail to match
 * ANY root and silently be classified as not tmp-rooted — the false
 * negative that would leave a vanished temp fixture stuck in the registry
 * forever. Emitting both spellings is what makes the match work regardless
 * of which one the target happened to keep.
 */
function tmpRootCandidates() {
    const candidates = [os.tmpdir(), ...TMP_ROOT_LITERALS];
    const roots = new Set();
    for (const candidate of candidates) {
        const resolved = path.resolve(candidate);
        roots.add(resolved);
        try {
            if (fs.existsSync(resolved))
                roots.add(fs.realpathSync(resolved));
        }
        catch {
            // Root candidate unreadable — the plain-resolved form already added
            // above is still a usable comparison target.
        }
    }
    return [...roots];
}
/**
 * Is `targetPath` rooted under a known temp directory?
 *
 * This decides what `doctor --fix` is allowed to delete, so it is exported
 * and separately tested (`src/__tests__/doctor.test.ts`) rather than inlined
 * into the cleanup path. Three properties, each closing a real failure mode:
 *
 *   1. Realpath comparison, not lexical prefix matching. macOS resolves both
 *      `os.tmpdir()` and the literal `/var/folders` through a
 *      `/var` -> `/private/var` symlink, so a project whose registered path
 *      is spelled `/var/folders/...` and one spelled
 *      `/private/var/folders/...` must compare equal — a plain
 *      `startsWith('/var/folders')` check would treat them as different
 *      directories and either over- or under-prune depending on which
 *      spelling got registered.
 *   2. Falls back to a plain resolved-path prefix check when `targetPath`
 *      itself no longer exists (`fs.realpathSync` throws on a missing path).
 *      A MISSING tmp-rooted entry is exactly the case `--fix` exists to
 *      prune — refusing to classify it because it can no longer be
 *      realpath'd would defeat the feature for its primary use case.
 *   3. A real, existing project whose NAME merely contains the substring
 *      "tmp" (e.g. `/repos/my-tmp-tool`) is never tmp-rooted: the check is a
 *      directory-boundary prefix match (`root + path.sep`, or exact
 *      equality) against the REAL tmp roots, never a substring match against
 *      the path text.
 */
export function isTmpRootedPath(targetPath) {
    const resolvedTarget = path.resolve(targetPath);
    let realTarget;
    try {
        realTarget = fs.existsSync(resolvedTarget) ? fs.realpathSync(resolvedTarget) : resolvedTarget;
    }
    catch {
        realTarget = resolvedTarget;
    }
    return tmpRootCandidates().some((root) => realTarget === root || realTarget.startsWith(root + path.sep));
}
/** Classify every registry entry once. Both the report's counts and
 * `--fix`'s deletion list are derived from this, so they can never disagree
 * about which entries are which. */
export function classifyRegistryEntries(entries) {
    return entries.map((entry) => {
        const tmpRooted = isTmpRootedPath(entry.path);
        const missing = !fs.existsSync(entry.path);
        return { path: entry.path, name: entry.name, tmpRooted, missing, prunable: tmpRooted && missing };
    });
}
/**
 * The entries `--fix` will actually remove. Default: tmp-rooted AND missing
 * (the safe, conservative set — a temp fixture that vanished on its own).
 * `includeMissing: true` widens this to ANY missing path, which is opt-in
 * because a project on an unmounted volume or an external drive is missing
 * but real, and pruning it by default would be a silent data-loss surprise.
 */
export function selectPrunableEntries(classifications, opts = {}) {
    return opts.includeMissing
        ? classifications.filter((c) => c.missing)
        : classifications.filter((c) => c.prunable);
}
// =============================================================================
// JOURNAL GROWTH / RELIABILITY STATS
// =============================================================================
/**
 * Large enough to read the ENTIRE retained journal window (live generation
 * plus the one rotated generation `readJournal` falls back to), not an
 * arbitrary recent slice — the growth-rate finding must be honest about the
 * full window it estimates over. `registry-journal.ts`'s own header sizes one
 * generation at roughly 40,000 records, so this comfortably covers both.
 */
const JOURNAL_READ_LIMIT = 200_000;
/**
 * Shortest retained window that can support a per-DAY rate.
 *
 * Extrapolating a daily figure from a couple of hours is not an estimate, it
 * is an artifact. Measured on the real registry before this guard existed: a
 * 0.10-day window holding 323 `register` records reported "≈3222.9 new
 * entries/day" and raised a `warn` — on a registry with 2 entries and nothing
 * prunable. The registry was perfectly healthy; the arithmetic was not.
 *
 * That is the noisy-gate failure mode, and it is worse than having no growth
 * signal at all: a user who is shown an alarming number on a clean registry
 * learns to ignore the verdict, which also disarms the findings that are real.
 * Below this threshold we report no rate and raise no finding — "not enough
 * history yet" is the honest answer, and the journal rotating is exactly why
 * the window can be short.
 */
const MIN_RATE_WINDOW_DAYS = 1;
function computeJournalStats(records) {
    const conflicts = records.filter((r) => r.op === 'conflict').length;
    // `locked` is only ever populated on WRITE records (register/update/remove/
    // save — see `writeRegistry` in `src/projects.ts`). Testing `=== false`
    // rather than falsy/undefined is what isolates "the cross-process lock
    // genuinely was not held" from "this is a `load` record with no `locked`
    // field at all".
    const degradedWrites = records.filter((r) => r.locked === false).length;
    if (records.length === 0) {
        return {
            records: 0,
            windowDays: 0,
            registersInWindow: 0,
            registersPerDay: 0,
            insufficientWindow: true,
            conflicts,
            degradedWrites,
        };
    }
    // `readJournal` returns newest-last (see its own header), so the first and
    // last elements bound the retained window.
    const oldest = records[0];
    const newest = records[records.length - 1];
    const windowDays = (newest.ts - oldest.ts) / 86_400_000;
    const registersInWindow = records.filter((r) => r.op === 'register' && (r.delta ?? 0) > 0).length;
    // A window shorter than MIN_RATE_WINDOW_DAYS cannot support a per-day rate
    // (see that constant for the measured false positive this prevents). This
    // also subsumes the divide-by-zero case: a single-record or
    // same-millisecond window has no elapsed time to divide by, and a rate over
    // zero elapsed time is not an approximation of one.
    const insufficientWindow = windowDays < MIN_RATE_WINDOW_DAYS;
    const registersPerDay = insufficientWindow ? 0 : registersInWindow / windowDays;
    return {
        records: records.length,
        windowDays,
        registersInWindow,
        registersPerDay,
        insufficientWindow,
        conflicts,
        degradedWrites,
    };
}
// =============================================================================
// FINDINGS
// =============================================================================
function buildFindings(report) {
    const { registry, journal, memory, mirror } = report;
    const findings = [];
    if (registry.prunable > 0) {
        findings.push({
            severity: 'warn',
            code: 'registry-prunable',
            message: `${registry.prunable} ${registry.prunable === 1 ? 'entry points' : 'entries point'} at temp ` +
                `directories that no longer exist. Run \`navgator doctor --fix\` to remove ` +
                `${registry.prunable === 1 ? 'it' : 'them'}.`,
        });
    }
    // Real paths gone, but NOT tmp fixtures — never auto-pruned by default, so
    // this is informational rather than a call to action `--fix` alone
    // resolves.
    const realMissing = registry.missing - registry.prunable;
    if (realMissing > 0) {
        findings.push({
            severity: 'info',
            code: 'registry-missing',
            message: `${realMissing} registered ${realMissing === 1 ? 'project path is' : 'project paths are'} no ` +
                `longer present on disk. ${realMissing === 1 ? "It isn't" : "They aren't"} a temp fixture, so ` +
                `${realMissing === 1 ? "it's" : "they're"} never pruned automatically — run ` +
                `\`navgator doctor --fix --include-missing\` if you want ${realMissing === 1 ? 'it' : 'them'} removed.`,
        });
    }
    // Gated on `insufficientWindow` as well as the threshold. A short window can
    // manufacture an arbitrarily large rate out of ordinary activity, and a warn
    // raised on that arithmetic would be a false positive on a healthy registry
    // — see MIN_RATE_WINDOW_DAYS for the measured case.
    if (!journal.insufficientWindow && journal.registersPerDay >= 5) {
        findings.push({
            severity: 'warn',
            code: 'registry-growth',
            message: `≈${journal.registersPerDay.toFixed(1)} new entries/day, estimated over the last ` +
                `${journal.windowDays.toFixed(1)} days of retained journal. Run \`navgator doctor --fix\` ` +
                `regularly to keep the registry from accumulating temp fixtures.`,
        });
    }
    if (journal.conflicts > 0) {
        findings.push({
            severity: 'info',
            code: 'registry-conflicts',
            message: `${journal.conflicts} lost-update ${journal.conflicts === 1 ? 'conflict was' : 'conflicts were'} ` +
                `detected and merged within the retained journal window. Expected under concurrent writers — ` +
                `see \`navgator registry-log --conflicts\` for detail.`,
        });
    }
    if (journal.degradedWrites > 0) {
        findings.push({
            severity: 'warn',
            code: 'registry-degraded-writes',
            message: `${journal.degradedWrites} registry ${journal.degradedWrites === 1 ? 'write' : 'writes'} completed ` +
                `without the cross-process file lock held, widening the race window for a lost update. Check for ` +
                `a stale lock file under ~/.navgator.`,
        });
    }
    if (memory.orphaned > 0) {
        findings.push({
            severity: 'info',
            code: 'memory-orphaned',
            message: `${memory.orphaned} gator-memory ${memory.orphaned === 1 ? 'record refers' : 'records refer'} to a ` +
                `project no longer in the registry. Run \`navgator doctor --fix\` to remove ` +
                `${memory.orphaned === 1 ? 'it' : 'them'}.`,
        });
    }
    if (!memory.exists) {
        findings.push({
            severity: 'info',
            code: 'memory-absent',
            message: 'No gator-memory store yet at ~/.navgator/memory/ — it is created automatically the first time ' +
                'a project is registered or scanned.',
        });
    }
    if (mirror.enabled && !mirror.targetExists) {
        findings.push({
            severity: 'warn',
            code: 'mirror-target-missing',
            message: `Mirroring to build-loop-memory is enabled, but the configured target "${mirror.target}" does ` +
                `not exist on disk, so every mirror write is a silent no-op.`,
        });
    }
    return findings;
}
// =============================================================================
// COMPUTE
// =============================================================================
/**
 * Compute the full health report. The ONLY place that reads the registry,
 * the journal, gator-memory, and the mirror config and turns them into
 * counts, findings, and a verdict — see the module header for why this must
 * stay singular.
 */
export async function computeHealth() {
    const registry = await loadRegistry('doctor');
    const registryPath = path.join(defaultRegistryDir(), 'projects.json');
    const classifications = classifyRegistryEntries(registry.projects);
    const tmpRooted = classifications.filter((c) => c.tmpRooted).length;
    const missing = classifications.filter((c) => c.missing).length;
    const prunable = classifications.filter((c) => c.prunable).length;
    let bytes = 0;
    try {
        bytes = fs.statSync(registryPath).size;
    }
    catch {
        // Registry file absent (fresh install, or every entry has been pruned) —
        // 0 bytes is the honest answer, not an error.
    }
    const journalRecords = readJournal({ limit: JOURNAL_READ_LIMIT });
    const journalStats = computeJournalStats(journalRecords);
    const memStats = memoryStoreStats();
    const orphaned = reconcileMemory(registry.projects.map((p) => p.path)).orphaned.length;
    const mirror = mirrorStatus();
    const base = {
        schema_version: HEALTH_SCHEMA_VERSION,
        registry: {
            path: registryPath,
            entries: registry.projects.length,
            revision: registry.revision ?? 0,
            bytes,
            tmpRooted,
            missing,
            prunable,
        },
        journal: {
            records: journalStats.records,
            windowDays: journalStats.windowDays,
            registersInWindow: journalStats.registersInWindow,
            registersPerDay: journalStats.registersPerDay,
            // The journal rotates (see `registry-journal.ts`'s own header), so this
            // is always a rate over the RETAINED window, never all-time — never
            // reported as anything but an estimate.
            estimated: true,
            insufficientWindow: journalStats.insufficientWindow,
            conflicts: journalStats.conflicts,
            degradedWrites: journalStats.degradedWrites,
        },
        memory: {
            exists: memStats.exists,
            projects: memStats.projects,
            orphaned,
            events: memStats.events,
            bytes: memStats.bytes,
            lastEventAt: memStats.lastEventAt,
        },
        mirror: {
            enabled: mirror.enabled,
            target: mirror.target,
            targetExists: mirror.targetExists,
        },
    };
    const findings = buildFindings(base);
    const verdict = findings.some((f) => f.severity === 'warn')
        ? 'attention'
        : 'healthy';
    return { ...base, findings, verdict };
}
//# sourceMappingURL=health.js.map