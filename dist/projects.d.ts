/**
 * NavGator Project Registry
 * Manages ~/.navgator/projects.json with enhanced per-project context
 */
import { DiffSignificance, GitInfo } from './types.js';
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
    git?: {
        branch: string;
        commit: string;
    };
    /**
     * Where this project's code lives. 'local' is the default for anything
     * scanned from a path already on disk; 'remote' marks a repo cloned by
     * the remote-scan chunk (C7), which also carries `url` and `cachePath`.
     * Optional and additive — registry `version` stays 2 (docs/plans/
     * 2026-08-03-portfolio-remote-gitaware.md, C6).
     */
    origin?: {
        kind: 'local' | 'remote';
        url?: string;
        cachePath?: string;
    };
    /** Set when this project was discovered/scanned as part of a portfolio sweep. */
    portfolio?: {
        root: string;
    };
}
/**
 * The four component/connection deltas a scan already computed
 * (`TimelineEntry.diff` in `src/types.ts`) reduced to the four counts
 * gator-memory's `architecture.changed` event carries. Optional and
 * trailing on `registerProject` so every existing caller compiles unchanged.
 */
export interface ProjectChangeSummary {
    componentsAdded: number;
    componentsRemoved: number;
    connectionsAdded: number;
    connectionsRemoved: number;
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
/**
 * Load the project registry with v1→v2 auto-migration.
 *
 * Every call journals a `load` record. The registry has readers in two
 * compilation units and no other record of access, so "who read this, when"
 * was previously unanswerable.
 */
export declare function loadRegistry(note?: string): Promise<ProjectRegistry>;
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
export declare function saveRegistry(registry: ProjectRegistry): Promise<void>;
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
 * Register or update a project after scan.
 * Replaces the inline registry code previously in cli/index.ts.
 */
export declare function registerProject(projectRoot: string, stats?: {
    components: number;
    connections: number;
    prompts: number;
}, significance?: DiffSignificance, gitInfo?: GitInfo, changeSummary?: ProjectChangeSummary): Promise<void>;
/**
 * Read-modify-write a project's metadata, preserving every field the caller
 * doesn't name in `patch`. Used by the remote-scan chunk (C7) to record a
 * remote origin without disturbing scan stats, git info, or portfolio data
 * a sibling writer already set.
 *
 * Serialized through `withRegistryLock` for the same reason as
 * `registerProject` — see that function's comment.
 */
export declare function updateProjectMeta(root: string, patch: Partial<Omit<ProjectEntry, 'path'>>): Promise<void>;
/**
 * Remove a project from the registry. Returns true when an entry was actually
 * removed, false when the path was not registered.
 *
 * Shares the CAS write path so a removal cannot silently resurrect entries a
 * concurrent writer added — the filter is replayed against the winner's
 * registry rather than overwriting it with a stale list.
 */
export declare function removeProject(root: string): Promise<boolean>;
/**
 * Remove a fixed, explicit list of projects in one registry write.
 *
 * Takes an explicit path list, NOT a predicate — this is a correctness
 * requirement, not a style choice. `mutateRegistry` replays its mutation
 * closure against the winner's registry on a detected CAS conflict
 * (see that function's comment). Replaying a filesystem-dependent predicate
 * like "tmp-rooted AND missing" would re-evaluate against fresh state on
 * every replay and could consume an entry a concurrent writer added AFTER
 * the caller showed the user a confirmation list and AFTER any backup was
 * taken — not idempotent, and silently so. An explicit path list makes the
 * closure a pure exact-path filter, which IS idempotent under replay: the
 * confirmed set, the backed-up set, and the pruned set are provably
 * identical regardless of how many times the closure re-runs. Any
 * filesystem check (tmp-rooted, missing, etc.) belongs in the caller,
 * evaluated once, before this is called.
 */
export declare function pruneProjects(paths: string[]): Promise<{
    removed: ProjectEntry[];
}>;
/**
 * List all registered projects
 */
export declare function listProjects(): Promise<ProjectEntry[]>;
/**
 * Format the project list for CLI display
 */
export declare function formatProjectsList(projects: ProjectEntry[], json?: boolean): string;
//# sourceMappingURL=projects.d.ts.map