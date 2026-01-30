/**
 * NavGator Configuration System
 * Manages storage paths, modes, and runtime settings
 */

import * as fs from 'fs';
import * as path from 'path';
import { NavGatorConfig, StorageMode } from './types.js';

// Re-export for convenience
export { NavGatorConfig, StorageMode };

// =============================================================================
// DEFAULT CONFIGURATION
// =============================================================================

const DEFAULT_CONFIG: NavGatorConfig = {
  storageMode: 'local',
  storagePath: '.claude/architecture',
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

function getEnvBoolean(key: string, defaultValue: boolean): boolean {
  const value = process.env[key];
  if (value === undefined) return defaultValue;
  return value.toLowerCase() === 'true';
}

function getEnvNumber(key: string, defaultValue: number): number {
  const value = process.env[key];
  if (value === undefined) return defaultValue;
  const parsed = parseFloat(value);
  return isNaN(parsed) ? defaultValue : parsed;
}

function getEnvString<T extends string>(key: string, defaultValue: T, allowed?: T[]): T {
  const value = process.env[key] as T | undefined;
  if (value === undefined) return defaultValue;
  if (allowed && !allowed.includes(value)) return defaultValue;
  return value;
}

// =============================================================================
// CONFIGURATION LOADING
// =============================================================================

/**
 * Load configuration from environment and defaults
 */
export function loadConfig(): NavGatorConfig {
  const storageMode = getEnvString<StorageMode>(
    'NAVGATOR_MODE',
    DEFAULT_CONFIG.storageMode,
    ['local', 'shared']
  );

  // Determine storage path based on mode
  let storagePath = process.env['NAVGATOR_PATH'];
  if (!storagePath) {
    if (storageMode === 'shared') {
      storagePath = path.join(process.env['HOME'] || '~', '.navgator');
    } else {
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
  };
}

// =============================================================================
// PATH RESOLUTION
// =============================================================================

/**
 * Get the absolute storage path for the current project
 */
export function getStoragePath(config: NavGatorConfig, projectRoot?: string): string {
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
export function getComponentsPath(config: NavGatorConfig, projectRoot?: string): string {
  return path.join(getStoragePath(config, projectRoot), 'components');
}

/**
 * Get path to connections directory
 */
export function getConnectionsPath(config: NavGatorConfig, projectRoot?: string): string {
  return path.join(getStoragePath(config, projectRoot), 'connections');
}

/**
 * Get path to index file
 */
export function getIndexPath(config: NavGatorConfig, projectRoot?: string): string {
  return path.join(getStoragePath(config, projectRoot), 'index.json');
}

/**
 * Get path to graph file
 */
export function getGraphPath(config: NavGatorConfig, projectRoot?: string): string {
  return path.join(getStoragePath(config, projectRoot), 'graph.json');
}

/**
 * Get path to snapshots directory
 */
export function getSnapshotsPath(config: NavGatorConfig, projectRoot?: string): string {
  return path.join(getStoragePath(config, projectRoot), 'snapshots');
}

/**
 * Get path to hashes file
 */
export function getHashesPath(config: NavGatorConfig, projectRoot?: string): string {
  return path.join(getStoragePath(config, projectRoot), 'hashes.json');
}

/**
 * Get path to summary file
 */
export function getSummaryPath(config: NavGatorConfig, projectRoot?: string): string {
  return path.join(getStoragePath(config, projectRoot), 'SUMMARY.md');
}

// =============================================================================
// DIRECTORY INITIALIZATION
// =============================================================================

/**
 * Ensure all storage directories exist
 */
export function ensureStorageDirectories(config: NavGatorConfig, projectRoot?: string): void {
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
 * Check if storage has been initialized
 */
export function isStorageInitialized(config: NavGatorConfig, projectRoot?: string): boolean {
  const indexPath = getIndexPath(config, projectRoot);
  return fs.existsSync(indexPath);
}

/**
 * Get last scan timestamp from index
 */
export function getLastScanTimestamp(config: NavGatorConfig, projectRoot?: string): number | null {
  const indexPath = getIndexPath(config, projectRoot);
  if (!fs.existsSync(indexPath)) return null;

  try {
    const index = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
    return index.last_scan || null;
  } catch {
    return null;
  }
}

/**
 * Check if a rescan is recommended (>24h since last scan)
 */
export function shouldRescan(config: NavGatorConfig, projectRoot?: string): boolean {
  const lastScan = getLastScanTimestamp(config, projectRoot);
  if (!lastScan) return true;

  const hoursSinceLastScan = (Date.now() - lastScan) / (1000 * 60 * 60);
  return hoursSinceLastScan > 24;
}

// =============================================================================
// VALIDATION
// =============================================================================

/**
 * Validate component ID format
 */
export function isValidComponentId(id: string): boolean {
  return /^COMP_[a-z0-9-]+_[a-z0-9_]+_[a-z0-9]{4}$/i.test(id);
}

/**
 * Validate connection ID format
 */
export function isValidConnectionId(id: string): boolean {
  return /^CONN_[a-z0-9-]+_[a-z0-9]{6}$/i.test(id);
}

/**
 * Sanitize a path to prevent directory traversal
 */
export function sanitizePath(inputPath: string, basePath: string): string | null {
  const resolved = path.resolve(basePath, inputPath);
  if (!resolved.startsWith(basePath)) {
    return null; // Path traversal attempt
  }
  return resolved;
}

// =============================================================================
// EXPORT CONFIG SINGLETON
// =============================================================================

let cachedConfig: NavGatorConfig | null = null;

/**
 * Get the current configuration (cached)
 */
export function getConfig(): NavGatorConfig {
  if (!cachedConfig) {
    cachedConfig = loadConfig();
  }
  return cachedConfig;
}

/**
 * Reset the cached configuration (for testing)
 */
export function resetConfig(): void {
  cachedConfig = null;
}

/**
 * Override configuration (for testing)
 */
export function setConfig(config: Partial<NavGatorConfig>): NavGatorConfig {
  cachedConfig = { ...loadConfig(), ...config };
  return cachedConfig;
}
