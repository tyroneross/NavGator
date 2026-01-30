/**
 * NavGator Main Scanner
 * Orchestrates all component and connection scanners
 */

import * as path from 'path';
import { glob } from 'glob';
import {
  ArchitectureComponent,
  ArchitectureConnection,
  ScanResult,
  ScanWarning,
  FileChangeResult,
} from './types.js';
import { scanNpmPackages, detectNpm } from './scanners/packages/npm.js';
import { scanPipPackages, detectPip } from './scanners/packages/pip.js';
import { scanInfrastructure } from './scanners/infrastructure/index.js';
import { scanServiceCalls } from './scanners/connections/service-calls.js';
import { scanWithAST, scanDatabaseOperations } from './scanners/connections/ast-scanner.js';
import { scanPrompts, convertToArchitecture, formatPromptsOutput, PromptScanResult } from './scanners/prompts/index.js';
import {
  storeComponents,
  storeConnections,
  buildIndex,
  buildGraph,
  buildSummary,
  clearStorage,
  computeFileHashes,
  saveHashes,
  detectFileChanges,
  formatFileChangeSummary,
} from './storage.js';
import { getConfig, ensureStorageDirectories, NavGatorConfig } from './config.js';

// =============================================================================
// SCAN OPTIONS
// =============================================================================

export interface ScanOptions {
  quick?: boolean;           // Only scan package files, skip code analysis
  connections?: boolean;     // Focus on connection detection
  verbose?: boolean;         // Show detailed output
  clearFirst?: boolean;      // Clear existing data before scan
  incremental?: boolean;     // Only scan changed files (uses hashes)
  useAST?: boolean;          // Use AST-based scanning (more accurate, slightly slower)
  prompts?: boolean;         // Enhanced prompt scanning with full content
}

// =============================================================================
// MAIN SCANNER
// =============================================================================

/**
 * Run a full architecture scan
 */
export async function scan(
  projectRoot?: string,
  options: ScanOptions = {}
): Promise<{
  components: ArchitectureComponent[];
  connections: ArchitectureConnection[];
  warnings: ScanWarning[];
  fileChanges?: FileChangeResult;
  promptScan?: PromptScanResult;
  stats: {
    scan_duration_ms: number;
    components_found: number;
    connections_found: number;
    warnings_count: number;
    files_scanned: number;
    files_changed: number;
    prompts_found?: number;
  };
}> {
  const startTime = Date.now();
  const root = projectRoot || process.cwd();
  const config = getConfig();

  if (options.verbose) {
    console.log(`Scanning project: ${root}`);
  }

  // Clear existing data if requested
  if (options.clearFirst) {
    await clearStorage(config, root);
  }

  // Ensure storage directories exist
  ensureStorageDirectories(config, root);

  // ==========================================================================
  // Phase 0: File Discovery & Change Detection
  // ==========================================================================

  const sourceFiles = await glob('**/*.{ts,tsx,js,jsx,py}', {
    cwd: root,
    ignore: ['node_modules/**', 'dist/**', 'build/**', '.next/**', '__pycache__/**', 'venv/**', '.git/**'],
  });

  let fileChanges: FileChangeResult | undefined;

  if (!options.clearFirst) {
    fileChanges = await detectFileChanges(sourceFiles, root, config);

    if (options.verbose) {
      console.log(`File changes: ${formatFileChangeSummary(fileChanges)}`);
      if (fileChanges.added.length > 0 && fileChanges.added.length <= 5) {
        console.log(`  Added: ${fileChanges.added.join(', ')}`);
      }
      if (fileChanges.modified.length > 0 && fileChanges.modified.length <= 5) {
        console.log(`  Modified: ${fileChanges.modified.join(', ')}`);
      }
    }
  }

  const allComponents: ArchitectureComponent[] = [];
  const allConnections: ArchitectureConnection[] = [];
  const allWarnings: ScanWarning[] = [];
  let promptScanResultHolder: PromptScanResult | undefined;

  // ==========================================================================
  // Phase 1: Package Detection
  // ==========================================================================

  if (options.verbose) {
    console.log('Phase 1: Scanning packages...');
  }

  // NPM packages
  if (detectNpm(root)) {
    if (options.verbose) console.log('  - Detected npm/yarn/pnpm project');
    const result = await scanNpmPackages(root);
    allComponents.push(...result.components);
    allWarnings.push(...result.warnings);
  }

  // Python packages
  if (detectPip(root)) {
    if (options.verbose) console.log('  - Detected Python project');
    const result = await scanPipPackages(root);
    allComponents.push(...result.components);
    allWarnings.push(...result.warnings);
  }

  // ==========================================================================
  // Phase 2: Infrastructure Detection
  // ==========================================================================

  if (options.verbose) {
    console.log('Phase 2: Scanning infrastructure...');
  }

  const infraResult = await scanInfrastructure(root);
  allComponents.push(...infraResult.components);
  allWarnings.push(...infraResult.warnings);

  // ==========================================================================
  // Phase 3: Connection Detection (unless quick mode)
  // ==========================================================================

  if (!options.quick || options.connections) {
    if (options.verbose) {
      console.log('Phase 3: Scanning connections...');
    }

    if (options.useAST) {
      // AST-based scanning (more accurate)
      if (options.verbose) console.log('  - Running AST analysis (ts-morph)...');

      try {
        const astResult = await scanWithAST(root);
        allComponents.push(...astResult.components);
        allConnections.push(...astResult.connections);
        allWarnings.push(...astResult.warnings);

        // Also scan for database operations
        if (options.verbose) console.log('  - Scanning database operations...');
        const dbResult = await scanDatabaseOperations(root);
        allComponents.push(...dbResult.components);
        allConnections.push(...dbResult.connections);
        allWarnings.push(...dbResult.warnings);
      } catch (error) {
        allWarnings.push({
          type: 'parse_error',
          message: `AST scanning failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });

        // Fall back to regex scanning
        if (options.verbose) console.log('  - Falling back to regex scanning...');
        const serviceResult = await scanServiceCalls(root);
        allComponents.push(...serviceResult.components);
        allConnections.push(...serviceResult.connections);
        allWarnings.push(...serviceResult.warnings);
      }
    } else {
      // Regex-based scanning (faster but less accurate)
      if (options.verbose) console.log('  - Scanning service calls (regex)...');
      const serviceResult = await scanServiceCalls(root);
      allComponents.push(...serviceResult.components);
      allConnections.push(...serviceResult.connections);
      allWarnings.push(...serviceResult.warnings);
    }

    // AI prompts - use enhanced scanner if --prompts flag, otherwise basic
    if (options.prompts) {
      if (options.verbose) console.log('  - Running enhanced prompt scan...');
      promptScanResultHolder = await scanPrompts(root, {
        includeRawContent: true,
        detectVariables: true,
      });

      // Convert to architecture format
      const promptArchitecture = convertToArchitecture(promptScanResultHolder.prompts);
      allComponents.push(...promptArchitecture.components);
      allConnections.push(...promptArchitecture.connections);
      allWarnings.push(...promptArchitecture.warnings);

      if (options.verbose) {
        console.log(`    Found ${promptScanResultHolder.prompts.length} prompts`);
        if (promptScanResultHolder.summary.byProvider) {
          for (const [provider, count] of Object.entries(promptScanResultHolder.summary.byProvider)) {
            console.log(`      ${provider}: ${count}`);
          }
        }
      }
    }
  }

  // ==========================================================================
  // Phase 4: Deduplicate & Store
  // ==========================================================================

  if (options.verbose) {
    console.log('Phase 4: Storing results...');
  }

  // Deduplicate components by name (within current scan)
  const componentMap = new Map<string, ArchitectureComponent>();
  for (const component of allComponents) {
    const existing = componentMap.get(component.name);
    if (!existing || component.source.confidence > existing.source.confidence) {
      componentMap.set(component.name, component);
    }
  }
  const uniqueComponents = Array.from(componentMap.values());

  // Clear old components/connections before storing new ones
  // This ensures no duplicate accumulation across scans
  await clearStorage(config, root);
  ensureStorageDirectories(config, root);

  // Store components and connections
  await storeComponents(uniqueComponents, config, root);
  await storeConnections(allConnections, config, root);

  // Build index, graph, and summary
  await buildIndex(config, root);
  await buildGraph(config, root);
  await buildSummary(config, root);

  // ==========================================================================
  // Phase 5: Save File Hashes
  // ==========================================================================

  if (options.verbose) {
    console.log('Phase 5: Saving file hashes...');
  }

  const fileHashes = await computeFileHashes(sourceFiles, root);
  await saveHashes(fileHashes, config, root);

  const duration = Date.now() - startTime;
  const filesChanged = fileChanges
    ? fileChanges.added.length + fileChanges.modified.length + fileChanges.removed.length
    : sourceFiles.length;

  if (options.verbose) {
    console.log(`\nScan complete in ${duration}ms`);
    console.log(`  Components: ${uniqueComponents.length}`);
    console.log(`  Connections: ${allConnections.length}`);
    console.log(`  Files scanned: ${sourceFiles.length}`);
    console.log(`  Files changed: ${filesChanged}`);
    console.log(`  Warnings: ${allWarnings.length}`);
  }

  return {
    components: uniqueComponents,
    connections: allConnections,
    warnings: allWarnings,
    fileChanges,
    promptScan: promptScanResultHolder,
    stats: {
      scan_duration_ms: duration,
      components_found: uniqueComponents.length,
      connections_found: allConnections.length,
      warnings_count: allWarnings.length,
      files_scanned: sourceFiles.length,
      files_changed: filesChanged,
      prompts_found: promptScanResultHolder?.prompts.length,
    },
  };
}

/**
 * Quick scan - only packages, no code analysis
 */
export async function quickScan(projectRoot?: string): Promise<ScanResult> {
  const result = await scan(projectRoot, { quick: true });
  return {
    components: result.components,
    connections: result.connections,
    warnings: result.warnings,
  };
}

/**
 * Scan only for AI prompts (detailed)
 */
export async function scanPromptsOnly(
  projectRoot?: string,
  options: { verbose?: boolean } = {}
): Promise<PromptScanResult> {
  const root = projectRoot || process.cwd();

  if (options.verbose) {
    console.log(`Scanning for AI prompts in: ${root}`);
  }

  const result = await scanPrompts(root, {
    includeRawContent: true,
    detectVariables: true,
  });

  if (options.verbose) {
    console.log(formatPromptsOutput(result));
  }

  return result;
}

// Re-export prompt utilities
export { formatPromptsOutput, formatPromptDetail } from './scanners/prompts/index.js';
export type { PromptScanResult, DetectedPrompt } from './scanners/prompts/index.js';

/**
 * Get scan status/summary without running a full scan
 */
export async function getScanStatus(
  projectRoot?: string
): Promise<{
  initialized: boolean;
  last_scan: number | null;
  needs_rescan: boolean;
  component_count: number;
  connection_count: number;
}> {
  const config = getConfig();
  const root = projectRoot || process.cwd();

  const { loadIndex } = await import('./storage.js');
  const index = await loadIndex(config, root);

  if (!index) {
    return {
      initialized: false,
      last_scan: null,
      needs_rescan: true,
      component_count: 0,
      connection_count: 0,
    };
  }

  const hoursSinceLastScan = (Date.now() - index.last_scan) / (1000 * 60 * 60);

  return {
    initialized: true,
    last_scan: index.last_scan,
    needs_rescan: hoursSinceLastScan > 24,
    component_count: index.stats.total_components,
    connection_count: index.stats.total_connections,
  };
}
