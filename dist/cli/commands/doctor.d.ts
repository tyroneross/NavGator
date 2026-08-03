/**
 * `navgator doctor` — registry + gator-memory hygiene.
 *
 * Default: read-only report (Registry, Growth, Reliability, Memory store,
 * Mirror, then a verdict + findings). `--fix` prunes tmp-rooted-and-missing
 * registry entries (opt-in wider with `--include-missing`) and the
 * gator-memory records that reference them. `--mirror` runs a one-off
 * `mirrorAll()` and reports the result.
 *
 * `--json`/`--agent` on the default and `--fix` paths emit the FROZEN shape
 * `src/memory/health.ts` defines — `web/app/api/registry-health/route.ts` is
 * already shipped against it. Do not add prose or extra stdout output on
 * those paths; anything printed outside the single JSON blob would corrupt
 * what the dashboard parses. Interactive prompts and the pre-confirmation
 * preview list therefore go to STDERR unconditionally, never stdout.
 */
import { Command } from 'commander';
export declare function registerDoctorCommand(program: Command): void;
export interface FixCleanupResult {
    backupPath: string;
    removedFromRegistry: number;
    removedFromMemory: number;
}
export interface FixOutcome {
    status: 'nothing-to-clean' | 'aborted-non-tty' | 'aborted-declined' | 'aborted-backup-failed' | 'cleaned';
    cleanup?: FixCleanupResult;
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
export declare function fixRegistry(options: {
    includeMissing?: boolean;
    yes?: boolean;
}): Promise<FixOutcome>;
export interface MirrorRunResult {
    mirrored: number;
    skipped: number;
    ran: boolean;
    reason?: string;
}
/**
 * The `--mirror` core, exported for the same reason `fixRegistry` is: a test
 * can assert on the returned shape directly (e.g. "disabled reports `ran:
 * false` with a reason, not a bare `{mirrored: 0}`") without parsing stdout.
 */
export declare function describeMirrorRun(): Promise<MirrorRunResult>;
//# sourceMappingURL=doctor.d.ts.map