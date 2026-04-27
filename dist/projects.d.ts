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
 * Save the project registry
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
 * List all registered projects
 */
export declare function listProjects(): Promise<ProjectEntry[]>;
/**
 * Format the project list for CLI display
 */
export declare function formatProjectsList(projects: ProjectEntry[], json?: boolean): string;
export {};
//# sourceMappingURL=projects.d.ts.map