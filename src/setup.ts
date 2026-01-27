/**
 * NavGator Setup & Initial Scan
 *
 * Provides a two-phase scanning approach:
 * 1. Fast scan: Quick package detection, basic file structure (instant feedback)
 * 2. Deep scan: Full AST analysis, connection detection, prompt scanning
 *
 * The fast scan uses lightweight regex patterns and file system analysis.
 * The deep scan uses ts-morph AST analysis for accurate detection.
 */

import * as fs from 'fs';
import * as path from 'path';
import { scan, quickScan } from './scanner.js';
import { getConfig } from './config.js';
import { generateMermaidDiagram, generateSummaryDiagram } from './diagram.js';
import { loadGraph } from './storage.js';
import { ArchitectureIndex } from './types.js';

export interface SetupOptions {
  /** Project root path */
  projectPath?: string;
  /** Skip the deep scan phase */
  fastOnly?: boolean;
  /** Run deep scan immediately instead of in background */
  deepImmediate?: boolean;
  /** Generate initial diagram */
  generateDiagram?: boolean;
  /** Verbose output */
  verbose?: boolean;
  /** Callback for progress updates */
  onProgress?: (phase: string, message: string) => void;
}

export interface SetupResult {
  success: boolean;
  fastScanComplete: boolean;
  deepScanComplete: boolean;
  componentsFound: number;
  connectionsFound: number;
  promptsFound: number;
  diagram?: string;
  duration: {
    fastMs: number;
    deepMs?: number;
    totalMs: number;
  };
  errors: string[];
}

/**
 * Run initial NavGator setup with two-phase scanning
 */
export async function setup(options: SetupOptions = {}): Promise<SetupResult> {
  const projectPath = options.projectPath || process.cwd();
  const startTime = Date.now();
  const errors: string[] = [];

  const progress = options.onProgress || ((phase: string, msg: string) => {
    if (options.verbose) {
      console.log(`[${phase}] ${msg}`);
    }
  });

  let fastScanComplete = false;
  let deepScanComplete = false;
  let componentsFound = 0;
  let connectionsFound = 0;
  let promptsFound = 0;
  let diagram: string | undefined;
  let fastDuration = 0;
  let deepDuration: number | undefined;

  // ==========================================================================
  // PHASE 1: Fast Scan
  // ==========================================================================

  progress('FAST', 'Starting fast scan...');
  const fastStart = Date.now();

  try {
    const fastResult = await quickScan(projectPath);

    componentsFound = fastResult.components.length;
    connectionsFound = fastResult.connections.length;

    fastScanComplete = true;
    fastDuration = Date.now() - fastStart;

    progress('FAST', `Found ${componentsFound} components in ${fastDuration}ms`);

    // Generate initial diagram from fast scan
    if (options.generateDiagram) {
      progress('FAST', 'Generating initial diagram...');
      const config = getConfig();
      const graph = await loadGraph(config);

      if (graph) {
        diagram = generateSummaryDiagram(graph, { maxNodes: 30 });
        progress('FAST', 'Initial diagram generated');
      }
    }

    // Create initial index to mark scan as complete
    await markScanComplete(projectPath, {
      totalComponents: componentsFound,
      totalConnections: connectionsFound,
      phase: 'fast',
    });

  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Fast scan failed';
    errors.push(msg);
    progress('FAST', `Error: ${msg}`);
  }

  // ==========================================================================
  // PHASE 2: Deep Scan (if not fastOnly)
  // ==========================================================================

  if (!options.fastOnly) {
    progress('DEEP', 'Starting deep scan with full analysis...');
    const deepStart = Date.now();

    try {
      const deepResult = await scan(projectPath, {
        connections: true,
        prompts: true,
        useAST: true,
        verbose: options.verbose,
      });

      componentsFound = deepResult.components.length;
      connectionsFound = deepResult.connections.length;
      promptsFound = deepResult.promptScan?.prompts.length || 0;

      deepScanComplete = true;
      deepDuration = Date.now() - deepStart;

      progress('DEEP', `Found ${componentsFound} components, ${connectionsFound} connections, ${promptsFound} prompts in ${deepDuration}ms`);

      // Update diagram with deeper analysis
      if (options.generateDiagram) {
        progress('DEEP', 'Updating diagram with full analysis...');
        const config = getConfig();
        const graph = await loadGraph(config);

        if (graph) {
          diagram = generateMermaidDiagram(graph, { maxNodes: 50 });
          progress('DEEP', 'Full diagram generated');
        }
      }

      // Mark deep scan complete
      await markScanComplete(projectPath, {
        totalComponents: componentsFound,
        totalConnections: connectionsFound,
        phase: 'deep',
      });

    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Deep scan failed';
      errors.push(msg);
      progress('DEEP', `Error: ${msg}`);
    }
  }

  const totalDuration = Date.now() - startTime;

  return {
    success: fastScanComplete && (options.fastOnly || deepScanComplete),
    fastScanComplete,
    deepScanComplete,
    componentsFound,
    connectionsFound,
    promptsFound,
    diagram,
    duration: {
      fastMs: fastDuration,
      deepMs: deepDuration,
      totalMs: totalDuration,
    },
    errors,
  };
}

/**
 * Run fast scan only (for quick initial view)
 */
export async function fastSetup(projectPath?: string): Promise<SetupResult> {
  return setup({
    projectPath,
    fastOnly: true,
    generateDiagram: true,
  });
}

/**
 * Run full setup with both phases
 */
export async function fullSetup(projectPath?: string): Promise<SetupResult> {
  return setup({
    projectPath,
    fastOnly: false,
    generateDiagram: true,
    verbose: true,
  });
}

/**
 * Check if NavGator has been set up for a project
 */
export async function isSetupComplete(projectPath?: string): Promise<{
  hasScanned: boolean;
  lastScan?: Date;
  phase?: 'fast' | 'deep';
  stale: boolean;
}> {
  const root = projectPath || process.cwd();
  const indexPath = path.join(root, '.claude', 'architecture', 'index.json');

  try {
    const content = await fs.promises.readFile(indexPath, 'utf-8');
    const index = JSON.parse(content) as ArchitectureIndex;

    const lastScan = new Date(index.last_scan);
    const hoursSince = (Date.now() - index.last_scan) / (1000 * 60 * 60);

    return {
      hasScanned: true,
      lastScan,
      phase: index.version?.includes('deep') ? 'deep' : 'fast',
      stale: hoursSince > 24,
    };
  } catch {
    return {
      hasScanned: false,
      stale: true,
    };
  }
}

/**
 * Mark scan as complete in the index
 */
async function markScanComplete(
  projectPath: string,
  stats: { totalComponents: number; totalConnections: number; phase: 'fast' | 'deep' }
): Promise<void> {
  const config = getConfig();
  const archDir = path.join(projectPath, '.claude', 'architecture');

  // Ensure directory exists
  await fs.promises.mkdir(archDir, { recursive: true });

  const indexPath = path.join(archDir, 'index.json');

  let index: ArchitectureIndex;

  try {
    const content = await fs.promises.readFile(indexPath, 'utf-8');
    index = JSON.parse(content);
  } catch {
    index = {
      version: '1.0.0',
      last_scan: Date.now(),
      project_path: projectPath,
      components: {
        by_name: {},
        by_type: {} as Record<string, string[]>,
        by_layer: {} as Record<string, string[]>,
        by_status: {} as Record<string, string[]>,
      },
      connections: {
        by_type: {} as Record<string, string[]>,
        by_from: {},
        by_to: {},
      },
      stats: {
        total_components: 0,
        total_connections: 0,
        components_by_type: {},
        connections_by_type: {},
        outdated_count: 0,
        vulnerable_count: 0,
      },
    };
  }

  index.last_scan = Date.now();
  index.version = `1.0.0-${stats.phase}`;
  index.stats.total_components = stats.totalComponents;
  index.stats.total_connections = stats.totalConnections;

  await fs.promises.writeFile(indexPath, JSON.stringify(index, null, 2));
}

/**
 * Get setup status for display
 */
export function formatSetupStatus(result: SetupResult): string {
  const lines: string[] = [];

  lines.push('');
  lines.push('╔═══════════════════════════════════════════════════════════╗');
  lines.push('║                    NavGator Setup Complete                ║');
  lines.push('╚═══════════════════════════════════════════════════════════╝');
  lines.push('');

  if (result.success) {
    lines.push('✓ Architecture scan complete');
    lines.push('');
    lines.push(`  Components: ${result.componentsFound}`);
    lines.push(`  Connections: ${result.connectionsFound}`);
    if (result.promptsFound > 0) {
      lines.push(`  AI Prompts: ${result.promptsFound}`);
    }
    lines.push('');
    lines.push(`  Fast scan: ${result.duration.fastMs}ms`);
    if (result.duration.deepMs) {
      lines.push(`  Deep scan: ${result.duration.deepMs}ms`);
    }
    lines.push(`  Total: ${result.duration.totalMs}ms`);
  } else {
    lines.push('⚠ Setup completed with errors:');
    for (const error of result.errors) {
      lines.push(`  - ${error}`);
    }
  }

  lines.push('');
  lines.push('Next steps:');
  lines.push('  • navgator status     - View architecture summary');
  lines.push('  • navgator diagram    - Generate visual diagram');
  lines.push('  • navgator impact <x> - See what changes affect');
  lines.push('');

  return lines.join('\n');
}
