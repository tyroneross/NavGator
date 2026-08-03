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
interface ProjectRegistry {
    version: number;
    projects: ProjectEntry[];
}
/**
 * Load the project registry with v1→v2 auto-migration
 */
export declare function loadRegistry(): Promise<ProjectRegistry>;
/**
 * Save the project registry.
 *
 * Uses `atomicWriteJSON` (write-to-temp + rename) so a reader never observes
 * a partially-written file. This does NOT by itself prevent the
 * read-modify-write race between concurrent callers within this process —
 * see `withRegistryLock` below, which serializes the load-mutate-save body
 * of `registerProject`/`updateProjectMeta` so writers never clobber each
 * other's in-memory mutations.
 */
export declare function saveRegistry(registry: ProjectRegistry): Promise<void>;
/**
 * Register or update a project after scan.
 * Replaces the inline registry code previously in cli/index.ts.
 */
export declare function registerProject(projectRoot: string, stats?: {
    components: number;
    connections: number;
    prompts: number;
}, significance?: DiffSignificance, gitInfo?: GitInfo): Promise<void>;
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
 * List all registered projects
 */
export declare function listProjects(): Promise<ProjectEntry[]>;
/**
 * Format the project list for CLI display
 */
export declare function formatProjectsList(projects: ProjectEntry[], json?: boolean): string;
export {};
//# sourceMappingURL=projects.d.ts.map