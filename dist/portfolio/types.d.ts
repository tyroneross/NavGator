/**
 * NavGator Portfolio Types
 *
 * Multi-repo scanning: discover a folder of repos, scan each one through the
 * existing `scan()` entrypoint (one lease per repo, `src/scanner.ts` untouched),
 * and build a cross-repo map (shared dependencies, heuristic service-call
 * edges, portfolio status) over the loaded components/connections.
 */
import type { ArchitectureComponent, ArchitectureConnection } from '../types.js';
export interface RepoDiscoveryOptions {
    /** Directory levels to search below the given root. Default 1, capped at 3. */
    depth?: number;
}
export interface DiscoveredRepo {
    /** Absolute path to the repo root. */
    path: string;
    /** Directory name (used as a display name until a project registry name exists). */
    name: string;
    /** True when `.git` is a file (a linked worktree) rather than a directory. */
    worktree: boolean;
}
export interface PortfolioScanOptions {
    /** Directory levels to search for repos below `dir`. Default 1, capped at 3. */
    depth?: number;
    /** Concurrent repo scans. Default 1 (sequential), capped at 4. */
    concurrency?: number;
}
export type RepoScanStatus = 'scanned' | 'noop' | 'busy' | 'failed';
export interface RepoOutcome {
    path: string;
    name: string;
    status: RepoScanStatus;
    /** Present when status === 'busy'. Mirrors scan()'s discriminated union. */
    retryable?: boolean;
    /** Busy message (retryable) or the caught error message (failed). */
    message?: string;
    stats?: {
        components: number;
        connections: number;
        prompts?: number;
    };
}
export interface PortfolioScanResult {
    root: string;
    repos: RepoOutcome[];
    scanned: number;
    noop: number;
    busy: number;
    failed: number;
}
/**
 * One repo's loaded components/connections, plus enough scan/registry
 * metadata to compute portfolio status. `scanStatus` is only set by the
 * scanning path (`navgator portfolio <dir>`); the status-only path (no dir,
 * already-registered projects) leaves it undefined and relies on `lastScan`.
 */
export interface CrossRepoRepoInput {
    /** Stable identifier for the repo — its absolute path. */
    repo: string;
    components: ArchitectureComponent[];
    connections: ArchitectureConnection[];
    lastScan?: number | null;
    scanStatus?: RepoScanStatus;
}
export interface SharedDependencyRepoVersion {
    repo: string;
    version?: string;
}
export interface SharedDependencyEntry {
    /** Join key used to group this dependency across repos. */
    key: string;
    name: string;
    type: string;
    repos: SharedDependencyRepoVersion[];
    /** True when 2+ repos declare different versions for the same dependency. */
    versionSkew: boolean;
}
export type CrossRepoServiceCallBasis = 'host-match' | 'service-name-match';
/**
 * Inferred cross-repo service-call edge. This is heuristic — a name/endpoint
 * match, never a verified call graph. Every edge is `heuristic: true` and
 * every render path (text, --json, --agent) must label it as such.
 */
export interface CrossRepoServiceEdge {
    fromRepo: string;
    fromComponent: string;
    toRepo: string;
    toComponent: string;
    connectionType: string;
    confidence: number;
    basis: CrossRepoServiceCallBasis;
    heuristic: true;
}
export interface PortfolioStatus {
    repoCount: number;
    totalComponents: number;
    totalConnections: number;
    /** Repos whose last scan is older than 24h (src/projects.ts:170's rule). */
    staleRepos: string[];
    failedRepos: string[];
    busyRepos: string[];
}
export interface CrossRepoMap {
    sharedDependencies: SharedDependencyEntry[];
    /** TAG:INFERRED — heuristic host/service-name matches, not a verified call graph. */
    serviceCalls: CrossRepoServiceEdge[];
    status: PortfolioStatus;
}
//# sourceMappingURL=types.d.ts.map