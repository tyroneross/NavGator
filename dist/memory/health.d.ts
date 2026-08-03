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
import { type ProjectEntry } from '../projects.js';
/** Frozen contract version — see the module header. Semver; only a MAJOR bump
 * signals a shape the dashboard doesn't understand (see the route's own
 * `SUPPORTED_SCHEMA_MAJOR` check). */
export declare const HEALTH_SCHEMA_VERSION = "1.0.0";
export interface HealthFinding {
    severity: 'info' | 'warn';
    code: string;
    message: string;
}
export interface HealthReport {
    schema_version: string;
    registry: {
        path: string;
        entries: number;
        revision: number;
        bytes: number;
        tmpRooted: number;
        missing: number;
        prunable: number;
    };
    journal: {
        records: number;
        windowDays: number;
        registersInWindow: number;
        registersPerDay: number;
        estimated: boolean;
        /**
         * True when the retained journal window is too short to support a per-day
         * rate. Consumers MUST prefer this over `registersPerDay`: when set, the
         * rate is 0 because it is unknowable, not because nothing happened.
         */
        insufficientWindow: boolean;
        conflicts: number;
        degradedWrites: number;
    };
    memory: {
        exists: boolean;
        projects: number;
        orphaned: number;
        events: number;
        bytes: number;
        lastEventAt: number | null;
    };
    mirror: {
        enabled: boolean;
        target: string | null;
        targetExists: boolean;
    };
    findings: HealthFinding[];
    verdict: 'healthy' | 'attention';
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
export declare function isTmpRootedPath(targetPath: string): boolean;
export interface RegistryEntryClassification {
    path: string;
    name: string;
    tmpRooted: boolean;
    missing: boolean;
    /** `tmpRooted && missing` — the default `--fix` cleanup set. */
    prunable: boolean;
}
/** Classify every registry entry once. Both the report's counts and
 * `--fix`'s deletion list are derived from this, so they can never disagree
 * about which entries are which. */
export declare function classifyRegistryEntries(entries: ProjectEntry[]): RegistryEntryClassification[];
/**
 * The entries `--fix` will actually remove. Default: tmp-rooted AND missing
 * (the safe, conservative set — a temp fixture that vanished on its own).
 * `includeMissing: true` widens this to ANY missing path, which is opt-in
 * because a project on an unmounted volume or an external drive is missing
 * but real, and pruning it by default would be a silent data-loss surprise.
 */
export declare function selectPrunableEntries(classifications: RegistryEntryClassification[], opts?: {
    includeMissing?: boolean;
}): RegistryEntryClassification[];
/**
 * Compute the full health report. The ONLY place that reads the registry,
 * the journal, gator-memory, and the mirror config and turns them into
 * counts, findings, and a verdict — see the module header for why this must
 * stay singular.
 */
export declare function computeHealth(): Promise<HealthReport>;
//# sourceMappingURL=health.d.ts.map