/**
 * NavGator Configuration System
 * Manages storage paths, modes, and runtime settings
 */
import * as fs from 'fs';
import * as path from 'path';
// =============================================================================
// DEFAULT CONFIGURATION
// =============================================================================
export const SCHEMA_VERSION = '1.1.0';
const DEFAULT_CONFIG = {
    storageMode: 'local',
    storagePath: '.navgator/architecture',
    autoScan: false,
    healthCheckEnabled: false,
    scanDepth: 'shallow',
    defaultConfidenceThreshold: 0.6,
    maxResultsPerQuery: 20,
};
// =============================================================================
// ENVIRONMENT VARIABLES
// =============================================================================
/**
 * Environment variables that override default config
 *
 * NAVGATOR_MODE: 'local' | 'shared' - Storage mode
 * NAVGATOR_PATH: string - Custom storage path
 * NAVGATOR_AUTO_SCAN: 'true' | 'false' - Auto-scan on session start
 * NAVGATOR_HEALTH_CHECK: 'true' | 'false' - Enable health checks
 * NAVGATOR_SCAN_DEPTH: 'shallow' | 'deep' - Include transitive deps
 * NAVGATOR_CONFIDENCE: number - Default confidence threshold (0-1)
 * NAVGATOR_MAX_RESULTS: number - Max results per query
 */
function getEnvBoolean(key, defaultValue) {
    const value = process.env[key];
    if (value === undefined)
        return defaultValue;
    return value.toLowerCase() === 'true';
}
function getEnvNumber(key, defaultValue) {
    const value = process.env[key];
    if (value === undefined)
        return defaultValue;
    const parsed = parseFloat(value);
    return isNaN(parsed) ? defaultValue : parsed;
}
function getEnvString(key, defaultValue, allowed) {
    const value = process.env[key];
    if (value === undefined)
        return defaultValue;
    if (allowed && !allowed.includes(value))
        return defaultValue;
    return value;
}
// =============================================================================
// CONFIGURATION LOADING
// =============================================================================
/**
 * Load configuration from environment and defaults
 */
export function loadConfig() {
    const storageMode = getEnvString('NAVGATOR_MODE', DEFAULT_CONFIG.storageMode, ['local', 'shared']);
    // Determine storage path based on mode
    let storagePath = process.env['NAVGATOR_PATH'];
    if (!storagePath) {
        if (storageMode === 'shared') {
            storagePath = path.join(process.env['HOME'] || '~', '.navgator');
        }
        else {
            storagePath = DEFAULT_CONFIG.storagePath;
        }
    }
    return {
        storageMode,
        storagePath,
        autoScan: getEnvBoolean('NAVGATOR_AUTO_SCAN', DEFAULT_CONFIG.autoScan),
        healthCheckEnabled: getEnvBoolean('NAVGATOR_HEALTH_CHECK', DEFAULT_CONFIG.healthCheckEnabled),
        scanDepth: getEnvString('NAVGATOR_SCAN_DEPTH', DEFAULT_CONFIG.scanDepth, ['shallow', 'deep']),
        defaultConfidenceThreshold: getEnvNumber('NAVGATOR_CONFIDENCE', DEFAULT_CONFIG.defaultConfidenceThreshold),
        maxResultsPerQuery: getEnvNumber('NAVGATOR_MAX_RESULTS', DEFAULT_CONFIG.maxResultsPerQuery),
        sandbox: getEnvBoolean('NAVGATOR_SANDBOX', false),
    };
}
// =============================================================================
// PATH RESOLUTION
// =============================================================================
/**
 * Get the absolute storage path for the current project
 */
export function getStoragePath(config, projectRoot) {
    if (config.storageMode === 'shared') {
        // Shared mode: use home directory
        return config.storagePath.startsWith('/')
            ? config.storagePath
            : path.join(process.env['HOME'] || '~', config.storagePath);
    }
    // Local mode: relative to project root
    const root = projectRoot || process.cwd();
    return path.join(root, config.storagePath);
}
/**
 * Get path to components directory
 */
export function getComponentsPath(config, projectRoot) {
    return path.join(getStoragePath(config, projectRoot), 'components');
}
/**
 * Get path to connections directory
 */
export function getConnectionsPath(config, projectRoot) {
    return path.join(getStoragePath(config, projectRoot), 'connections');
}
/**
 * Get path to index file
 */
export function getIndexPath(config, projectRoot) {
    return path.join(getStoragePath(config, projectRoot), 'index.json');
}
/**
 * Get path to graph file
 */
export function getGraphPath(config, projectRoot) {
    return path.join(getStoragePath(config, projectRoot), 'graph.json');
}
/**
 * Get path to snapshots directory
 */
export function getSnapshotsPath(config, projectRoot) {
    return path.join(getStoragePath(config, projectRoot), 'snapshots');
}
/**
 * Get path to hashes file
 */
export function getHashesPath(config, projectRoot) {
    return path.join(getStoragePath(config, projectRoot), 'hashes.json');
}
/**
 * Get path to summary file
 */
export function getSummaryPath(config, projectRoot) {
    return path.join(getStoragePath(config, projectRoot), 'NAVSUMMARY.md');
}
/**
 * Get path to full (uncompressed) summary file
 */
export function getSummaryFullPath(config, projectRoot) {
    return path.join(getStoragePath(config, projectRoot), 'NAVSUMMARY_FULL.md');
}
/**
 * Get path to file map (file path → component ID)
 */
export function getFileMapPath(config, projectRoot) {
    return path.join(getStoragePath(config, projectRoot), 'file_map.json');
}
/**
 * Get path to prompts file
 */
export function getPromptsPath(config, projectRoot) {
    return path.join(getStoragePath(config, projectRoot), 'prompts.json');
}
/**
 * Get path to timeline file
 */
export function getTimelinePath(config, projectRoot) {
    return path.join(getStoragePath(config, projectRoot), 'timeline.json');
}
/**
 * Get max number of timeline entries to retain
 * Reads NAVGATOR_HISTORY_LIMIT env var (default 100)
 */
export function getHistoryLimit() {
    return getEnvNumber('NAVGATOR_HISTORY_LIMIT', 100);
}
// =============================================================================
// LEGACY PATH MIGRATION
// =============================================================================
/** Previous storage path before the rename */
const LEGACY_STORAGE_PATH = '.claude/architecture';
/**
 * Migrate data from the legacy .claude/architecture path to .navgator/architecture.
 * Moves all files and subdirectories, then removes the legacy directory.
 * Safe to call multiple times — no-ops if legacy path doesn't exist or new path already has data.
 */
function migrateLegacyStorage(config, projectRoot) {
    const root = projectRoot || process.cwd();
    const legacyPath = path.join(root, LEGACY_STORAGE_PATH);
    const newPath = getStoragePath(config, root);
    // Skip if no legacy data exists
    if (!fs.existsSync(legacyPath))
        return;
    // Skip if new path already has an index (already migrated or fresh scan)
    const newIndex = path.join(newPath, 'index.json');
    if (fs.existsSync(newIndex))
        return;
    // Ensure new directory structure exists
    fs.mkdirSync(newPath, { recursive: true });
    // Move contents recursively
    const moveRecursive = (src, dest) => {
        const entries = fs.readdirSync(src, { withFileTypes: true });
        for (const entry of entries) {
            const srcPath = path.join(src, entry.name);
            const destPath = path.join(dest, entry.name);
            if (entry.isDirectory()) {
                fs.mkdirSync(destPath, { recursive: true });
                moveRecursive(srcPath, destPath);
                // Remove empty source directory after moving contents
                try {
                    fs.rmdirSync(srcPath);
                }
                catch { /* not empty or already gone */ }
            }
            else {
                fs.renameSync(srcPath, destPath);
            }
        }
    };
    try {
        moveRecursive(legacyPath, newPath);
        // Clean up legacy directory if empty
        try {
            fs.rmdirSync(legacyPath);
        }
        catch { /* not empty */ }
        // Try to clean up .claude/ if it's now empty (only if we created it for architecture)
        const claudeDir = path.join(root, '.claude');
        try {
            const remaining = fs.readdirSync(claudeDir);
            if (remaining.length === 0)
                fs.rmdirSync(claudeDir);
        }
        catch { /* has other contents or doesn't exist */ }
    }
    catch {
        // Migration failed — not fatal, next scan will create fresh data
    }
}
// =============================================================================
// DIRECTORY INITIALIZATION
// =============================================================================
/**
 * Ensure all storage directories exist.
 * Migrates from legacy .claude/architecture path if found.
 */
export function ensureStorageDirectories(config, projectRoot) {
    // Migrate legacy data before creating directories
    migrateLegacyStorage(config, projectRoot);
    const basePath = getStoragePath(config, projectRoot);
    const directories = [
        basePath,
        getComponentsPath(config, projectRoot),
        getConnectionsPath(config, projectRoot),
        getSnapshotsPath(config, projectRoot),
    ];
    for (const dir of directories) {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    }
}
/**
 * Check if storage has been initialized (checks new path and legacy path)
 */
export function isStorageInitialized(config, projectRoot) {
    const indexPath = getIndexPath(config, projectRoot);
    if (fs.existsSync(indexPath))
        return true;
    // Check legacy path — migration will happen on next write
    const root = projectRoot || process.cwd();
    const legacyIndex = path.join(root, LEGACY_STORAGE_PATH, 'index.json');
    return fs.existsSync(legacyIndex);
}
/**
 * Get last scan timestamp from index
 */
export function getLastScanTimestamp(config, projectRoot) {
    const indexPath = getIndexPath(config, projectRoot);
    if (!fs.existsSync(indexPath))
        return null;
    try {
        const index = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
        return index.last_scan || null;
    }
    catch {
        return null;
    }
}
/**
 * Check if a rescan is recommended (>24h since last scan)
 */
export function shouldRescan(config, projectRoot) {
    const lastScan = getLastScanTimestamp(config, projectRoot);
    if (!lastScan)
        return true;
    const hoursSinceLastScan = (Date.now() - lastScan) / (1000 * 60 * 60);
    return hoursSinceLastScan > 24;
}
// =============================================================================
// VALIDATION
// =============================================================================
/**
 * Validate component ID format
 */
export function isValidComponentId(id) {
    return /^COMP_[a-z0-9-]+_[a-z0-9_]+_[a-z0-9]{4}$/i.test(id);
}
/**
 * Validate connection ID format
 */
export function isValidConnectionId(id) {
    return /^CONN_[a-z0-9-]+_[a-z0-9]{6}$/i.test(id);
}
/**
 * Sanitize a path to prevent directory traversal
 */
export function sanitizePath(inputPath, basePath) {
    const resolved = path.resolve(basePath, inputPath);
    if (!resolved.startsWith(basePath)) {
        return null; // Path traversal attempt
    }
    return resolved;
}
// =============================================================================
// EXPORT CONFIG SINGLETON
// =============================================================================
let cachedConfig = null;
/**
 * Get the current configuration (cached)
 */
export function getConfig() {
    if (!cachedConfig) {
        cachedConfig = loadConfig();
    }
    return cachedConfig;
}
/**
 * Reset the cached configuration (for testing)
 */
export function resetConfig() {
    cachedConfig = null;
}
/**
 * Override configuration (for testing)
 */
export function setConfig(config) {
    cachedConfig = { ...loadConfig(), ...config };
    return cachedConfig;
}
//# sourceMappingURL=config.js.map