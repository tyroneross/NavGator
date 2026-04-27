/**
 * NavGator Storage System
 * File-based persistence for components and connections
 */
import { ArchitectureComponent, ArchitectureConnection, ArchitectureIndex, ConnectionGraph, NavGatorConfig, NavHashes, FileHashRecord, FileChangeResult, TimelineEntry, GitInfo } from './types.js';
/**
 * Backfill stable_id on a component if missing.
 * Idempotent — returns the same component reference (mutated in place).
 * Path-disambiguation is opt-in per-type: types where (type,name) is
 * naturally unique (npm/pip packages, frameworks, services, llm providers,
 * databases, infra, queues, configs) use name-only. Types that can repeat
 * the same name across different files (api-endpoint, db-table, prompt,
 * worker, component, cron) include canonical_path.
 */
/**
 * Public re-export of ensureStableId. Callers (e.g. the scanner during
 * incremental merge) need to populate stable_ids on freshly-scanned
 * in-memory components BEFORE merging with disk-loaded survivors.
 */
export declare function ensureStableIdPublic(c: ArchitectureComponent): ArchitectureComponent;
/**
 * Store a component to disk
 */
export declare function storeComponent(component: ArchitectureComponent, config?: NavGatorConfig, projectRoot?: string): Promise<{
    component_id: string;
    file_path: string;
}>;
/**
 * Load a component by ID
 */
export declare function loadComponent(componentId: string, config?: NavGatorConfig, projectRoot?: string): Promise<ArchitectureComponent | null>;
/**
 * Load all components (parallelized for efficiency)
 */
export declare function loadAllComponents(config?: NavGatorConfig, projectRoot?: string): Promise<ArchitectureComponent[]>;
/**
 * Delete a component by ID
 */
export declare function deleteComponent(componentId: string, config?: NavGatorConfig, projectRoot?: string): Promise<boolean>;
/**
 * Store a connection to disk
 */
export declare function storeConnection(connection: ArchitectureConnection, config?: NavGatorConfig, projectRoot?: string): Promise<{
    connection_id: string;
    file_path: string;
}>;
/**
 * Load a connection by ID
 */
export declare function loadConnection(connectionId: string, config?: NavGatorConfig, projectRoot?: string): Promise<ArchitectureConnection | null>;
/**
 * Load all connections (parallelized for efficiency)
 */
export declare function loadAllConnections(config?: NavGatorConfig, projectRoot?: string): Promise<ArchitectureConnection[]>;
/**
 * Delete a connection by ID
 */
export declare function deleteConnection(connectionId: string, config?: NavGatorConfig, projectRoot?: string): Promise<boolean>;
/**
 * Build and save the index from current components and connections
 */
export declare function buildIndex(config?: NavGatorConfig, projectRoot?: string, projectMetadata?: Partial<import('./types.js').ProjectMetadata>): Promise<ArchitectureIndex>;
/**
 * Load the index
 */
export declare function loadIndex(config?: NavGatorConfig, projectRoot?: string): Promise<ArchitectureIndex | null>;
/**
 * Build the connection graph
 */
export declare function buildGraph(config?: NavGatorConfig, projectRoot?: string): Promise<ConnectionGraph>;
/**
 * Build a map of file paths → component IDs for fast lookup in hooks.
 * Sources: component config_files + connection code_reference files + connection locations.
 */
export declare function buildFileMap(config?: NavGatorConfig, projectRoot?: string): Promise<Record<string, string>>;
/**
 * Load the file map (file path → component ID)
 */
export declare function loadFileMap(config?: NavGatorConfig, projectRoot?: string): Promise<Record<string, string>>;
/**
 * Save prompt scan results to prompts.json
 */
export declare function savePromptScan(promptData: unknown, config?: NavGatorConfig, projectRoot?: string): Promise<void>;
/**
 * Build a concise markdown summary with pointers to detail files.
 * This is the "hot context" an LLM reads first on cold start.
 */
export declare function buildSummary(config?: NavGatorConfig, projectRoot?: string, promptScan?: {
    prompts: Array<{
        name: string;
        location: {
            file: string;
            lineStart: number;
        };
        provider?: {
            provider: string;
            model?: string;
        };
        category?: string;
        messages: Array<{
            role: string;
            content: string;
        }>;
    }>;
    summary: {
        totalPrompts: number;
    };
}, projectMetadata?: Partial<import('./types.js').ProjectMetadata>, latestDiff?: TimelineEntry, gitInfo?: GitInfo): Promise<string>;
/**
 * Load the graph
 */
export declare function loadGraph(config?: NavGatorConfig, projectRoot?: string): Promise<ConnectionGraph | null>;
/**
 * Create a snapshot of current architecture
 */
export declare function createSnapshot(reason?: string, config?: NavGatorConfig, projectRoot?: string): Promise<{
    snapshot_id: string;
    file_path: string;
}>;
/**
 * Store multiple components at once (parallelized for efficiency)
 */
export declare function storeComponents(components: ArchitectureComponent[], config?: NavGatorConfig, projectRoot?: string): Promise<void>;
/**
 * Store multiple connections at once (parallelized for efficiency)
 */
export declare function storeConnections(connections: ArchitectureConnection[], config?: NavGatorConfig, projectRoot?: string): Promise<void>;
/**
 * Clear all stored data (parallelized for efficiency)
 */
export declare function clearStorage(config?: NavGatorConfig, projectRoot?: string): Promise<void>;
/**
 * Get storage statistics
 */
export declare function getStorageStats(config?: NavGatorConfig, projectRoot?: string): Promise<{
    total_components: number;
    total_connections: number;
    disk_usage_kb: number;
    oldest_timestamp: number | null;
    newest_timestamp: number | null;
}>;
/**
 * Compute SHA-256 hash of a file
 */
export declare function computeFileHash(filePath: string): Promise<string>;
/**
 * Compute hashes for multiple files (parallelized in batches for efficiency)
 */
export declare function computeFileHashes(files: string[], projectRoot: string): Promise<Record<string, FileHashRecord>>;
/**
 * Save file hashes to disk
 */
export declare function saveHashes(hashes: Record<string, FileHashRecord>, config?: NavGatorConfig, projectRoot?: string): Promise<void>;
/**
 * Load file hashes from disk
 */
export declare function loadHashes(config?: NavGatorConfig, projectRoot?: string): Promise<NavHashes | null>;
/**
 * Detect which files have changed since last scan
 */
export declare function detectFileChanges(currentFiles: string[], projectRoot: string, config?: NavGatorConfig): Promise<FileChangeResult>;
/**
 * Atomically write a string to disk. Writes to `<target>.tmp` first, then
 * renames over `<target>`. fs.rename is atomic on POSIX within the same
 * filesystem, so a crashed mid-write leaves the prior file intact.
 *
 * Use this for any file that must remain readable during/after a scan
 * (index.json, graph.json, file_map.json, NAVSUMMARY.md, hashes.json).
 */
export declare function atomicWriteFile(target: string, content: string, encoding?: BufferEncoding): Promise<void>;
/**
 * Atomically write a JSON-serializable value to disk (pretty-printed).
 */
export declare function atomicWriteJSON(target: string, value: unknown): Promise<void>;
/**
 * Clear only the components and connections whose source files overlap
 * `changedPaths`. Used by incremental scans so we re-emit just the touched
 * subset and merge the rest by stable_id.
 *
 * - For components: a component is cleared if any of its `source.config_files`
 *   appears in `changedPaths`.
 * - For connections: a connection is cleared if its `code_reference.file`
 *   appears in `changedPaths`. (We do NOT delete based on the target's
 *   source files — that would over-clear.)
 *
 * Survivors stay on disk and get merged with new incoming data via
 * mergeByStableId.
 */
export declare function clearForFiles(config: NavGatorConfig | undefined, projectRoot: string | undefined, changedPaths: Set<string>): Promise<{
    componentsCleared: number;
    connectionsCleared: number;
}>;
/**
 * Merge two arrays by stable_id, keeping the incoming entry on collision
 * (incoming wins because it's the freshly-scanned version of that entity).
 *
 * Generic over T because we use it for both components (keyed by stable_id)
 * and connections (keyed by composite from|to|type|file:line). Caller
 * supplies the key picker.
 */
export declare function mergeByStableId<T>(existing: T[], incoming: T[], pickKey: (t: T) => string): T[];
/**
 * Load only the connections whose target component's source files include
 * any path in `changedFiles`. Returns the set of FROM-side source files —
 * i.e. files that import / depend on something in changedFiles.
 *
 * This is the reverse-dependency walk used by selectScanMode to widen the
 * incremental walk-set so changes to a leaf module re-scan the modules
 * that depend on it.
 *
 * Single-level only. Acceptable for Run 1; deeper transitivity is part of
 * Run 2's SQC audit layer.
 *
 * ALIASED IMPORTS (Run 1.6 — item #7 verify): connection target paths are
 * stored as RESOLVED, project-relative paths. The import scanner
 * (`src/scanners/connections/import-scanner.ts:resolveImport`) maps tsconfig
 * `paths` aliases (e.g. `@/utils/foo`) and `~/`-style aliases to actual file
 * paths (`src/utils/foo.ts`) before constructing the connection. This means
 * matching `changedFiles` against `code_reference.file` and the target
 * component's `source.config_files` is correct without alias-aware
 * normalization here. See `aliased-imports` test fixture for the regression
 * lock.
 *
 * RUN 1.6 — ITEM #8: This function now reads a derived
 * `.navgator/architecture/reverse-deps.json` index when present (single file
 * open per scan). Falls back to the per-edge JSON walk if the index file is
 * missing, corrupt, or schema-mismatched.
 */
export declare function loadReverseDeps(changedFiles: Set<string>, config: NavGatorConfig | undefined, projectRoot: string | undefined): Promise<Set<string>>;
/**
 * Legacy reverse-deps walk: opens every per-edge connection JSON. Retained
 * as the fallback when `reverse-deps.json` is missing, corrupt, or
 * schema-mismatched. Also useful as the regression baseline for the index.
 */
export declare function loadReverseDepsLegacy(changedFiles: Set<string>, config: NavGatorConfig | undefined, projectRoot: string | undefined): Promise<Set<string>>;
/**
 * Reverse-deps index file shape (Run 1.6 — item #8).
 * Stored at `.navgator/architecture/reverse-deps.json`. Computed from the
 * in-memory connection set at scan end (no per-edge file walk).
 *
 * `edges[target_file]` is the list of source files that reference (import,
 * call, depend on) `target_file`.
 */
export interface ReverseDepsIndex {
    schema_version: '1.0.0';
    generated_at: number;
    edges: Record<string, string[]>;
}
/**
 * Build and atomically write `.navgator/architecture/reverse-deps.json` from
 * the in-memory connection set + components. This avoids re-walking per-edge
 * JSON files on the next incremental scan.
 *
 * Run 1.6 — item #8: HEADLINE PERF WIN. On atomize-ai's 4,570 connections,
 * this drops `loadReverseDeps` from ~4,570 file opens to 1.
 */
export declare function buildReverseDepsIndex(components: ArchitectureComponent[], connections: ArchitectureConnection[], config: NavGatorConfig | undefined, projectRoot: string | undefined): Promise<{
    path: string;
    edge_count: number;
}>;
/**
 * Derived-artifact manifest shape (Run 1.6 — item #9).
 * Stored at `.navgator/architecture/manifest.json`. Lists the derived files
 * (graph.json, file_map.json, reverse-deps.json, index.json) with their
 * generation timestamps so future scans can detect stale derivations.
 *
 * Reading is OPTIONAL — existing consumers ignore the manifest. Writing it
 * is cheap and unlocks future incremental optimizations.
 */
export interface DerivedManifest {
    schema_version: '1.0.0';
    generated_at: number;
    files: Record<string, {
        generated_at: number;
        source_count?: number;
    }>;
}
/**
 * Atomically write `.navgator/architecture/manifest.json` describing the
 * derived artifacts NavGator just emitted. Best-effort — the scan succeeds
 * even if this fails.
 */
export declare function buildDerivedManifest(config: NavGatorConfig | undefined, projectRoot: string | undefined, details: {
    reverseDepsEdgeCount?: number;
}): Promise<{
    path: string;
}>;
/**
 * Run an integrity check on the post-merge state.
 * - Every connection endpoint (from + to component_id) must exist in
 *   the components set, OR be a FILE:-prefixed unresolved ref.
 * - Every component's source.config_files must exist on disk
 *   (relative to projectRoot). Missing files → orphan component.
 * - Optional walkSet narrows the source-file existence check to
 *   files in the walk-set; full-scan callers pass an empty set
 *   (means "check all").
 *
 * Returns ok=false on any failure with a list of issue strings.
 * Caller is expected to log scan_type='incremental→full' and
 * fall through to a full scan on failure.
 */
export declare function runIntegrityCheck(components: ArchitectureComponent[], connections: ArchitectureConnection[], projectRoot: string, walkSet?: Set<string>): Promise<{
    ok: boolean;
    issues: string[];
}>;
/**
 * Get a summary of file changes for display
 */
export declare function formatFileChangeSummary(changes: FileChangeResult): string;
//# sourceMappingURL=storage.d.ts.map