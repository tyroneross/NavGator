/**
 * `navgator doctor` — registry + gator-memory hygiene.
 *
 * Default: read-only report (Registry, Growth, Reliability, Memory store,
 * Mirror, then a verdict + findings). `--fix` prunes tmp-rooted-and-missing
 * registry entries (opt-in wider with `--include-missing`), the gator-memory
 * records that shadowed them, AND any gator-memory record left ORPHANED by a
 * project removed outside this CLI (the dashboard deletes through
 * `web/lib/server/registry-store.ts`, a separate compilation unit that
 * writes `projects.json` directly and cannot emit a memory event) — see
 * `reconcileMemory` in `src/memory/store.ts`. `--mirror` runs a one-off
 * `mirrorAll()` and reports the result.
 *
 * `--json`/`--agent` on the default and `--fix` paths emit the FROZEN shape
 * `src/memory/health.ts` defines — `web/app/api/registry-health/route.ts` is
 * already shipped against it. Do not add prose or extra stdout output on
 * those paths; anything printed outside the single JSON blob would corrupt
 * what the dashboard parses. Interactive prompts and the pre-confirmation
 * preview list therefore go to STDERR unconditionally, never stdout.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as readline from 'readline';
import { wrapInEnvelope } from '../../agent-output.js';
import { computeHealth, classifyRegistryEntries, selectPrunableEntries, } from '../../memory/health.js';
import { loadRegistry, pruneProjects } from '../../projects.js';
import { removeProjectMemory, rebuildMemoryIndex, projectMemoryPath, slug as memoryProjectSlug, reconcileMemory, } from '../../memory/store.js';
import { mirrorAll, mirrorStatus } from '../../memory/mirror.js';
import { defaultRegistryDir } from '../../registry-journal.js';
export function registerDoctorCommand(program) {
    program
        .command('doctor')
        .description('Check registry and gator-memory hygiene; optionally prune stale entries')
        .option('--json', 'Output as JSON')
        .option('--agent', 'Output wrapped in agent envelope (implies --json)')
        .option('--fix', 'Prune prunable registry entries and their gator-memory records (destructive — prompts unless --yes)')
        .option('--yes', 'Skip the confirmation prompt for --fix')
        .option('--include-missing', 'With --fix, also prune registered paths that are missing but not temp-rooted')
        .option('--mirror', 'Mirror every gator-memory project record to the configured build-loop-memory target')
        .action(async (options) => {
        try {
            if (options.mirror) {
                await runMirror(options);
                return;
            }
            if (options.fix) {
                await runFix(options);
                return;
            }
            await runReport(options);
        }
        catch (error) {
            console.error(`navgator doctor failed: ${error instanceof Error ? error.message : String(error)}`);
            process.exit(1);
        }
    });
}
// =============================================================================
// REPORT (default, read-only)
// =============================================================================
async function runReport(options) {
    const report = await computeHealth();
    if (options.agent) {
        console.log(wrapInEnvelope('doctor', report));
        return;
    }
    if (options.json) {
        console.log(JSON.stringify(report, null, 2));
        return;
    }
    // The human report additionally previews WHICH entries are prunable
    // (path + name) — the frozen JSON contract carries counts only, but the
    // person reading a terminal needs to see what `--fix` would actually
    // touch before running it.
    const registry = await loadRegistry('doctor-report');
    const classifications = classifyRegistryEntries(registry.projects);
    const prunableEntries = selectPrunableEntries(classifications);
    console.log(formatHealthReport(report, prunableEntries));
}
function pad(value, width) {
    return value.length >= width ? value : value + ' '.repeat(width - value.length);
}
function formatHealthReport(report, prunableEntries) {
    const { registry, journal, memory, mirror, findings, verdict } = report;
    const lines = [];
    lines.push('NavGator Doctor');
    lines.push('─'.repeat(72));
    lines.push('Registry');
    lines.push(`  Path:       ${registry.path}`);
    lines.push(`  Entries:    ${registry.entries}  (revision ${registry.revision}, ${registry.bytes} bytes)`);
    lines.push(`  Tmp-rooted: ${registry.tmpRooted}   Missing: ${registry.missing}   Prunable: ${registry.prunable}`);
    if (prunableEntries.length > 0) {
        lines.push('  Prunable entries (run `navgator doctor --fix` to remove):');
        for (const entry of prunableEntries) {
            lines.push(`    ${pad(renderSafe(entry.name), 24)}${renderSafe(entry.path)}`);
        }
    }
    lines.push('');
    lines.push('Growth');
    if (journal.records === 0) {
        lines.push('  No journal data yet — the registry has no recorded read/write history.');
    }
    else if (journal.insufficientWindow) {
        // Report the raw counts and decline to extrapolate. A per-day rate from a
        // sub-day window is an artifact, not an estimate — see
        // MIN_RATE_WINDOW_DAYS in health.ts for the measured false positive.
        lines.push(`  ${journal.registersInWindow} new registration${journal.registersInWindow === 1 ? '' : 's'} ` +
            `in the last ${(journal.windowDays * 24).toFixed(1)}h of retained journal.`);
        lines.push('  Not enough history yet to estimate a daily rate.');
    }
    else {
        lines.push(
        // Honest about the window: this is a rate over the RETAINED journal
        // window, never all-time — see health.ts's module header.
        `  ≈${journal.registersPerDay.toFixed(1)} new entries/day, estimated over the last ` +
            `${journal.windowDays.toFixed(1)} days of retained journal ` +
            `(${journal.registersInWindow} new registration${journal.registersInWindow === 1 ? '' : 's'} in that window).`);
    }
    lines.push('');
    lines.push('Reliability');
    lines.push(`  Conflicts (merged):              ${journal.conflicts}`);
    lines.push(`  Degraded writes (lock not held): ${journal.degradedWrites}`);
    lines.push('');
    lines.push('Memory store');
    if (!memory.exists) {
        lines.push('  Not created yet — populated automatically on first registration/scan.');
    }
    else {
        lines.push(`  Projects: ${memory.projects}   Orphaned: ${memory.orphaned}   Events: ${memory.events}   Bytes: ${memory.bytes}`);
        lines.push(`  Last event: ${memory.lastEventAt !== null ? new Date(memory.lastEventAt).toISOString() : 'never'}`);
    }
    lines.push('');
    lines.push('Mirror');
    if (!mirror.enabled) {
        lines.push('  Disabled (default).');
    }
    else if (!mirror.targetExists) {
        lines.push(`  Enabled, but target "${mirror.target}" does not exist — mirroring is a silent no-op.`);
    }
    else {
        lines.push(`  Enabled -> ${mirror.target}`);
    }
    lines.push('');
    lines.push('─'.repeat(72));
    if (findings.length === 0) {
        lines.push(`Verdict: ${verdict.toUpperCase()} — no findings.`);
    }
    else {
        lines.push(`Verdict: ${verdict.toUpperCase()} — ${findings.length} finding${findings.length === 1 ? '' : 's'}:`);
        for (const f of findings) {
            lines.push(`  [${f.severity}] ${f.code}: ${f.message}`);
        }
    }
    return lines.join('\n');
}
// =============================================================================
// --fix
// =============================================================================
/**
 * Neutralize control characters in filesystem-controlled text before it is
 * rendered to a terminal.
 *
 * A registered project's `name` and `path` come from a directory on disk, and
 * `src/projects.ts` stores them unsanitized (it only does `[-_]` -> space and
 * title-case). A directory named with ESC/CR sequences can therefore rewrite
 * or hide lines in the preview a user reads before answering [y/N] on a
 * DESTRUCTIVE operation — the single worst place in this tool to render
 * untrusted text verbatim.
 *
 * `store.ts` makes the same argument for its own write path (neutralize once,
 * so every renderer is safe); this render path reads the registry directly
 * and so has to do it here.
 */
function renderSafe(value) {
    // eslint-disable-next-line no-control-regex
    return value.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ');
}
/** `2026-08-03T09:15:00.000Z` -> `20260803T091500`. */
function compactISOTimestamp(date = new Date()) {
    return date.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, '');
}
function confirmPrompt(question) {
    // Output goes to STDERR, not stdout — a caller running `--fix --json`
    // interactively (no --yes) must not have this prompt's text land inside
    // the JSON stream the dashboard parses.
    const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
    return new Promise((resolve) => {
        rl.question(question, (answer) => {
            rl.close();
            const normalized = answer.trim().toLowerCase();
            resolve(normalized === 'y' || normalized === 'yes');
        });
    });
}
/**
 * The mutating core of `--fix`, exported and side-effect-observable
 * independent of CLI rendering: `src/__tests__/doctor.test.ts` calls this
 * directly with `{ yes: true }` and asserts on the resulting registry,
 * memory store, and journal rather than parsing stdout.
 *
 * Only the "will remove" preview and the confirmation prompt write to
 * STDERR (never stdout — see the module header); everything else here is
 * pure mutation plus a status/result the caller renders.
 */
export async function fixRegistry(options) {
    const registry = await loadRegistry('doctor-fix');
    const classifications = classifyRegistryEntries(registry.projects);
    const targets = selectPrunableEntries(classifications, {
        includeMissing: Boolean(options.includeMissing),
    });
    // f1: orphaned memory records — a record whose project has NO entry left
    // in the registry at all (the dashboard's delete path writes `projects.json`
    // directly, in a separate compilation unit that cannot import the memory
    // store — see store.ts's `reconcileMemory` header). Reconciled against the
    // FULL current registry (every entry, not just the ones surviving prune)
    // so a prune TARGET — which still has a registry entry, just a missing or
    // tmp-rooted path — is never also counted as an orphan: `reconcileMemory`
    // only flags a record whose path matches NONE of the paths passed in, and
    // every target's path is in `registry.projects` at this point. This is
    // what keeps `removedFromMemory` from double-counting a target that is
    // ALSO orphaned by construction — they are disjoint sets, not because of a
    // filter here, but because "has a registry entry" and "orphaned" are
    // mutually exclusive by definition.
    const orphans = reconcileMemory(registry.projects.map((p) => p.path)).orphaned;
    if (targets.length === 0 && orphans.length === 0) {
        // f6: a clean, correctly-built registry must be distinguishable from a
        // broken CLI build. An ABSENT `cleanup` field on `--fix --json` reads as
        // "unavailable/incompatible" to the dashboard
        // (`web/app/api/registry-health/route.ts:135-143`), which previously
        // turned "nothing to clean" into "Registry health unavailable. Rebuild
        // the CLI with `npm run build`." — a wrong diagnosis for a healthy
        // system. Reporting explicit zero counts (not omitting the field) is
        // what fixes that without changing the emitted shape.
        return {
            status: 'nothing-to-clean',
            cleanup: { removedFromRegistry: 0, removedFromMemory: 0, backupPath: null },
        };
    }
    // Print the exact entries that will be removed BEFORE asking for
    // confirmation (or before proceeding under --yes) — the blast radius of a
    // destructive operation must be visible, not just a count. Always stderr;
    // see the module header. Orphaned memory records are listed too — f1's
    // whole point is that `--fix` now touches them, so the pre-confirmation
    // preview must not omit them (the user must see everything that will be
    // deleted before answering [y/N]).
    const totalCount = targets.length + orphans.length;
    console.error(`The following ${totalCount} ${totalCount === 1 ? 'entry' : 'entries'} will be removed from ` +
        'the registry and/or gator-memory:');
    for (const t of targets) {
        console.error(`  [registry] ${renderSafe(t.name)}  ${renderSafe(t.path)}`);
    }
    for (const o of orphans) {
        console.error(`  [memory]   ${renderSafe(o.name)}  ${renderSafe(o.path)}`);
    }
    if (!options.yes) {
        // A non-interactive pipe (cron, CI, a script that redirected stdin) has
        // no human to answer this prompt. Assuming consent from silence would
        // let an unattended `navgator doctor --fix` (run without --yes) silently
        // delete registry entries the first time stdin happens to be
        // non-interactive — exactly the "nobody asked and it deleted my data"
        // failure this guards against.
        if (!process.stdin.isTTY) {
            console.error('Refusing to proceed: stdin is not a TTY and --yes was not passed. Re-run with --yes to confirm non-interactively.');
            return { status: 'aborted-non-tty' };
        }
        const confirmed = await confirmPrompt(`Remove ${totalCount} ${totalCount === 1 ? 'entry' : 'entries'}? [y/N] `);
        if (!confirmed) {
            console.error('Aborted — no changes made.');
            return { status: 'aborted-declined' };
        }
    }
    // Backup BEFORE any mutation, and VERIFY it before proceeding. A cleanup
    // without a recoverable backup is not offered — if the copy can't be
    // written or doesn't parse as JSON, abort rather than mutate a registry we
    // could no longer restore.
    const registryPath = path.join(defaultRegistryDir(), 'projects.json');
    // COPYFILE_EXCL plus a random suffix: the timestamp is second-resolution,
    // so two --fix runs in the same second (two dashboard tabs, a retry, a
    // script) would otherwise have the second run overwrite the pre-mutation
    // backup with ALREADY-PRUNED state — destroying the only copy of what was
    // deleted. `store.ts` closed this same collision class for its temp names
    // with random hex; the backup path needs to inherit that lesson.
    const backupPath = `${registryPath}.backup-${compactISOTimestamp()}-` +
        `${crypto.randomBytes(3).toString('hex')}`;
    let backupOk = false;
    try {
        fs.copyFileSync(registryPath, backupPath, fs.constants.COPYFILE_EXCL);
        const parsed = JSON.parse(fs.readFileSync(backupPath, 'utf-8'));
        backupOk = parsed !== null && typeof parsed === 'object';
    }
    catch {
        backupOk = false;
    }
    if (!backupOk) {
        console.error('Aborted: could not write or verify a backup of the registry. No changes made.');
        return { status: 'aborted-backup-failed' };
    }
    // Explicit path list, never a predicate — `pruneProjects` requires this so
    // a CAS replay after a concurrent write can't re-evaluate a filesystem
    // predicate against fresher state than what was confirmed/backed up. See
    // `pruneProjects`'s own header in `src/projects.ts`.
    const targetPaths = targets.map((t) => t.path);
    const { removed } = await pruneProjects(targetPaths);
    // This bounds the memory store's project-file count — without it, pruning
    // the registry entry alone leaves an orphaned gator-memory record behind
    // forever.
    //
    // The memory records are backed up FIRST, into a sibling of the registry
    // backup. `store.ts` calls `projects/<slug>.json` the source of truth that
    // — unlike index.json and events.jsonl — cannot be deleted without losing
    // knowledge. Telling the user "backup written" while irreversibly unlinking
    // exactly those files would make the reassurance false for the only data
    // here that is not reconstructible. The prune predicate is also not a proof
    // of deadness: a tmp-rooted project on an unmounted volume reads as missing
    // because `existsSync` is false, not because it was deleted.
    const memoryBackupDir = `${backupPath}.memory`;
    let removedFromMemory = 0;
    for (const entry of removed) {
        try {
            const recordPath = projectMemoryPath(memoryProjectSlug(entry.path));
            if (fs.existsSync(recordPath)) {
                fs.mkdirSync(memoryBackupDir, { recursive: true, mode: 0o700 });
                fs.copyFileSync(recordPath, path.join(memoryBackupDir, path.basename(recordPath)));
            }
        }
        catch {
            // Best-effort: a memory record we cannot copy must not block pruning
            // the registry entry, which is the operation the user asked for.
        }
        if (removeProjectMemory(entry.path))
            removedFromMemory += 1;
    }
    // f1: the orphan cleanup this whole finding is about. `pruneProjects`
    // above only ever removes a memory record when the registry entry it
    // shadowed was also pruned — an orphan by definition has NO such registry
    // entry, so without this loop `fixRegistry` would keep reporting
    // `memory-orphaned` findings forever no matter how many times `--fix` ran.
    // Same backup-then-delete order and destination as the loop above: one
    // `memoryBackupDir`, so a single restore point covers every memory record
    // this run touches, whether it was reached via a pruned registry entry or
    // via this orphan path.
    for (const orphan of orphans) {
        try {
            const recordPath = projectMemoryPath(orphan.slug);
            if (fs.existsSync(recordPath)) {
                fs.mkdirSync(memoryBackupDir, { recursive: true, mode: 0o700 });
                fs.copyFileSync(recordPath, path.join(memoryBackupDir, path.basename(recordPath)));
            }
        }
        catch {
            // Best-effort, same reasoning as the loop above: a record we cannot
            // copy must not block removing the rest of the batch.
        }
        if (removeProjectMemory(orphan.path))
            removedFromMemory += 1;
    }
    rebuildMemoryIndex();
    return {
        status: 'cleaned',
        cleanup: { backupPath, removedFromRegistry: removed.length, removedFromMemory },
    };
}
async function runFix(options) {
    const outcome = await fixRegistry({
        includeMissing: Boolean(options.includeMissing),
        yes: Boolean(options.yes),
    });
    if (outcome.status === 'aborted-backup-failed')
        process.exitCode = 1;
    const report = await computeHealth();
    const payload = outcome.cleanup ? { ...report, cleanup: outcome.cleanup } : report;
    if (options.agent) {
        console.log(wrapInEnvelope('doctor', payload));
        return;
    }
    if (options.json) {
        console.log(JSON.stringify(payload, null, 2));
        return;
    }
    if (outcome.status === 'nothing-to-clean') {
        console.log('Nothing to clean — no prunable registry entries found.');
        return;
    }
    if (outcome.status !== 'cleaned' || !outcome.cleanup) {
        // Every abort path has already printed its own reason to stderr.
        return;
    }
    console.log(`Backup written to ${outcome.cleanup.backupPath}`);
    console.log(`Removed ${outcome.cleanup.removedFromRegistry} entr${outcome.cleanup.removedFromRegistry === 1 ? 'y' : 'ies'} from the registry.`);
    console.log(`Removed ${outcome.cleanup.removedFromMemory} record${outcome.cleanup.removedFromMemory === 1 ? '' : 's'} from gator-memory.`);
}
/**
 * The `--mirror` core, exported for the same reason `fixRegistry` is: a test
 * can assert on the returned shape directly (e.g. "disabled reports `ran:
 * false` with a reason, not a bare `{mirrored: 0}`") without parsing stdout.
 */
export async function describeMirrorRun() {
    const status = mirrorStatus();
    if (!status.enabled || !status.targetExists) {
        const reason = !status.enabled
            ? 'Mirroring is disabled (memory.mirror.enabled is false in ~/.navgator/config.json).'
            : `Mirroring is enabled but the target "${status.target}" does not exist on disk.`;
        return { mirrored: 0, skipped: 0, ran: false, reason };
    }
    const result = await mirrorAll();
    return { ...result, ran: true };
}
async function runMirror(options) {
    const outcome = await describeMirrorRun();
    await emitMirrorOutcome(options, outcome);
}
async function emitMirrorOutcome(options, payload) {
    if (options.agent) {
        console.log(wrapInEnvelope('doctor-mirror', payload));
        return;
    }
    if (options.json) {
        console.log(JSON.stringify(payload, null, 2));
        return;
    }
    if (!payload.ran) {
        // Reported plainly rather than as "0 mirrored" — a silent no-op that
        // looks identical to "tried and mirrored nothing" would hide the real
        // reason (disabled, or no target) from the person running this.
        console.log(payload.reason);
        return;
    }
    console.log(`Mirrored ${payload.mirrored} project(s), skipped ${payload.skipped}.`);
}
//# sourceMappingURL=doctor.js.map