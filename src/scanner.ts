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
import { scanPrismaCalls } from './scanners/connections/prisma-calls.js';
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
  clearForFiles,
  loadIndex,
  loadAllComponents,
  loadAllConnections,
  loadReverseDeps,
  runIntegrityCheck,
  mergeByStableId,
  atomicWriteJSON,
  ensureStableIdPublic,
  buildReverseDepsIndex,
  buildDerivedManifest,
  createSnapshot,
  computeFileHashes,
  saveHashes,
  detectFileChanges,
  formatFileChangeSummary,
} from './storage.js';
import { getConfig, ensureStorageDirectories, NavGatorConfig, getIndexPath, getStoragePath, SCHEMA_VERSION, getComponentsPath, getConnectionsPath } from './config.js';
import { acquireLock } from './scan-lock.js';
import {
  computeArchitectureDiff,
  classifySignificance,
  loadLatestSnapshot,
  buildCurrentSnapshot,
  saveTimelineEntry,
  generateTimelineId,
} from './diff.js';
import { registerProject } from './projects.js';
import { TimelineEntry, ScanType, ArchitectureIndex } from './types.js';
import { classifyAllConnections } from './classify.js';
import { isSandboxMode } from './sandbox.js';
import { ensureSafeGitignore } from './gitignore-safety.js';

// =============================================================================
// SCAN OPTIONS
// =============================================================================

/**
 * Mode the scanner runs in.
 * - 'auto': default. Inspect index + file changes; pick full or incremental.
 * - 'full': clearStorage + scan all files (forced).
 * - 'incremental': scan only walk-set (changedFiles ∪ reverseDeps).
 *   If no prior state exists, falls back to 'full'.
 */
export type ScanMode = 'auto' | 'full' | 'incremental';

export interface ScanOptions {
  quick?: boolean;           // Only scan package files, skip code analysis
  connections?: boolean;     // Focus on connection detection
  verbose?: boolean;         // Show detailed output
  clearFirst?: boolean;      // Clear existing data before scan (legacy alias for mode='full')
  incremental?: boolean;     // Legacy alias for mode='incremental'
  mode?: ScanMode;           // Run 1 — explicit mode selector. Default: 'auto'.
  useAST?: boolean;          // Use AST-based scanning (more accurate, slightly slower)
  prompts?: boolean;         // Enhanced prompt scanning with full content
  trackBranch?: boolean;     // Opt-in: capture git branch/commit in scan output
  fieldUsage?: boolean;      // Analyze DB field usage across codebase (FEATURE FLAG)
  typeSpec?: boolean;        // Validate Prisma types against TS interfaces (FEATURE FLAG)
  commit?: boolean;          // Opt-in: auto-commit scan output to nested .navgator/.git for temporal queries
  scip?: boolean;            // Opt-in: run SCIP indexer for resolved cross-file edges (~500ms cold)
  /**
   * Internal-only (Run 1.7 — Problem A). When the integrity check on an
   * incremental scan fails, the outer scan releases its lock and recursively
   * re-enters with `mode: 'full', clearFirst: true, _promotedFromIncremental: true`.
   * The inner scan honors this flag by labeling its timeline entry and stats
   * `scan_type: 'incremental→full'` (instead of plain 'full') so downstream
   * tooling — and the Run 1.6 #3 evidence-preservation contract — sees the
   * promotion. NEVER set this flag from outside scanner.ts.
   */
  _promotedFromIncremental?: boolean;
}

// =============================================================================
// MODE SELECTION (Run 1 — D2)
// =============================================================================

/**
 * Files whose presence in fileChanges forces a full scan because they alter
 * the package/dependency graph in ways that ripple through every component.
 */
const FULL_SCAN_TRIGGER_FILES: ReadonlySet<string> = new Set<string>([
  // Lockfiles / manifests — change the package graph
  'package.json',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'pyproject.toml',
  'requirements.txt',
  'requirements-dev.txt',
  'requirements-test.txt',
  'prisma/schema.prisma',
  'Package.swift',
  'Package.resolved',
  // Build / runtime config — change resolution, deploy targets, ignore rules
  'tsconfig.json',
  'vercel.json',
  'fly.toml',
  'railway.json',
  '.gitignore',
]);

/** Days × ms in one day — used by stale-full check. */
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/** Cap on consecutive incremental scans before forcing a full scan. */
const INCREMENTAL_CAP = 20;

export interface ScanModeDecision {
  mode: 'full' | 'incremental';
  reason:
    | 'flag-full'
    | 'flag-incremental'
    | 'no-prior-state'
    | 'schema-mismatch'
    | 'manifest-changed'
    | 'new-files'
    | 'stale-full'
    | 'incremental-cap'
    | 'no-changes'
    | 'fast-path';
}

/**
 * Decide whether to run a full or incremental scan based on the requested
 * mode, the prior index state, and the file changes since last scan.
 *
 * Pure function — no I/O. All inputs precomputed by the caller.
 *
 * Policy (for mode='auto'):
 * 1. No prior index → full / no-prior-state
 * 2. schema_version mismatch (and not 1.0.0 → 1.1.0 soft-upgrade) → full / schema-mismatch
 * 3. Any FULL_SCAN_TRIGGER_FILES in changedFiles → full / manifest-changed
 * 4. now − last_full_scan > 7 days → full / stale-full
 * 5. incrementals_since_full ≥ 20 → full / incremental-cap
 * 6. No file changes at all → noop case (caller handles); we still return
 *    'incremental' here for the no-op flow.
 * 7. Else → incremental / fast-path
 */
export function selectScanMode(
  fileChanges: FileChangeResult | undefined,
  index: ArchitectureIndex | null,
  options: { mode?: ScanMode; clearFirst?: boolean; incremental?: boolean },
  now: number = Date.now()
): ScanModeDecision {
  const mode = options.mode ?? (options.clearFirst ? 'full' : options.incremental ? 'incremental' : 'auto');

  if (mode === 'full') {
    return { mode: 'full', reason: 'flag-full' };
  }

  if (mode === 'incremental') {
    if (!index) {
      return { mode: 'full', reason: 'no-prior-state' };
    }
    return { mode: 'incremental', reason: 'flag-incremental' };
  }

  // mode === 'auto'
  if (!index) {
    return { mode: 'full', reason: 'no-prior-state' };
  }

  // 1.0.0 → 1.1.0 is a soft upgrade (loadIndex injected defaults).
  // Any other mismatch demands a full rebuild.
  const sv = index.schema_version ?? '1.0.0';
  if (sv !== '1.0.0' && sv !== SCHEMA_VERSION) {
    return { mode: 'full', reason: 'schema-mismatch' };
  }

  const changed = new Set<string>();
  if (fileChanges) {
    for (const f of fileChanges.added) changed.add(f);
    for (const f of fileChanges.modified) changed.add(f);
    for (const f of fileChanges.removed) changed.add(f);
  }

  for (const trigger of FULL_SCAN_TRIGGER_FILES) {
    if (changed.has(trigger)) {
      return { mode: 'full', reason: 'manifest-changed' };
    }
  }

  // New files have no recorded reverse-dep edges yet, so an incremental walk-set
  // can't find their importers. Cleaner to force a full scan than gymnastics
  // (Run 1.6 — item #5).
  if (fileChanges && fileChanges.added.length > 0) {
    return { mode: 'full', reason: 'new-files' };
  }

  const lastFull = index.last_full_scan ?? 0;
  if (lastFull > 0 && now - lastFull > SEVEN_DAYS_MS) {
    return { mode: 'full', reason: 'stale-full' };
  }

  const incCount = index.incrementals_since_full ?? 0;
  if (incCount >= INCREMENTAL_CAP) {
    return { mode: 'full', reason: 'incremental-cap' };
  }

  if (changed.size === 0) {
    return { mode: 'incremental', reason: 'no-changes' };
  }

  return { mode: 'incremental', reason: 'fast-path' };
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

  // Ensure storage directories exist BEFORE we look at any prior state.
  ensureStorageDirectories(config, root);

  // ==========================================================================
  // Phase 0.0: Concurrency lock (Run 1.6 — item #4)
  // ==========================================================================
  // Prevent two `navgator scan` processes corrupting each other's
  // .navgator/architecture/ output. Stale locks (>10 min OR pid gone)
  // auto-clear. Live contention exits cleanly with code 0.
  const storeDir = getStoragePath(config, root);
  const requestedScanType = options.mode ?? (options.clearFirst ? 'full' : options.incremental ? 'incremental' : 'auto');
  const lock = acquireLock(storeDir, requestedScanType);
  if (!lock.ok) {
    console.log(lock.message);
    const duration = Date.now() - startTime;
    return {
      components: [],
      connections: [],
      warnings: [],
      stats: {
        scan_duration_ms: duration,
        components_found: 0,
        connections_found: 0,
        warnings_count: 0,
        files_scanned: 0,
        files_changed: 0,
      },
    };
  }

  try {
  // ==========================================================================
  // Phase 0: File Discovery & Change Detection
  // ==========================================================================

  const sourceFiles = await glob('**/*.{ts,tsx,js,jsx,py,swift,h,m}', {
    cwd: root,
    ignore: ['**/node_modules/**', '**/dist/**', '**/build/**', '**/.next/**', '**/__pycache__/**', '**/venv/**', '**/.git/**', '**/.build/**', '**/DerivedData/**', '**/.swiftpm/**', '**/Pods/**', '**/coverage/**'],
  });

  // For change detection, also include manifest files at the project root
  // (and a few well-known nested ones). selectScanMode consults these to
  // decide whether to force a full scan. Manifests are NOT scanned by the
  // per-language scanners — they're tracked here only for change detection.
  const manifestPatterns = [
    'package.json',
    'package-lock.json',
    'pnpm-lock.yaml',
    'yarn.lock',
    'pyproject.toml',
    'requirements.txt',
    'requirements-dev.txt',
    'requirements-test.txt',
    'prisma/schema.prisma',
    'Package.swift',
    'Package.resolved',
    // Build / runtime config — track so changes trigger full scan
    'tsconfig.json',
    'vercel.json',
    'fly.toml',
    'railway.json',
    '.gitignore',
  ];
  const manifestFiles: string[] = [];
  for (const m of manifestPatterns) {
    try {
      const fs = await import('node:fs');
      if (fs.existsSync(path.join(root, m))) manifestFiles.push(m);
    } catch {
      // ignore
    }
  }
  const filesForChangeDetection = [...sourceFiles, ...manifestFiles];

  // Detect file changes using prior hashes BEFORE any clearing.
  // (Used by mode selection AND timeline summary even on full scans.)
  let fileChanges: FileChangeResult | undefined;
  fileChanges = await detectFileChanges(filesForChangeDetection, root, config);

  if (options.verbose) {
    console.log(`File changes: ${formatFileChangeSummary(fileChanges)}`);
    if (fileChanges.added.length > 0 && fileChanges.added.length <= 5) {
      console.log(`  Added: ${fileChanges.added.join(', ')}`);
    }
    if (fileChanges.modified.length > 0 && fileChanges.modified.length <= 5) {
      console.log(`  Modified: ${fileChanges.modified.join(', ')}`);
    }
  }

  // ==========================================================================
  // Phase 0.5: Scan-mode selection (Run 1 — D2)
  // ==========================================================================

  const priorIndex: ArchitectureIndex | null = await loadIndex(config, root);
  const decision = selectScanMode(fileChanges, priorIndex, options);

  // scanType captures the mode the scan ACTUALLY ran in (after potential
  // integrity-check promotion). Initialized to the decision; may be promoted
  // to 'incremental→full' below.
  //
  // Run 1.7 — Problem A: when this scan is the recursive re-entry from a
  // failed integrity check (`_promotedFromIncremental === true`), `decision.mode`
  // is 'full' (clearFirst forces it), but the user-visible scan_type should
  // remain 'incremental→full' so timeline + stats consumers see the promotion
  // evidence (Run 1.6 #3 contract). The actual scan body still runs as full.
  let scanType: ScanType = options._promotedFromIncremental ? 'incremental→full' : decision.mode;

  if (options.verbose) {
    console.log(`Scan mode: ${decision.mode} (${decision.reason})`);
  }

  // Compute walk-set for incremental: changedFiles ∪ reverseDeps
  const changedSet = new Set<string>();
  if (fileChanges) {
    for (const f of fileChanges.added) changedSet.add(f);
    for (const f of fileChanges.modified) changedSet.add(f);
    for (const f of fileChanges.removed) changedSet.add(f);
  }
  let walkSet = new Set<string>(changedSet);
  if (decision.mode === 'incremental' && changedSet.size > 0) {
    const reverseDeps = await loadReverseDeps(changedSet, config, root);
    for (const f of reverseDeps) walkSet.add(f);
    if (options.verbose) {
      console.log(`  Walk-set: ${changedSet.size} changed + ${reverseDeps.size} reverse-deps = ${walkSet.size} files`);
    }
  }
  // Pass walkSet to scanners only on incremental. Full scans pass undefined to
  // preserve bit-identical output (regression-locked by characterization snapshot).
  const incWalkSet: Set<string> | undefined = decision.mode === 'incremental' ? walkSet : undefined;

  // ==========================================================================
  // Phase 0.6: Noop short-circuit (incremental + zero changes)
  // ==========================================================================

  if (decision.mode === 'incremental' && decision.reason === 'no-changes') {
    // Nothing changed since last scan. Bump last_scan, update incrementals_since_full
    // to 0 (no incremental work was done — but keep it as-is to honor the cap).
    // Save fresh hashes (idempotent), update index timestamp, record noop timeline entry.
    if (priorIndex) {
      priorIndex.last_scan = Date.now();
      // Note: incrementals_since_full and last_full_scan unchanged on noop.
      await atomicWriteJSON(getIndexPath(config, root), priorIndex);
    }
    const fileHashes = await computeFileHashes(filesForChangeDetection, root);
    await saveHashes(fileHashes, config, root);

    const noopTimelineEntry: TimelineEntry = {
      id: generateTimelineId(),
      timestamp: Date.now(),
      significance: 'patch',
      triggers: [],
      diff: {
        components: { added: [], removed: [], modified: [] },
        connections: { added: [], removed: [] },
        stats: {
          total_changes: 0,
          components_before: priorIndex?.stats.total_components ?? 0,
          components_after: priorIndex?.stats.total_components ?? 0,
          connections_before: priorIndex?.stats.total_connections ?? 0,
          connections_after: priorIndex?.stats.total_connections ?? 0,
        },
      },
      git: gitInfo,
      scan_type: 'noop',
      files_scanned: 0,
    };
    await saveTimelineEntry(noopTimelineEntry, config, root);

    // Load existing components/connections so callers see the unchanged graph.
    const existingComponents = await loadAllComponents(config, root);
    const existingConnections = await loadAllConnections(config, root);
    const duration = Date.now() - startTime;

    if (options.verbose) {
      console.log(`Scan complete (noop) in ${duration}ms`);
    }

    return {
      components: existingComponents,
      connections: existingConnections,
      warnings: [],
      fileChanges,
      timelineEntry: noopTimelineEntry,
      gitInfo,
      stats: {
        scan_duration_ms: duration,
        components_found: existingComponents.length,
        connections_found: existingConnections.length,
        warnings_count: 0,
        files_scanned: 0,
        files_changed: 0,
      },
    };
  }

  // For full scans: clear ALL prior data up front (legacy clearFirst semantics).
  // For incremental: defer to Phase 4 (clearForFiles + merge).
  if (decision.mode === 'full' || options.clearFirst) {
    await clearStorage(config, root);
    ensureStorageDirectories(config, root);
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

  // Package scanners run in parallel (independent of each other)
  {
    const packageTasks: Promise<void>[] = [];

    if (detectNpm(root)) {
      if (options.verbose) console.log('  - Detected npm/yarn/pnpm project');
      packageTasks.push(scanNpmPackages(root).then(result => {
        allComponents.push(...result.components);
        allWarnings.push(...result.warnings);
      }));
    }

    if (detectPip(root)) {
      if (options.verbose) console.log('  - Detected Python project');
      packageTasks.push(scanPipPackages(root).then(result => {
        allComponents.push(...result.components);
        allWarnings.push(...result.warnings);
      }));
    }

    if (detectSpm(root)) {
      if (options.verbose) console.log('  - Detected Swift/Xcode project');
      packageTasks.push(scanSpmPackages(root).then(result => {
        allComponents.push(...result.components);
        allWarnings.push(...result.warnings);
      }));
    }

    await Promise.all(packageTasks);
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
      const fieldResult = await scanFieldUsage(root, incWalkSet) as ScanResult & { report?: FieldUsageReport };
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

  // Env, queues, and crons are independent — run in parallel
  {
    const infraTasks: Promise<void>[] = [];

    if (detectEnvFiles(root)) {
      if (options.verbose) console.log('  - Detected environment files');
      infraTasks.push(scanEnvVars(root, incWalkSet).then(envResult => {
        allComponents.push(...envResult.components);
        allConnections.push(...envResult.connections);
        allWarnings.push(...envResult.warnings);
        if (options.verbose) {
          console.log(`    Env vars: ${envResult.components.length}, References: ${envResult.connections.length}`);
        }
      }).catch(error => {
        allWarnings.push({
          type: 'parse_error',
          message: `Env scanning failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
      }));
    }

    if (detectQueues(root)) {
      if (options.verbose) console.log('  - Detected queue system');
      infraTasks.push(scanQueues(root, incWalkSet).then(queueResult => {
        allComponents.push(...queueResult.components);
        allConnections.push(...queueResult.connections);
        allWarnings.push(...queueResult.warnings);
        if (options.verbose) {
          console.log(`    Queues: ${queueResult.components.length}, Connections: ${queueResult.connections.length}`);
        }
      }).catch(error => {
        allWarnings.push({
          type: 'parse_error',
          message: `Queue scanning failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
      }));
    }

    if (detectCrons(root)) {
      if (options.verbose) console.log('  - Detected cron jobs');
      infraTasks.push(scanCronJobs(root, incWalkSet).then(cronResult => {
        allComponents.push(...cronResult.components);
        allConnections.push(...cronResult.connections);
        allWarnings.push(...cronResult.warnings);
        if (options.verbose) {
          console.log(`    Cron jobs: ${cronResult.components.length}, Route connections: ${cronResult.connections.length}`);
        }
      }).catch(error => {
        allWarnings.push({
          type: 'parse_error',
          message: `Cron scanning failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
      }));
    }

    await Promise.all(infraTasks);
  }

  // Deployment config → detailed infra metadata
  if (options.verbose) console.log('  - Scanning deployment config...');
  try {
    const deployResult = await scanDeployConfig(root);
    allComponents.push(...deployResult.components);
    allConnections.push(...deployResult.connections);
    allWarnings.push(...deployResult.warnings);
    if (options.verbose && deployResult.components.length > 0) {
      console.log(`    Deploy configs: ${deployResult.components.length}, Entry points: ${deployResult.connections.length}`);
    }
  } catch (error) {
    allWarnings.push({
      type: 'parse_error',
      message: `Deploy config scanning failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    });
  }

  // Prisma call detection: map source files to database models they query
  const prismaModelComps = allComponents.filter(c => c.type === 'database' && c.tags?.includes('prisma'));
  if (prismaModelComps.length > 0) {
    if (options.verbose) console.log('  - Scanning Prisma client calls...');
    try {
      const prismaCallResult = await scanPrismaCalls(root, prismaModelComps, incWalkSet);
      allConnections.push(...prismaCallResult.connections);
      if (options.verbose && prismaCallResult.connections.length > 0) {
        const uniqueModels = new Set(prismaCallResult.connections.map(c => c.description?.split(' queries ')[1]?.split(' ')[0]));
        console.log(`    DB queries: ${prismaCallResult.connections.length} file→model connections across ${uniqueModels.size} models`);
      }
    } catch (error) {
      allWarnings.push({
        type: 'parse_error',
        message: `Prisma call scanning failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    }
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
        const astResult = await scanWithAST(root, incWalkSet);
        allComponents.push(...astResult.components);
        allConnections.push(...astResult.connections);
        allWarnings.push(...astResult.warnings);

        // Also scan for database operations
        if (options.verbose) console.log('  - Scanning database operations...');
        const dbResult = await scanDatabaseOperations(root, incWalkSet);
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
        const serviceResult = await scanServiceCalls(root, incWalkSet);
        allComponents.push(...serviceResult.components);
        allConnections.push(...serviceResult.connections);
        allWarnings.push(...serviceResult.warnings);
      }
    } else {
      // Regex-based scanning (faster but less accurate)
      if (options.verbose) console.log('  - Scanning service calls (regex)...');
      const serviceResult = await scanServiceCalls(root, incWalkSet);
      allComponents.push(...serviceResult.components);
      allConnections.push(...serviceResult.connections);
      allWarnings.push(...serviceResult.warnings);
    }

    // File-level import graph (TS/JS local imports)
    if (options.verbose) console.log('  - Scanning file imports...');
    try {
      // Collect npm package components so bare imports (`import X from "react"`)
      // can be resolved to the package component and emitted as `uses-package`
      // edges. Use config_files filter instead of type filter: packages can be
      // classified as 'npm' | 'framework' | 'database' | 'service' depending
      // on FRAMEWORK_SIGNATURES, but all originate from a package.json.
      const knownPackages = allComponents
        .filter(c => c.source.config_files?.some(f =>
          f === 'package.json' || f.endsWith('/package.json')
        ))
        .map(c => ({ name: c.name, component_id: c.component_id }));

      // In incremental mode, restrict the import scan to walk-set files. Falls
      // back to the full sourceFiles list (bit-identical) on full scans.
      const importSourceFiles = incWalkSet
        ? sourceFiles.filter(f => incWalkSet.has(f))
        : sourceFiles;
      const importResult = await scanImports(root, importSourceFiles, knownPackages);
      allComponents.push(...importResult.components);
      allConnections.push(...importResult.connections);
      if (options.verbose) {
        const usesPkgCount = importResult.connections.filter(c => c.connection_type === 'uses-package').length;
        console.log(`    Found ${importResult.components.length} internal modules, ${importResult.connections.length} file-level imports (${usesPkgCount} uses-package)`);
      }

      // SCIP overlay (T11): when --scip / NAVGATOR_SCIP=1, run the
      // compiler-accurate indexer and ADD any cross-file edges the regex
      // import-scanner missed (re-exports, dynamic imports, type-only refs,
      // etc.). Existing edges from the regex pass are preserved as-is so
      // the characterization snapshots stay stable for non-SCIP runs.
      const scipEnabled = process.env['NAVGATOR_SCIP'] === '1' || options.scip === true;
      if (scipEnabled) {
        try {
          const { runScip, crossFileEdges, hasTsConfig } = await import('./parsers/scip-runner.js');
          if (!hasTsConfig(root)) {
            if (options.verbose) console.log('    SCIP requested but no tsconfig.json — skipping');
          } else {
            if (options.verbose) console.log('  - Running SCIP indexer (compiler-accurate)...');
            const scipResult = await runScip(root, { timeoutMs: 60_000 });
            if (!scipResult.ok) {
              allWarnings.push({
                type: 'parse_error',
                message: `SCIP indexer failed: ${scipResult.error}`,
              });
            } else {
              const cross = crossFileEdges(scipResult.edges);
              const fileToComponentId = new Map<string, string>();
              for (const c of importResult.components) {
                const f = c.source?.config_files?.[0];
                if (f) fileToComponentId.set(f, c.component_id);
              }
              const existing = new Set(
                importResult.connections
                  .filter((c) => c.connection_type === 'imports')
                  .map((c) => `${c.from?.location?.file ?? ''}→${c.code_reference?.file ?? ''}`)
              );
              let added = 0;
              const now = Date.now();
              for (const e of cross) {
                const fromId = fileToComponentId.get(e.from_file);
                const toId = fileToComponentId.get(e.to_file ?? '');
                if (!fromId || !toId) continue;
                const key = `${e.from_file}→${e.to_file}`;
                if (existing.has(key)) continue;
                existing.add(key);
                allConnections.push({
                  connection_id: `CONN_imports_scip_${Math.random().toString(36).slice(2, 10)}`,
                  from: {
                    component_id: fromId,
                    location: { file: e.from_file, line: e.from_line + 1 },
                  },
                  to: { component_id: toId },
                  connection_type: 'imports',
                  code_reference: {
                    file: e.from_file,
                    symbol: e.display_name || e.symbol.split('/').pop()?.slice(0, 40) || 'scip-ref',
                    symbol_type: e.is_definition ? 'export' : 'import',
                    line_start: e.from_line + 1,
                  },
                  description: 'SCIP-resolved cross-file reference',
                  detected_from: 'scip-typescript',
                  confidence: 0.99,
                  timestamp: now,
                  last_verified: now,
                });
                added++;
              }
              if (options.verbose) {
                console.log(`    SCIP added ${added} cross-file edges (${scipResult.duration_ms}ms, ${scipResult.documents_indexed} docs)`);
              }
            }
          }
        } catch (err) {
          allWarnings.push({
            type: 'parse_error',
            message: `SCIP overlay failed: ${(err as Error).message}`,
          });
        }
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
        const swiftResult = await scanSwiftCode(root, incWalkSet);
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
        traceResult = await traceLLMCalls(root, incWalkSet);
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
      }, incWalkSet);

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

  // Deduplicate components by (type, name, primary-source-file) within current scan.
  //
  // Run 1.7 — Problem B: the prior key was `component.name` alone. That
  // collided cross-type — e.g., the file-level component for `lib/prisma.ts`
  // (type='component', name='prisma') vs the Prisma DB component
  // (type='database', name='prisma'). The DB component won on confidence;
  // the file component was silently dropped. But the import-scanner had
  // already emitted edges referencing the dropped file component_id —
  // 410 orphan edges on atomize-ai, which fired the integrity-promote and
  // truncated the graph (Problem A's loud symptom).
  //
  // The fix keys by `${type}|${name}|${first-config-file}`:
  //   • Different types coexist (was: collided).
  //   • Same-type same-name from different paths coexist (was: collided —
  //     `app/proxy.ts` and `proxy.ts` both produce a file-level component
  //     named `proxy`; both are real, both must be kept). Path
  //     disambiguation matches Run 1.6 verify #6's stable_id contract for
  //     the 6 component types where `name` alone isn't unique.
  //   • Same-type same-name same-file STILL dedupes (the genuine duplicate
  //     case — AST + regex both detecting the same service call), with
  //     highest confidence winning. For components with no config_files
  //     (rare) the key falls back to `${type}|${name}|` and behaves like
  //     the legacy by-name dedup within that type.
  const componentMap = new Map<string, ArchitectureComponent>();
  for (const component of allComponents) {
    const primaryFile = component.source?.config_files?.[0] ?? '';
    const key = `${component.type}|${component.name}|${primaryFile}`;
    const existing = componentMap.get(key);
    if (!existing || component.source.confidence > existing.source.confidence) {
      componentMap.set(key, component);
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

  // (C) Resolve FILE: prefixed connection targets to real component IDs
  // This enables trace to follow imports from route files instead of dead-ending
  const compByFile = new Map<string, string>(); // file path → component_id
  for (const comp of uniqueComponents) {
    for (const f of comp.source.config_files || []) {
      compByFile.set(f, comp.component_id);
    }
  }
  for (const conn of uniqueConnections) {
    if (conn.to.component_id?.startsWith('FILE:')) {
      const filePath = conn.to.component_id.slice(5);
      const realId = compByFile.get(filePath);
      if (realId) {
        conn.to.component_id = realId;
      }
    }
    if (conn.from.component_id?.startsWith('FILE:')) {
      const filePath = conn.from.component_id.slice(5);
      const realId = compByFile.get(filePath);
      if (realId) {
        conn.from.component_id = realId;
      }
    }
  }

  // Snapshot previous state before overwriting (for change tracking)
  // Also load the pre-scan snapshot for diff computation
  let preScanSnapshot = null;
  if (!options.clearFirst && decision.mode !== 'full') {
    try {
      await createSnapshot('pre-scan', config, root);
      preScanSnapshot = await loadLatestSnapshot(config, root);
    } catch {
      // No previous data to snapshot — first scan
    }
  } else if (decision.mode === 'full') {
    // For full scans, still create a snapshot for diff (if prior data exists)
    try {
      preScanSnapshot = await loadLatestSnapshot(config, root);
    } catch {
      // First-ever scan, no prior snapshot.
    }
  }

  // ==========================================================================
  // Phase 4 storage decision (Run 1 — D1 + D2):
  //   - 'full': clearStorage was already done up front; now store everything fresh.
  //   - 'incremental': clear ONLY components/connections that originate in the
  //     walk-set, then merge the freshly-scanned uniqueComponents/Connections
  //     with the survivors. Run integrity check; on failure, promote to full.
  // ==========================================================================

  let finalComponents = uniqueComponents;
  let finalConnections = uniqueConnections;

  if (decision.mode === 'incremental' && !options.clearFirst) {
    // Snapshot the FULL prior on-disk component set BEFORE clearForFiles —
    // we need it to remap surviving connections from old random component_ids
    // to the new ones (since stable_id is the join key but connections
    // reference component_id, which gets a fresh random suffix per scan).
    const preClearComponents = await loadAllComponents(config, root);

    // Clear only the touched subset.
    await clearForFiles(config, root, walkSet);

    // Load survivors (everything NOT in walk-set, still on disk).
    const survivingComponents = await loadAllComponents(config, root);
    const survivingConnections = await loadAllConnections(config, root);

    // Populate stable_ids on the in-memory uniqueComponents BEFORE merging.
    // Disk-loaded survivors get stable_ids from loadAllComponents, but
    // freshly-scanned components don't have them set until storeComponents
    // runs — and we merge BEFORE store. Without this, every fresh component
    // looks like a new entry to mergeByStableId (because its key falls back
    // to its random component_id), breaking dedup.
    for (const c of uniqueComponents) ensureStableIdPublic(c);

    // Merge: incoming wins on stable_id collision (component) or composite key (connection).
    // Components keyed by stable_id (or component_id fallback).
    finalComponents = mergeByStableId(
      survivingComponents,
      uniqueComponents,
      (c) => c.stable_id ?? c.component_id
    );

    // Build a remap: prior_component_id → new_component_id (via stable_id).
    // Connections from disk reference OLD random component_ids; the freshly
    // scanned components have NEW random component_ids. Same stable_id ties
    // them together. Rewrite surviving connection from/to ids so the merged
    // graph stays consistent.
    const stableToNewId = new Map<string, string>();
    for (const c of finalComponents) {
      if (c.stable_id) stableToNewId.set(c.stable_id, c.component_id);
    }
    // oldIdToStable: maps every PRIOR-scan component_id (including ones we
    // just deleted via clearForFiles) to its stable_id. Built from the
    // pre-clear snapshot so we can resolve connection refs to their new IDs.
    const oldIdToStable = new Map<string, string>();
    for (const c of preClearComponents) {
      if (c.stable_id) oldIdToStable.set(c.component_id, c.stable_id);
    }
    // Also map fresh components' ids → stable (no remap needed but keeps the
    // rewrite loop a no-op for these instead of leaving them undefined).
    for (const c of uniqueComponents) {
      if (c.stable_id) oldIdToStable.set(c.component_id, c.stable_id);
    }

    function remapId(id: string | undefined): string | undefined {
      if (!id) return id;
      if (id.startsWith('FILE:')) return id;
      const stable = oldIdToStable.get(id);
      if (stable) {
        const newId = stableToNewId.get(stable);
        if (newId) return newId;
      }
      return id; // No remap available — leave alone, integrity check may catch
    }

    // Rewrite surviving connections to use the latest component_ids.
    for (const conn of survivingConnections) {
      if (conn.from?.component_id) {
        conn.from.component_id = remapId(conn.from.component_id) ?? conn.from.component_id;
      }
      if (conn.to?.component_id) {
        conn.to.component_id = remapId(conn.to.component_id) ?? conn.to.component_id;
      }
    }

    // Connections keyed by from|to|type|file:line composite (matches dedup key).
    const connKey = (c: ArchitectureConnection): string =>
      `${c.from?.component_id ?? ''}|${c.to?.component_id ?? ''}|${c.connection_type}|${c.code_reference?.file ?? ''}:${c.code_reference?.line_start ?? ''}`;
    finalConnections = mergeByStableId(survivingConnections, uniqueConnections, connKey);

    // Integrity check: every connection endpoint must exist; every walk-set
    // component must reference real source files. On failure → promote to full.
    const integrity = await runIntegrityCheck(finalComponents, finalConnections, root, walkSet);
    if (!integrity.ok) {
      if (options.verbose) {
        console.log(`  Integrity check failed (${integrity.issues.length} issues) — promoting to full scan`);
        for (const issue of integrity.issues.slice(0, 3)) {
          console.log(`    ${issue}`);
        }
      }
      // ============================================================
      // Run 1.7 — Problem A (recursive re-entry promote)
      // ============================================================
      // The pre-Run-1.7 promote reused the in-memory uniqueComponents/
      // uniqueConnections that were just computed under the walk-set
      // restriction. After Run 1.5's walk-set plumbing, those are NOT
      // the full source tree — only the walk-set's slice of it. Reusing
      // them on promote truncated the graph (atomize-ai: 6,445 → 58
      // connections, 2,452 → 58 components).
      //
      // Fix: release the scan lock and recursively re-enter scan() with
      // `mode: 'full', clearFirst: true`. The inner scan walks the full
      // source tree, the lock re-acquires cleanly inside, and its result
      // is returned verbatim. The internal `_promotedFromIncremental`
      // flag tells the inner scan to label its timeline entry and stats
      // `scan_type: 'incremental→full'` — preserving the Run 1.6 #3
      // evidence-preservation contract.
      //
      // We `return` early so the rest of the outer scan's phases
      // (storage, timeline, manifest, hashes) don't double-run.
      lock.release();
      return await scan(root, {
        ...options,
        mode: 'full',
        clearFirst: true,
        incremental: false,
        _promotedFromIncremental: true,
      });
    }

    // ============================================================
    // Run 1.7 — orphan-disk-file cleanup on successful incremental merge.
    // ============================================================
    // `clearForFiles` only deletes disk files whose `source.config_files`
    // overlap the walk-set. Components produced by always-full scanners
    // (npm/pip/swift packages, infra, prisma) don't list user source
    // files in `config_files` (they list manifests / abs paths), so
    // their disk files survive `clearForFiles`. After the merge, the
    // freshly-scanned versions get NEW random `component_id`s and are
    // written to NEW filenames. The OLD survivor files are now orphans:
    // unreachable from `finalComponents` but still on disk.
    //
    // Pre-Run-1.7 this was masked by the always-failing integrity check
    // on real projects (`clearStorage` on promote wiped the orphans).
    // Now that integrity passes (Problem B fix), and the promote is
    // recursive (Problem A fix), this latent bug surfaces as a doubling
    // of `npm`/`database`/`config`/`infra` components per incremental.
    //
    // Fix: after the merge, walk the components/connections directories
    // and unlink any file whose ID isn't in `finalComponents` /
    // `finalConnections`. Idempotent and atomic per-file (unlink errors
    // are silently swallowed — best-effort, matches the integrity-promote
    // pattern). Connections also need this since their random IDs aren't
    // stable across scans either.
    {
      const finalComponentIds = new Set(finalComponents.map((c) => c.component_id));
      const finalConnectionIds = new Set(finalConnections.map((c) => c.connection_id));
      const fsPromises = (await import('node:fs')).promises;
      const purgeOrphans = async (dir: string, keepIds: Set<string>): Promise<void> => {
        try {
          const files = await fsPromises.readdir(dir);
          await Promise.all(
            files
              .filter((f) => f.endsWith('.json'))
              .map(async (f) => {
                const id = f.slice(0, -'.json'.length);
                if (!keepIds.has(id)) {
                  await fsPromises.unlink(path.join(dir, f)).catch(() => {});
                }
              })
          );
        } catch {
          // Dir missing or unreadable — non-fatal.
        }
      };
      await purgeOrphans(getComponentsPath(config, root), finalComponentIds);
      await purgeOrphans(getConnectionsPath(config, root), finalConnectionIds);
    }
  }

  // Store final state (atomic per-file writes — see storage.ts).
  await storeComponents(finalComponents, config, root);
  await storeConnections(finalConnections, config, root);

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
      scan_type: scanType,
      // Run 1.6 — item #3: report walk-set size for 'incremental' AND for the
      // legacy in-place 'incremental→full' promote (which kept walkSet
      // populated), so a silent integrity-promote didn't erase evidence
      // that an incremental walk-set was attempted.
      //
      // Run 1.7 — Problem A: the recursive-re-entry promote runs as a true
      // full scan (walkSet empty). Reporting `walkSet.size = 0` would be
      // dishonest — the inner scan really did walk every source file.
      // Report `sourceFiles.length` in that case. Run 1.6 #3 still holds:
      // any future in-place promote path (walkSet populated under
      // 'incremental→full') reports walk-set size.
      // Use decision.mode (the EFFECTIVE scan mode) instead of scanType
      // (the user-visible label). On the recursive-re-entry promote (Run 1.7
      // Problem A), decision.mode='full' even though scanType='incremental→full',
      // and walkSet may be populated by the still-modified file — but the inner
      // scan walked the full source tree, so files_scanned must be sourceFiles.length.
      files_scanned:
        decision.mode === 'incremental' && walkSet.size > 0
          ? walkSet.size
          : sourceFiles.length,
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

  // ==========================================================================
  // Phase 5.4: Derived reverse-deps index + manifest (Run 1.6 — items #8 + #9)
  // ==========================================================================
  // The reverse-deps index lets the next incremental scan compute walk-set
  // expansion from a single file open instead of walking every per-edge JSON.
  // The manifest lists all derived artifacts with their generated_at stamps.
  let reverseDepsEdgeCount: number | undefined;
  try {
    const result = await buildReverseDepsIndex(finalComponents, finalConnections, config, root);
    reverseDepsEdgeCount = result.edge_count;
  } catch (err) {
    if (process.env['NAVGATOR_DEBUG']) {
      console.error('[reverse-deps] index build skipped:', (err as Error).message);
    }
  }
  try {
    await buildDerivedManifest(config, root, { reverseDepsEdgeCount });
  } catch (err) {
    if (process.env['NAVGATOR_DEBUG']) {
      console.error('[manifest] write skipped:', (err as Error).message);
    }
  }

  // ==========================================================================
  // Phase 5.5: Annotate index with mode-tracking fields (Run 1 — D2)
  //   Run AFTER buildIndex so we can annotate the freshly-written index
  //   without buildIndex needing to know about modes.
  // ==========================================================================
  try {
    const freshIndex = await loadIndex(config, root);
    if (freshIndex) {
      if (scanType === 'full' || scanType === 'incremental→full') {
        freshIndex.last_full_scan = Date.now();
        freshIndex.incrementals_since_full = 0;
      } else if (scanType === 'incremental') {
        // Preserve last_full_scan from prior index; bump counter.
        if (priorIndex) {
          freshIndex.last_full_scan = priorIndex.last_full_scan ?? priorIndex.last_scan ?? 0;
        }
        freshIndex.incrementals_since_full = (priorIndex?.incrementals_since_full ?? 0) + 1;
      }
      // Always set schema_version to current build's version.
      freshIndex.schema_version = SCHEMA_VERSION;
      await atomicWriteJSON(getIndexPath(config, root), freshIndex);
    }
  } catch {
    // Non-fatal: mode-tracking annotation is best-effort.
  }

  // Compute graph-wide metrics (PageRank + Louvain communities) → metrics.json,
  // and back-write per-component scores into component metadata so any consumer
  // that loads a component sees them. Suppressed for graphs <20 nodes.
  try {
    const { computeAndStoreMetrics } = await import('./metrics/pagerank-louvain.js');
    await computeAndStoreMetrics(config, root, {
      components: finalComponents,
      connections: finalConnections,
    });
  } catch (err) {
    // Non-fatal — scan still produces all other artifacts.
    if (process.env['NAVGATOR_DEBUG']) {
      console.error('[metrics] PageRank/Louvain skipped:', (err as Error).message);
    }
  }

  await buildSummary(config, root, promptScanResultHolder, projectMetadata, timelineEntry, gitInfo);

  // Markdown views + connections.jsonl (T3, trimmed scope).
  // Derived from in-memory components/connections — JSON remains canonical.
  // Emits .navgator/architecture/components-md/<type>/<slug>.md (Obsidian-readable,
  // git-diff-friendly, ripgrep-targetable) and connections.jsonl.
  // Disable via NAVGATOR_NO_MARKDOWN=1 if downstream tooling chokes.
  if (process.env['NAVGATOR_NO_MARKDOWN'] !== '1') {
    try {
      const { writeComponentMarkdownViews, writeConnectionsJsonl } = await import('./storage/markdown-view.js');
      const { getStoragePath: getStoragePathFn } = await import('./config.js');
      const storeDir = getStoragePathFn(config, root);
      await writeComponentMarkdownViews(storeDir, finalComponents, finalConnections);
      await writeConnectionsJsonl(storeDir, finalComponents, finalConnections);
    } catch (err) {
      if (process.env['NAVGATOR_DEBUG']) {
        console.error('[markdown-view] skipped:', (err as Error).message);
      }
    }
  }

  // Git-backed temporal snapshot (T5). Commits the .navgator/ directory to a
  // NESTED git store at .navgator/.git — invisible to the parent repo
  // (gitignored). OPT-IN: enable via NAVGATOR_COMMIT=1 or `--commit` scan
  // flag. Per-scan git subprocess overhead is ~180ms; default is OFF to
  // preserve the speed criterion.
  if (process.env['NAVGATOR_COMMIT'] === '1' || options.commit === true) {
    try {
      const { commitScan } = await import('./temporal/git-store.js');
      const { getStoragePath } = await import('./config.js');
      const storeDir = getStoragePath(config, root);
      const sha7 = (gitInfo?.commit ?? '').slice(0, 7);
      const msg = `scan ${new Date().toISOString()}${sha7 ? ` @ ${sha7}` : ''}`;
      const result = commitScan(storeDir, msg);
      if (!result.ok && process.env['NAVGATOR_DEBUG']) {
        console.error('[temporal] commit failed:', result.error);
      }
    } catch (err) {
      if (process.env['NAVGATOR_DEBUG']) {
        console.error('[temporal] skipped:', (err as Error).message);
      }
    }
  }

  // Persist prompt scan results if available
  if (promptScanResultHolder) {
    await savePromptScan(promptScanResultHolder, config, root);
  }

  // Register project in global registry
  try {
    await registerProject(
      root,
      {
        components: finalComponents.length,
        connections: finalConnections.length,
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

  // Phase 6: hash both source files AND manifests so manifest edits are
  // detectable on the next scan (selectScanMode uses this to fire 'manifest-changed').
  const fileHashes = await computeFileHashes(filesForChangeDetection, root);
  await saveHashes(fileHashes, config, root);

  const duration = Date.now() - startTime;
  const filesChanged = fileChanges
    ? fileChanges.added.length + fileChanges.modified.length + fileChanges.removed.length
    : sourceFiles.length;

  if (options.verbose) {
    console.log(`\nScan complete in ${duration}ms`);
    console.log(`  Components: ${finalComponents.length}`);
    console.log(`  Connections: ${finalConnections.length}`);
    console.log(`  Files scanned: ${sourceFiles.length}`);
    console.log(`  Files changed: ${filesChanged}`);
    console.log(`  Warnings: ${allWarnings.length}`);
  }

  // Gitignore safety guard: NavGator's per-config-var component files and
  // NAVSUMMARY docs include parsed hostnames from .env files. They're
  // regenerated on every scan, so there's no loss from keeping them local.
  // Auto-add gitignore entries on first scan so hostnames don't drift into
  // git history. Silent unless it makes a change.
  try {
    const guardResult = await ensureSafeGitignore(root);
    if (guardResult.action === 'added' && options.verbose) {
      console.log(
        `  NavGator safety guard: added gitignore block for architecture/components/COMP_config_*.json + NAVSUMMARY*.md`
      );
    }
  } catch {
    // Non-fatal: scan already completed, gitignore guard is best-effort
  }

  return {
    components: finalComponents,
    connections: finalConnections,
    warnings: allWarnings,
    fileChanges,
    promptScan: promptScanResultHolder,
    fieldUsageReport: fieldUsageReportResult,
    typeSpecReport: typeSpecReportResult,
    timelineEntry,
    gitInfo,
    stats: {
      scan_duration_ms: duration,
      components_found: finalComponents.length,
      connections_found: finalConnections.length,
      warnings_count: allWarnings.length,
      // Run 1.6 — item #3 / Run 1.7 — Problem A: walk-set size for incremental
      // and for an in-place promote (walkSet populated). Recursive-re-entry
      // promote (walkSet empty) reports actual source-file count.
      // Use decision.mode (the EFFECTIVE scan mode) instead of scanType
      // (the user-visible label). On the recursive-re-entry promote (Run 1.7
      // Problem A), decision.mode='full' even though scanType='incremental→full',
      // and walkSet may be populated by the still-modified file — but the inner
      // scan walked the full source tree, so files_scanned must be sourceFiles.length.
      files_scanned:
        decision.mode === 'incremental' && walkSet.size > 0
          ? walkSet.size
          : sourceFiles.length,
      files_changed: filesChanged,
      prompts_found: promptScanResultHolder?.prompts.length,
    },
  };
  } finally {
    // Run 1.6 — item #4: release the scan lock on every exit path
    // (success, early-return, throw). Idempotent.
    lock.release();
  }
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
