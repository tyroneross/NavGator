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
  ProjectMetadata,
  GitInfo,
} from './types.js';
import { getGitInfo } from './git.js';
import { scanNpmPackages, detectNpm } from './scanners/packages/npm.js';
import { scanPipPackages, detectPip } from './scanners/packages/pip.js';
import { scanSpmPackages, detectSpm } from './scanners/packages/swift.js';
import { scanInfrastructure } from './scanners/infrastructure/index.js';
import { scanPrismaSchema, detectPrisma } from './scanners/infrastructure/prisma-scanner.js';
import { scanEnvVars, detectEnvFiles } from './scanners/infrastructure/env-scanner.js';
import { scanQueues, detectQueues } from './scanners/infrastructure/queue-scanner.js';
import { scanCronJobs, detectCrons } from './scanners/infrastructure/cron-scanner.js';
import { scanDeployConfig } from './scanners/infrastructure/deploy-scanner.js';
import { scanFieldUsage, canAnalyzeFieldUsage, FieldUsageReport } from './scanners/infrastructure/field-usage-analyzer.js';
import { scanTypeSpecValidation, canValidateTypeSpec, TypeSpecReport } from './scanners/infrastructure/typespec-validator.js';
import { scanServiceCalls } from './scanners/connections/service-calls.js';
import { scanWithAST, scanDatabaseOperations } from './scanners/connections/ast-scanner.js';
import { scanPrompts, convertToArchitecture, formatPromptsOutput, PromptScanResult } from './scanners/prompts/index.js';
import { traceLLMCalls, LLMTraceResult } from './scanners/connections/llm-call-tracer.js';
import { scanSwiftCode } from './scanners/swift/code-scanner.js';
import { scanImports } from './scanners/connections/import-scanner.js';
import {
  storeComponents,
  storeConnections,
  buildIndex,
  buildGraph,
  buildFileMap,
  buildSummary,
  savePromptScan,
  clearStorage,
  createSnapshot,
  computeFileHashes,
  saveHashes,
  detectFileChanges,
  formatFileChangeSummary,
} from './storage.js';
import { getConfig, ensureStorageDirectories, NavGatorConfig } from './config.js';
import {
  computeArchitectureDiff,
  classifySignificance,
  loadLatestSnapshot,
  buildCurrentSnapshot,
  saveTimelineEntry,
  generateTimelineId,
} from './diff.js';
import { registerProject } from './projects.js';
import { TimelineEntry } from './types.js';
import { classifyAllConnections } from './classify.js';
import { isSandboxMode } from './sandbox.js';

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
  trackBranch?: boolean;     // Opt-in: capture git branch/commit in scan output
  fieldUsage?: boolean;      // Analyze DB field usage across codebase (FEATURE FLAG)
  typeSpec?: boolean;        // Validate Prisma types against TS interfaces (FEATURE FLAG)
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
  fieldUsageReport?: FieldUsageReport;
  typeSpecReport?: TypeSpecReport;
  timelineEntry?: TimelineEntry;
  gitInfo?: GitInfo;
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

  // Sandbox mode: restrict scan behavior
  if (isSandboxMode()) {
    options.quick = true;
    options.prompts = false;
    options.useAST = false;
  }

  // Opt-in branch tracking
  let gitInfo: GitInfo | undefined;
  if (options.trackBranch) {
    const info = await getGitInfo(root);
    if (info) {
      gitInfo = info;
      if (options.verbose) {
        console.log(`Branch tracking: ${info.branch} @ ${info.commit}`);
      }
    }
  }

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

  const sourceFiles = await glob('**/*.{ts,tsx,js,jsx,py,swift,h,m}', {
    cwd: root,
    ignore: ['**/node_modules/**', '**/dist/**', '**/build/**', '**/.next/**', '**/__pycache__/**', '**/venv/**', '**/.git/**', '**/.build/**', '**/DerivedData/**', '**/.swiftpm/**', '**/Pods/**', '**/coverage/**'],
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
  let projectMetadata: Partial<ProjectMetadata> | undefined;

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

  // Swift/iOS/Mac packages (SPM, CocoaPods)
  if (detectSpm(root)) {
    if (options.verbose) console.log('  - Detected Swift/Xcode project');
    const result = await scanSpmPackages(root);
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

  // Prisma schema → database models + relations
  if (detectPrisma(root)) {
    if (options.verbose) console.log('  - Detected Prisma schema');
    try {
      const prismaResult = await scanPrismaSchema(root);
      allComponents.push(...prismaResult.components);
      allConnections.push(...prismaResult.connections);
      allWarnings.push(...prismaResult.warnings);
      if (options.verbose) {
        console.log(`    Models: ${prismaResult.components.length}, Relations: ${prismaResult.connections.length}`);
      }
    } catch (error) {
      allWarnings.push({
        type: 'parse_error',
        message: `Prisma scanning failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    }
  }

  // DB field usage analyzer (opt-in via FEATURE FLAG: fieldUsage)
  let fieldUsageReportResult: FieldUsageReport | undefined;
  if (options.fieldUsage && canAnalyzeFieldUsage(root)) {
    if (options.verbose) console.log('  - Analyzing DB field usage...');
    try {
      const fieldResult = await scanFieldUsage(root) as ScanResult & { report?: FieldUsageReport };
      allComponents.push(...fieldResult.components);
      allConnections.push(...fieldResult.connections);
      allWarnings.push(...fieldResult.warnings);
      fieldUsageReportResult = fieldResult.report;
      if (options.verbose && fieldResult.report) {
        const r = fieldResult.report;
        console.log(`    Fields: ${r.totalFields} total, ${r.unusedFields} unused, ${r.writeOnlyFields} write-only`);
      }
    } catch (error) {
      allWarnings.push({
        type: 'parse_error',
        message: `Field usage analysis failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    }
  }

  // TypeSpec validator (opt-in via FEATURE FLAG: typeSpec)
  let typeSpecReportResult: TypeSpecReport | undefined;
  if (options.typeSpec && canValidateTypeSpec(root)) {
    if (options.verbose) console.log('  - Validating TypeSpec (Prisma vs TS interfaces)...');
    try {
      const tsResult = await scanTypeSpecValidation(root) as ScanResult & { report?: TypeSpecReport };
      allWarnings.push(...tsResult.warnings);
      typeSpecReportResult = tsResult.report;
      if (options.verbose && tsResult.report) {
        const r = tsResult.report;
        console.log(`    Interfaces: ${r.modelsWithInterfaces}/${r.modelsChecked} matched, ${r.totalMismatches} mismatches`);
      }
    } catch (error) {
      allWarnings.push({
        type: 'parse_error',
        message: `TypeSpec validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    }
  }

  // Environment variables → config components + dependency connections
  if (detectEnvFiles(root)) {
    if (options.verbose) console.log('  - Detected environment files');
    try {
      const envResult = await scanEnvVars(root);
      allComponents.push(...envResult.components);
      allConnections.push(...envResult.connections);
      allWarnings.push(...envResult.warnings);
      if (options.verbose) {
        console.log(`    Env vars: ${envResult.components.length}, References: ${envResult.connections.length}`);
      }
    } catch (error) {
      allWarnings.push({
        type: 'parse_error',
        message: `Env scanning failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    }
  }

  // BullMQ/Bull queues → producer/consumer topology
  if (detectQueues(root)) {
    if (options.verbose) console.log('  - Detected queue system');
    try {
      const queueResult = await scanQueues(root);
      allComponents.push(...queueResult.components);
      allConnections.push(...queueResult.connections);
      allWarnings.push(...queueResult.warnings);
      if (options.verbose) {
        console.log(`    Queues: ${queueResult.components.length}, Connections: ${queueResult.connections.length}`);
      }
    } catch (error) {
      allWarnings.push({
        type: 'parse_error',
        message: `Queue scanning failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    }
  }

  // Cron jobs → scheduled task components
  if (detectCrons(root)) {
    if (options.verbose) console.log('  - Detected cron jobs');
    try {
      const cronResult = await scanCronJobs(root);
      allComponents.push(...cronResult.components);
      allConnections.push(...cronResult.connections);
      allWarnings.push(...cronResult.warnings);
      if (options.verbose) {
        console.log(`    Cron jobs: ${cronResult.components.length}, Route connections: ${cronResult.connections.length}`);
      }
    } catch (error) {
      allWarnings.push({
        type: 'parse_error',
        message: `Cron scanning failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    }
  }

  // Deployment config → detailed infra metadata
  if (options.verbose) console.log('  - Scanning deployment config...');
  try {
    const deployResult = await scanDeployConfig(root);
    allComponents.push(...deployResult.components);
    allWarnings.push(...deployResult.warnings);
    if (options.verbose && deployResult.components.length > 0) {
      console.log(`    Deploy configs: ${deployResult.components.length}`);
    }
  } catch (error) {
    allWarnings.push({
      type: 'parse_error',
      message: `Deploy config scanning failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    });
  }

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

    // File-level import graph (TS/JS local imports)
    if (options.verbose) console.log('  - Scanning file imports...');
    try {
      const importResult = await scanImports(root, sourceFiles);
      allComponents.push(...importResult.components);
      allConnections.push(...importResult.connections);
      if (options.verbose) {
        console.log(`    Found ${importResult.components.length} internal modules, ${importResult.connections.length} file-level imports`);
      }
    } catch (error) {
      allWarnings.push({
        type: 'parse_error',
        message: `Import scanning failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    }

    // Swift code analysis (runtime deps, protocols, state, LLM calls)
    if (detectSpm(root)) {
      if (options.verbose) console.log('  - Scanning Swift code connections...');
      try {
        const swiftResult = await scanSwiftCode(root);
        allComponents.push(...swiftResult.components);
        allConnections.push(...swiftResult.connections);
        allWarnings.push(...swiftResult.warnings);
        projectMetadata = swiftResult.projectMeta;
        if (options.verbose) {
          console.log(`    Swift: ${swiftResult.components.length} components, ${swiftResult.connections.length} connections`);
          if (swiftResult.projectMeta.platforms) {
            console.log(`    Platforms: ${swiftResult.projectMeta.platforms.join(', ')}`);
          }
          if (swiftResult.projectMeta.architecture_pattern) {
            console.log(`    Architecture: ${swiftResult.projectMeta.architecture_pattern}`);
          }
        }
      } catch (error) {
        allWarnings.push({
          type: 'parse_error',
          message: `Swift code scanning failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
      }

      // Xcode project analysis (.pbxproj + storyboards)
      try {
        const { findXcodeProject } = await import('./scanners/packages/swift.js');
        const pbxprojPath = findXcodeProject(root);

        if (pbxprojPath) {
          if (options.verbose) console.log('  - Scanning Xcode project...');
          const { parseXcodeProject, mapTargetToComponent, mapSourceMembership } = await import('./scanners/xcode/pbxproj-parser.js');
          const xcodeData = parseXcodeProject(pbxprojPath);
          const timestamp = Date.now();

          for (const target of xcodeData.targets) {
            const comp = mapTargetToComponent(target, timestamp);
            allComponents.push(comp);
            const memberConns = mapSourceMembership(target, comp.component_id, timestamp);
            allConnections.push(...memberConns);
          }

          // Enrich project metadata with Xcode target info
          if (projectMetadata) {
            projectMetadata.targets = xcodeData.targets.map(t => ({
              name: t.name,
              type: t.type,
              dependencies: t.frameworks,
            }));
            projectMetadata.xcodeProject = {
              path: pbxprojPath,
              targets: xcodeData.targets.map(t => ({
                name: t.name,
                type: t.type,
                bundleId: t.bundleId,
              })),
            };
          }

          if (options.verbose) {
            console.log(`    Xcode: ${xcodeData.targets.length} targets`);
          }
        }

        // Storyboard/XIB scanning
        const { scanStoryboards } = await import('./scanners/xcode/storyboard-scanner.js');
        const storyboardResult = await scanStoryboards(root);
        allComponents.push(...storyboardResult.components);
        allConnections.push(...storyboardResult.connections);
        if (options.verbose && storyboardResult.components.length > 0) {
          console.log(`    Storyboards: ${storyboardResult.components.length} VCs, ${storyboardResult.connections.length} segues`);
        }
      } catch (error) {
        allWarnings.push({
          type: 'parse_error',
          message: `Xcode project scanning failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
      }
    }

    // AI prompts & LLM call tracing
    if (options.prompts) {
      // Step 1: Run anchor-based LLM call tracer (primary detection)
      if (options.verbose) console.log('  - Running LLM call tracer (anchor-based)...');
      let traceResult: LLMTraceResult | undefined;
      try {
        traceResult = await traceLLMCalls(root);
        allComponents.push(...traceResult.scanResult.components);
        allConnections.push(...traceResult.scanResult.connections);

        if (options.verbose) {
          console.log(`    Traced ${traceResult.calls.length} LLM call sites`);
          console.log(`    Wrappers: ${traceResult.wrappers.length}`);
          const providers = new Map<string, number>();
          for (const call of traceResult.calls) {
            const p = call.provider.name;
            providers.set(p, (providers.get(p) || 0) + 1);
          }
          for (const [provider, count] of providers) {
            console.log(`      ${provider}: ${count} call sites`);
          }
        }
      } catch (error) {
        allWarnings.push({
          type: 'parse_error',
          message: `LLM call tracer failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
        if (options.verbose) console.log(`    LLM tracer error: ${error instanceof Error ? error.message : 'Unknown'}`);
      }

      // Step 2: Run regex prompt detector with corroboration (secondary — catches prompt definitions)
      if (options.verbose) console.log('  - Running prompt detector (corroboration-filtered)...');
      promptScanResultHolder = await scanPrompts(root, {
        includeRawContent: true,
        detectVariables: true,
        aggressive: true,
      });

      // Attach tracer results to prompt scan data (for web UI)
      if (traceResult) {
        promptScanResultHolder.tracedCalls = traceResult.calls;
        promptScanResultHolder.summary.tracedCallSites = traceResult.calls.length;
      }

      // Convert prompt definitions to architecture format
      const promptArchitecture = convertToArchitecture(promptScanResultHolder.prompts);
      allComponents.push(...promptArchitecture.components);
      allConnections.push(...promptArchitecture.connections);
      allWarnings.push(...promptArchitecture.warnings);

      if (options.verbose) {
        console.log(`    Found ${promptScanResultHolder.prompts.length} prompt definitions`);
        if (promptScanResultHolder.summary.byProvider) {
          for (const [provider, count] of Object.entries(promptScanResultHolder.summary.byProvider)) {
            console.log(`      ${provider}: ${count}`);
          }
        }
      }
    }
  }

  // ==========================================================================
  // Phase 3.5: Semantic Classification
  // ==========================================================================

  if (allConnections.length > 0 && allComponents.length > 0) {
    if (options.verbose) {
      console.log('Phase 3.5: Classifying connections...');
    }
    const semantics = classifyAllConnections(allConnections, allComponents);
    for (const conn of allConnections) {
      const info = semantics.get(conn.connection_id);
      if (info) {
        conn.semantic = info;
      }
    }
    if (options.verbose) {
      const byClass = new Map<string, number>();
      for (const [, info] of semantics) {
        byClass.set(info.classification, (byClass.get(info.classification) || 0) + 1);
      }
      for (const [cls, count] of byClass) {
        console.log(`  ${cls}: ${count}`);
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

  // Deduplicate connections by composite key (within current scan)
  // Keeps highest confidence when duplicates found (e.g., regex + AST detect same call)
  const connectionMap = new Map<string, ArchitectureConnection>();
  for (const conn of allConnections) {
    const key = `${conn.from.component_id}|${conn.to.component_id}|${conn.connection_type}|${conn.code_reference?.file || ''}:${conn.code_reference?.line_start || ''}`;
    const existing = connectionMap.get(key);
    if (!existing || conn.confidence > existing.confidence) {
      connectionMap.set(key, conn);
    }
  }
  const uniqueConnections = Array.from(connectionMap.values());

  // Snapshot previous state before overwriting (for change tracking)
  // Also load the pre-scan snapshot for diff computation
  let preScanSnapshot = null;
  if (!options.clearFirst) {
    try {
      await createSnapshot('pre-scan', config, root);
      preScanSnapshot = await loadLatestSnapshot(config, root);
    } catch {
      // No previous data to snapshot — first scan
    }
  }

  // Clear old components/connections before storing new ones
  // This ensures no duplicate accumulation across scans
  await clearStorage(config, root);
  ensureStorageDirectories(config, root);

  // Store components and connections
  await storeComponents(uniqueComponents, config, root);
  await storeConnections(uniqueConnections, config, root);

  // ==========================================================================
  // Phase 5: Architecture Diff
  // ==========================================================================

  let timelineEntry: TimelineEntry | undefined;

  if (options.verbose) {
    console.log('Phase 5: Computing architecture diff...');
  }

  try {
    const currentSnapshot = await buildCurrentSnapshot(config, root);
    const diff = computeArchitectureDiff(preScanSnapshot, currentSnapshot);
    const { significance, triggers } = classifySignificance(diff);

    timelineEntry = {
      id: generateTimelineId(),
      timestamp: Date.now(),
      significance,
      triggers,
      diff,
      snapshot_id: currentSnapshot.snapshot_id,
      git: gitInfo,
    };

    // Only save timeline entry if there are changes (or first scan)
    if (diff.stats.total_changes > 0 || !preScanSnapshot) {
      await saveTimelineEntry(timelineEntry, config, root);
    }

    if (options.verbose) {
      console.log(`  Significance: ${significance}`);
      console.log(`  Changes: ${diff.stats.total_changes}`);
      if (triggers.length > 0) {
        console.log(`  Triggers: ${triggers.join(', ')}`);
      }
    }
  } catch {
    // Diff computation is non-critical
    if (options.verbose) {
      console.log('  Diff computation skipped (non-critical error)');
    }
  }

  // Build index, graph, file map, and summary
  await buildIndex(config, root, projectMetadata);
  await buildGraph(config, root);
  await buildFileMap(config, root);
  await buildSummary(config, root, promptScanResultHolder, projectMetadata, timelineEntry, gitInfo);

  // Persist prompt scan results if available
  if (promptScanResultHolder) {
    await savePromptScan(promptScanResultHolder, config, root);
  }

  // Register project in global registry
  try {
    await registerProject(
      root,
      {
        components: uniqueComponents.length,
        connections: uniqueConnections.length,
        prompts: promptScanResultHolder?.prompts.length ?? 0,
      },
      timelineEntry?.significance,
      gitInfo
    );
  } catch {
    // Non-critical
  }

  // ==========================================================================
  // Phase 6: Save File Hashes
  // ==========================================================================

  if (options.verbose) {
    console.log('Phase 6: Saving file hashes...');
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
    console.log(`  Connections: ${uniqueConnections.length}`);
    console.log(`  Files scanned: ${sourceFiles.length}`);
    console.log(`  Files changed: ${filesChanged}`);
    console.log(`  Warnings: ${allWarnings.length}`);
  }

  return {
    components: uniqueComponents,
    connections: uniqueConnections,
    warnings: allWarnings,
    fileChanges,
    promptScan: promptScanResultHolder,
    fieldUsageReport: fieldUsageReportResult,
    typeSpecReport: typeSpecReportResult,
    timelineEntry,
    gitInfo,
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

  // Run anchor-based tracer first
  let traceResult: LLMTraceResult | undefined;
  try {
    traceResult = await traceLLMCalls(root);
    if (options.verbose) {
      console.log(`Traced ${traceResult.calls.length} LLM call sites`);
    }
  } catch (error) {
    if (options.verbose) {
      console.log(`LLM tracer error: ${error instanceof Error ? error.message : 'Unknown'}`);
    }
  }

  // Run prompt detector with corroboration
  const result = await scanPrompts(root, {
    includeRawContent: true,
    detectVariables: true,
    aggressive: true,
  });

  // Attach tracer data
  if (traceResult) {
    result.tracedCalls = traceResult.calls;
    result.summary.tracedCallSites = traceResult.calls.length;
  }

  if (options.verbose) {
    console.log(formatPromptsOutput(result));
  }

  return result;
}

// Re-export prompt utilities
export { formatPromptsOutput, formatPromptDetail } from './scanners/prompts/index.js';
export type { PromptScanResult, DetectedPrompt } from './scanners/prompts/index.js';

// Re-export tracer types
export { traceLLMCalls } from './scanners/connections/llm-call-tracer.js';
export type { TracedLLMCall, LLMTraceResult } from './scanners/connections/llm-call-tracer.js';

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
