/**
 * NavGator Configuration System
 * Manages storage paths, modes, and runtime settings
 */
import { NavGatorConfig, StorageMode } from './types.js';
export { NavGatorConfig, StorageMode };
export declare const SCHEMA_VERSION = "1.1.0";
/**
 * Load configuration from environment and defaults
 */
export declare function loadConfig(): NavGatorConfig;
/**
 * Get the absolute storage path for the current project
 */
export declare function getStoragePath(config: NavGatorConfig, projectRoot?: string): string;
/**
 * Get path to components directory
 */
export declare function getComponentsPath(config: NavGatorConfig, projectRoot?: string): string;
/**
 * Get path to connections directory
 */
export declare function getConnectionsPath(config: NavGatorConfig, projectRoot?: string): string;
/**
 * Get path to index file
 */
export declare function getIndexPath(config: NavGatorConfig, projectRoot?: string): string;
/**
 * Get path to graph file
 */
export declare function getGraphPath(config: NavGatorConfig, projectRoot?: string): string;
/**
 * Get path to snapshots directory
 */
export declare function getSnapshotsPath(config: NavGatorConfig, projectRoot?: string): string;
/**
 * Get path to hashes file
 */
export declare function getHashesPath(config: NavGatorConfig, projectRoot?: string): string;
/**
 * Get path to summary file
 */
export declare function getSummaryPath(config: NavGatorConfig, projectRoot?: string): string;
/**
 * Get path to full (uncompressed) summary file
 */
export declare function getSummaryFullPath(config: NavGatorConfig, projectRoot?: string): string;
/**
 * Get path to file map (file path → component ID)
 */
export declare function getFileMapPath(config: NavGatorConfig, projectRoot?: string): string;
/**
 * Get path to prompts file
 */
export declare function getPromptsPath(config: NavGatorConfig, projectRoot?: string): string;
/**
 * Get path to timeline file
 */
export declare function getTimelinePath(config: NavGatorConfig, projectRoot?: string): string;
/**
 * Get max number of timeline entries to retain
 * Reads NAVGATOR_HISTORY_LIMIT env var (default 100)
 */
export declare function getHistoryLimit(): number;
/**
 * Ensure all storage directories exist.
 * Migrates from legacy .claude/architecture path if found.
 */
export declare function ensureStorageDirectories(config: NavGatorConfig, projectRoot?: string): void;
/**
 * Check if storage has been initialized (checks new path and legacy path)
 */
export declare function isStorageInitialized(config: NavGatorConfig, projectRoot?: string): boolean;
/**
 * Get last scan timestamp from index
 */
export declare function getLastScanTimestamp(config: NavGatorConfig, projectRoot?: string): number | null;
/**
 * Check if a rescan is recommended (>24h since last scan)
 */
export declare function shouldRescan(config: NavGatorConfig, projectRoot?: string): boolean;
/**
 * Validate component ID format
 */
export declare function isValidComponentId(id: string): boolean;
/**
 * Validate connection ID format
 */
export declare function isValidConnectionId(id: string): boolean;
/**
 * Sanitize a path to prevent directory traversal
 */
export declare function sanitizePath(inputPath: string, basePath: string): string | null;
/**
 * Get the current configuration (cached)
 */
export declare function getConfig(): NavGatorConfig;
/**
 * Reset the cached configuration (for testing)
 */
export declare function resetConfig(): void;
/**
 * Override configuration (for testing)
 */
export declare function setConfig(config: Partial<NavGatorConfig>): NavGatorConfig;
//# sourceMappingURL=config.d.ts.map