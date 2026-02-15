#!/usr/bin/env node

/**
 * NavGator CLI
 * Architecture connection tracker for Claude Code
 */

import { Command } from 'commander';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as readline from 'readline';
import { scan, quickScan, getScanStatus, scanPromptsOnly, formatPromptsOutput, formatPromptDetail } from '../scanner.js';
import { loadIndex, loadAllComponents, loadAllConnections, loadGraph, getStorageStats, loadFileMap } from '../storage.js';
import { getConfig } from '../config.js';
import {
  generateMermaidDiagram,
  generateComponentDiagram,
  generateLayerDiagram,
  generateSummaryDiagram,
  wrapInMarkdown,
  DiagramOptions,
} from '../diagram.js';
import { ArchitectureLayer } from '../types.js';
import { computeImpact, computeSeverity } from '../impact.js';
import { wrapInEnvelope, buildExecutiveSummary } from '../agent-output.js';
import { getGitInfo } from '../git.js';
import { setup, fastSetup, isSetupComplete, formatSetupStatus } from '../setup.js';
import { resolveComponent, findCandidates } from '../resolve.js';
import { traceDataflow, formatTraceOutput } from '../trace.js';
import { checkRules, getBuiltinRules, loadCustomRules, formatRulesOutput } from '../rules.js';
import { computeCoverage, formatCoverageOutput } from '../coverage.js';
import { extractSubgraph, subgraphToMermaid } from '../subgraph.js';
import { isSandboxMode } from '../sandbox.js';
import { fileURLToPath } from 'url';
import { spawn, ChildProcess } from 'child_process';

const NAVGATOR_LOGO = `
  _   _             ____       _
 | \\ | | __ ___   _/ ___| __ _| |_ ___  _ __
 |  \\| |/ _\` \\ \\ / / |  _ / _\` | __/ _ \\| '__|
 | |\\  | (_| |\\ V /| |_| | (_| | || (_) | |
 |_| \\_|\\__,_| \\_/  \\____|\\__,_|\\__\\___/|_|

  Architecture Connection Tracker
  Know your stack before you change it
`;

const program = new Command();

program
  .name('navgator')
  .description('Architecture connection tracker - know your stack before you change it')
  .version('0.2.2')
  .option('--sandbox', 'Run in sandbox mode (restricts network, interactive, child processes)')
  .addHelpText('beforeAll', NAVGATOR_LOGO);

// Apply sandbox flag globally before any command runs
program.hook('preAction', () => {
  if (program.opts().sandbox) {
    process.env.NAVGATOR_SANDBOX = '1';
  }
});

// =============================================================================
// WELCOME MENU (shown after setup or when no command provided)
// =============================================================================

async function launchWebUI(options: {
  port?: number;
  projectPath?: string;
}): Promise<{ port: number; process: ChildProcess }> {
  const port = options.port || 3000;
  const projectPath = options.projectPath || process.cwd();

  // Resolve standalone server.js relative to package root
  const cliDir = path.dirname(fileURLToPath(import.meta.url));
  const packageRoot = path.resolve(cliDir, '..', '..');
  const serverJs = path.join(packageRoot, 'web', '.next', 'standalone', 'web', 'server.js');

  if (!fs.existsSync(serverJs)) {
    throw new Error(
      `Next.js standalone server not found at:\n  ${serverJs}\n\n` +
      'Run `npm run build` from the NavGator root to build the web UI.'
    );
  }

  const child = spawn('node', [serverJs], {
    env: {
      ...process.env,
      PORT: String(port),
      HOSTNAME: '0.0.0.0',
      NAVGATOR_PROJECT_PATH: projectPath,
    },
    cwd: path.dirname(serverJs),
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  // Wait for "Ready" or listening message
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      resolve(); // proceed even if no explicit "Ready" message after 5s
    }, 5000);

    const onData = (data: Buffer) => {
      const msg = data.toString();
      if (msg.includes('Ready') || msg.includes('ready') || msg.includes('started') || msg.includes('listening')) {
        clearTimeout(timeout);
        resolve();
      }
    };

    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);

    child.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    child.on('exit', (code) => {
      if (code !== null && code !== 0) {
        clearTimeout(timeout);
        reject(new Error(`Server exited with code ${code}`));
      }
    });
  });

  return { port, process: child };
}

async function launchUI(projectPath?: string): Promise<void> {
  const resolvedPath = projectPath || process.cwd();
  const port = 3000;

  console.log('');
  console.log('🐊 NavGator Dashboard');
  console.log(`   Project: ${resolvedPath}`);
  console.log('');

  const { process: serverProcess } = await launchWebUI({
    port,
    projectPath: resolvedPath,
  });

  const url = `http://localhost:${port}`;
  console.log(`Dashboard running at: ${url}`);
  console.log('');
  console.log('Press Ctrl+C to stop');
  console.log('');

  // Try to open browser
  const { exec } = await import('child_process');
  const openCmd = process.platform === 'darwin' ? 'open' :
                  process.platform === 'win32' ? 'start' : 'xdg-open';
  exec(`${openCmd} ${url}`);

  // Keep process running, clean up child on exit
  const cleanup = () => {
    console.log('\nShutting down...');
    serverProcess.kill();
    process.exit(0);
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}

async function runScan(): Promise<void> {
  console.log('NavGator - Scanning architecture...\n');

  const result = await scan(process.cwd(), {
    prompts: true,
    verbose: false,
  });

  console.log('\n========================================');
  console.log('SCAN COMPLETE');
  console.log('========================================\n');

  const byType: Record<string, number> = {};
  for (const c of result.components) {
    byType[c.type] = (byType[c.type] || 0) + 1;
  }

  console.log('COMPONENTS:');
  for (const [type, count] of Object.entries(byType)) {
    console.log(`  ${type}: ${count}`);
  }

  console.log(`\nFiles scanned: ${result.stats.files_scanned}`);
  console.log(`Scan completed in ${result.stats.scan_duration_ms}ms`);
}

async function showStatus(): Promise<void> {
  const config = getConfig();
  const index = await loadIndex(config);

  if (!index) {
    console.log('No architecture data found. Run `navgator setup` first.');
    return;
  }

  console.log('NavGator - Architecture Status\n');
  console.log('========================================');

  const lastScan = new Date(index.last_scan);
  const hoursSince = Math.round((Date.now() - index.last_scan) / (1000 * 60 * 60));

  console.log(`Last scan: ${lastScan.toLocaleString()} (${hoursSince}h ago)`);
  console.log(`Total components: ${index.stats.total_components}`);
  console.log(`Total connections: ${index.stats.total_connections}`);

  if (index.stats.outdated_count > 0) {
    console.log(`Outdated packages: ${index.stats.outdated_count}`);
  }

  console.log('\nCOMPONENTS BY TYPE:');
  for (const [type, count] of Object.entries(index.stats.components_by_type)) {
    console.log(`  ${type}: ${count}`);
  }
}

function showPostSetupGuidance(): void {
  console.log('');
  console.log('  Your architecture dashboard is ready!');
  console.log('');
  console.log('  What NavGator gives you:');
  console.log('    - Interactive SVG diagrams (zoom, pan, click) + Mermaid export');
  console.log('    - LLM call site tracking with provider/model analysis');
  console.log('    - Component & connection maps with code-level evidence');
  console.log('');
  console.log('  Quick reference:');
  console.log('    navgator          Open the welcome menu');
  console.log('    navgator ui       Launch the full dashboard');
  console.log('    navgator scan     Re-scan the project');
  console.log('    navgator diagram  Generate a Mermaid diagram');
  console.log('');
}

async function showWelcomeMenu(context: 'post-setup' | 'no-command'): Promise<void> {
  if (context === 'no-command') {
    console.log(NAVGATOR_LOGO);
    console.log('  Tip: Run `navgator ui` to launch the full dashboard.\n');
  }

  console.log('  What would you like to do?\n');
  console.log('  1) Launch the dashboard UI');
  console.log('  2) Run a scan');
  console.log('  3) View project status');
  console.log('  4) Exit');
  console.log('');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>((resolve) => {
    rl.question('  Choose (1-4): ', resolve);
  });
  rl.close();

  switch (answer.trim()) {
    case '1':
      await launchUI();
      break;
    case '2':
      await runScan();
      break;
    case '3':
      await showStatus();
      break;
    default:
      console.log('');
      break;
  }
}

// =============================================================================
// SETUP COMMAND (New - Initial Installation)
// =============================================================================

program
  .command('setup')
  .description('Initialize NavGator with a two-phase scan (fast initial + deep follow-up)')
  .option('-f, --fast', 'Run fast scan only (skip deep analysis)')
  .option('-v, --verbose', 'Show detailed progress')
  .option('--no-diagram', 'Skip diagram generation')
  .action(async (options) => {
    try {
      console.log('');
      console.log('🐊 NavGator - Architecture Connection Tracker');
      console.log('   Know your stack before you change it');
      console.log('');

      // Offer to link as Claude Code plugin (skip in sandbox mode)
      const claudeDir = path.join(os.homedir(), '.claude');
      if (fs.existsSync(claudeDir) && !isSandboxMode()) {
        const pluginDir = path.join(claudeDir, 'plugins');
        const linkPath = path.join(pluginDir, 'navgator');
        const packageRoot = path.resolve(import.meta.dirname, '..', '..');
        let alreadyLinked = false;

        try {
          const existing = fs.readlinkSync(linkPath);
          if (existing === packageRoot) alreadyLinked = true;
        } catch {}

        if (!alreadyLinked) {
          console.log('Claude Code detected.');
          console.log('NavGator can register as a Claude Code plugin by creating a symlink:');
          console.log(`  ${linkPath} -> ${packageRoot}`);
          console.log('This enables hooks, skills, and slash commands inside Claude Code.\n');

          const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
          const answer = await new Promise<string>((resolve) => {
            rl.question('Link NavGator as a Claude Code plugin? (y/N) ', resolve);
          });
          rl.close();

          if (answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes') {
            try {
              fs.mkdirSync(pluginDir, { recursive: true });
              // Remove stale link if it points elsewhere
              try { fs.unlinkSync(linkPath); } catch {}
              fs.symlinkSync(packageRoot, linkPath, 'dir');
              console.log('Plugin linked successfully.\n');
            } catch (err) {
              console.log('Could not auto-link. Link manually:');
              console.log(`  ln -s ${packageRoot} ${linkPath}\n`);
            }
          } else {
            console.log('Skipped plugin linking. You can link manually later:');
            console.log(`  ln -s ${packageRoot} ${linkPath}\n`);
          }
        }
      }

      // Check if already set up
      const status = await isSetupComplete();
      if (status.hasScanned && !status.stale) {
        console.log('NavGator is already set up for this project.');
        console.log(`Last scan: ${status.lastScan?.toLocaleString()}`);
        console.log(`Scan depth: ${status.phase}`);
        console.log('');
        await showWelcomeMenu('post-setup');
        return;
      }

      // Progress callback
      const onProgress = (phase: string, message: string) => {
        const icon = phase === 'FAST' ? '⚡' : '🔍';
        console.log(`${icon} [${phase}] ${message}`);
      };

      // Run setup
      const result = await setup({
        fastOnly: options.fast,
        generateDiagram: options.diagram !== false,
        verbose: options.verbose,
        onProgress,
      });

      // Display results
      console.log(formatSetupStatus(result));

      // Show diagram preview if generated
      if (result.diagram) {
        console.log('Architecture Diagram Preview:');
        console.log('─'.repeat(60));
        // Show first 30 lines
        const lines = result.diagram.split('\n').slice(0, 30);
        console.log(lines.join('\n'));
        if (result.diagram.split('\n').length > 30) {
          console.log('... (run `navgator diagram` to see full diagram)');
        }
        console.log('');
      }

      // Show post-setup guidance + welcome menu
      showPostSetupGuidance();
      await showWelcomeMenu('post-setup');

    } catch (error) {
      console.error('Setup failed:', error);
      process.exit(1);
    }
  });

// =============================================================================
// SCAN COMMAND
// =============================================================================

program
  .command('scan')
  .description('Scan project architecture and update connection tracking')
  .option('-q, --quick', 'Quick scan (packages only, no code analysis)')
  .option('-c, --connections', 'Focus on connection detection')
  .option('-p, --prompts', 'Enhanced AI prompt scanning with full content')
  .option('-v, --verbose', 'Show detailed output')
  .option('--clear', 'Clear existing data before scanning')
  .option('--ast', 'Use AST-based scanning (more accurate, slightly slower)')
  .option('--track-branch', 'Capture git branch/commit in scan output')
  .option('--json', 'Output scan results as JSON')
  .option('--agent', 'Output wrapped in agent envelope (implies --json)')
  .action(async (options) => {
    try {
      const isAgent = !!options.agent;
      const isJson = !!options.json || isAgent;

      // Suppress console output in agent/json mode
      const origLog = console.log;
      if (isJson) {
        console.log = () => {};
      }

      const result = await scan(process.cwd(), {
        quick: options.quick,
        connections: options.connections,
        prompts: options.prompts,
        verbose: options.verbose,
        clearFirst: options.clear,
        useAST: options.ast,
        trackBranch: options.trackBranch,
      });

      // Restore console for output
      if (isJson) {
        console.log = origLog;
      }

      // JSON/Agent output mode
      if (isJson) {
        const jsonData: Record<string, unknown> = {
          components_found: result.stats.components_found,
          connections_found: result.stats.connections_found,
          scan_duration_ms: result.stats.scan_duration_ms,
          files_scanned: result.stats.files_scanned,
          files_changed: result.stats.files_changed,
          warnings_count: result.stats.warnings_count,
          prompts_found: result.stats.prompts_found,
        };
        if (result.gitInfo) {
          jsonData.git = result.gitInfo;
        }
        if (result.timelineEntry) {
          jsonData.significance = result.timelineEntry.significance;
          jsonData.triggers = result.timelineEntry.triggers;
          jsonData.total_changes = result.timelineEntry.diff.stats.total_changes;
        }

        if (isAgent) {
          console.log(wrapInEnvelope('scan', jsonData));
        } else {
          console.log(JSON.stringify(jsonData, null, 2));
        }
        return;
      }

      console.log('\n========================================');
      console.log('SCAN COMPLETE');
      console.log('========================================\n');

      // Group components by type
      const byType: Record<string, number> = {};
      for (const c of result.components) {
        byType[c.type] = (byType[c.type] || 0) + 1;
      }

      console.log('COMPONENTS:');
      for (const [type, count] of Object.entries(byType)) {
        console.log(`  ${type}: ${count}`);
      }

      // Group connections by type
      const connByType: Record<string, number> = {};
      for (const c of result.connections) {
        connByType[c.connection_type] = (connByType[c.connection_type] || 0) + 1;
      }

      if (Object.keys(connByType).length > 0) {
        console.log('\nCONNECTIONS:');
        for (const [type, count] of Object.entries(connByType)) {
          console.log(`  ${type}: ${count}`);
        }
      }

      if (result.warnings.length > 0) {
        console.log(`\nWARNINGS: ${result.warnings.length}`);
        for (const w of result.warnings.slice(0, 5)) {
          console.log(`  - ${w.message}`);
        }
        if (result.warnings.length > 5) {
          console.log(`  ... and ${result.warnings.length - 5} more`);
        }
      }

      // Show file change summary
      if (result.fileChanges) {
        const { added, modified, removed } = result.fileChanges;
        if (added.length > 0 || modified.length > 0 || removed.length > 0) {
          console.log('\nFILE CHANGES:');
          if (added.length > 0) console.log(`  Added: ${added.length}`);
          if (modified.length > 0) console.log(`  Modified: ${modified.length}`);
          if (removed.length > 0) console.log(`  Removed: ${removed.length}`);
        }
      }

      // Show prompt scan results if enhanced scanning was used
      if (result.promptScan && result.promptScan.prompts.length > 0) {
        console.log('\nAI PROMPTS:');
        console.log(`  Total: ${result.promptScan.summary.totalPrompts}`);
        console.log(`  Templates: ${result.promptScan.summary.templatesCount}`);
        if (Object.keys(result.promptScan.summary.byProvider).length > 0) {
          console.log('  By provider:');
          for (const [provider, count] of Object.entries(result.promptScan.summary.byProvider)) {
            console.log(`    ${provider}: ${count}`);
          }
        }
      }

      console.log(`\nFiles scanned: ${result.stats.files_scanned}`);
      console.log(`Scan completed in ${result.stats.scan_duration_ms}ms`);

      // Show branch info if tracking
      if (result.gitInfo) {
        console.log(`Branch: ${result.gitInfo.branch} @ ${result.gitInfo.commit}`);
      }

      // Project registration is now handled inside the scanner (Phase 5)

      // Show timeline entry summary if available
      if (result.timelineEntry && result.timelineEntry.diff.stats.total_changes > 0) {
        console.log(`\nArchitecture diff: ${result.timelineEntry.significance.toUpperCase()} — ${result.timelineEntry.diff.stats.total_changes} change(s)`);
        if (result.timelineEntry.triggers.length > 0) {
          console.log(`  Triggers: ${result.timelineEntry.triggers.join(', ')}`);
        }
      }
    } catch (error) {
      console.error('Scan failed:', error);
      process.exit(1);
    }
  });

// =============================================================================
// STATUS COMMAND
// =============================================================================

program
  .command('status')
  .description('Show architecture summary and health status')
  .option('--json', 'Output as JSON')
  .option('--agent', 'Output wrapped in agent envelope (implies --json)')
  .action(async (options) => {
    try {
      const config = getConfig();
      const index = await loadIndex(config);

      if (!index) {
        console.log('No architecture data found. Run `navgator scan` first.');
        return;
      }

      if (options.agent) {
        console.log(wrapInEnvelope('status', index));
        return;
      }

      if (options.json) {
        console.log(JSON.stringify(index, null, 2));
        return;
      }

      console.log('NavGator - Architecture Status\n');
      console.log('========================================');

      const lastScan = new Date(index.last_scan);
      const hoursSince = Math.round((Date.now() - index.last_scan) / (1000 * 60 * 60));

      console.log(`Last scan: ${lastScan.toLocaleString()} (${hoursSince}h ago)`);
      console.log(`Total components: ${index.stats.total_components}`);
      console.log(`Total connections: ${index.stats.total_connections}`);

      if (index.stats.outdated_count > 0) {
        console.log(`Outdated packages: ${index.stats.outdated_count}`);
      }
      if (index.stats.vulnerable_count > 0) {
        console.log(`Vulnerable packages: ${index.stats.vulnerable_count}`);
      }

      console.log('\nCOMPONENTS BY TYPE:');
      for (const [type, count] of Object.entries(index.stats.components_by_type)) {
        console.log(`  ${type}: ${count}`);
      }

      if (Object.keys(index.stats.connections_by_type).length > 0) {
        console.log('\nCONNECTIONS BY TYPE:');
        for (const [type, count] of Object.entries(index.stats.connections_by_type)) {
          console.log(`  ${type}: ${count}`);
        }
      }

      if (hoursSince > 24) {
        console.log('\n⚠️  Architecture data is stale. Consider running `navgator scan`');
      }
    } catch (error) {
      console.error('Status check failed:', error);
      process.exit(1);
    }
  });

// =============================================================================
// IMPACT COMMAND
// =============================================================================

program
  .command('impact <component>')
  .description('Show what\'s affected if you change a component')
  .option('--json', 'Output as JSON')
  .option('--agent', 'Output wrapped in agent envelope (implies --json)')
  .action(async (componentName, options) => {
    try {
      const config = getConfig();
      const components = await loadAllComponents(config);
      const connections = await loadAllConnections(config);
      const fileMap = await loadFileMap(config);

      // Resolve the component (supports name, file path, partial match)
      const component = resolveComponent(componentName, components, fileMap);

      if (!component) {
        console.log(`Component "${componentName}" not found.`);
        const candidates = findCandidates(componentName, components);
        if (candidates.length > 0) {
          console.log('\nDid you mean:');
          for (const name of candidates) {
            console.log(`  - ${name}`);
          }
        } else {
          console.log('\nAvailable components:');
          for (const c of components.slice(0, 10)) {
            console.log(`  - ${c.name} (${c.type})`);
          }
          if (components.length > 10) {
            console.log(`  ... and ${components.length - 10} more`);
          }
        }
        return;
      }

      // Compute impact with severity
      const impact = computeImpact(component, components, connections);

      // Also compute incoming/outgoing for display
      const incoming = connections.filter(
        (c) => c.to.component_id === component.component_id
      );
      const outgoing = connections.filter(
        (c) => c.from.component_id === component.component_id
      );

      if (options.agent) {
        console.log(wrapInEnvelope('impact', {
          component: { name: component.name, type: component.type, layer: component.role.layer },
          severity: impact.severity,
          summary: impact.summary,
          total_files_affected: impact.total_files_affected,
          affected: impact.affected.map((a) => ({
            name: a.component.name,
            type: a.component.type,
            impact_type: a.impact_type,
            change_required: a.change_required,
          })),
          incoming_count: incoming.length,
          outgoing_count: outgoing.length,
        }));
        return;
      }

      if (options.json) {
        console.log(JSON.stringify({
          component,
          severity: impact.severity,
          summary: impact.summary,
          total_files_affected: impact.total_files_affected,
          affected: impact.affected.map((a) => ({
            name: a.component.name,
            type: a.component.type,
            impact_type: a.impact_type,
            change_required: a.change_required,
          })),
          incoming,
          outgoing,
        }, null, 2));
        return;
      }

      console.log(`NavGator - Impact Analysis: ${component.name}\n`);
      console.log('========================================');
      console.log(`Component: ${component.name}`);
      console.log(`Type: ${component.type}`);
      console.log(`Layer: ${component.role.layer}`);
      console.log(`Purpose: ${component.role.purpose}`);
      console.log(`Severity: ${impact.severity.toUpperCase()}`);
      console.log(`Summary: ${impact.summary}`);

      if (incoming.length > 0) {
        console.log(`\nINCOMING CONNECTIONS (${incoming.length}):`);
        console.log('These files/components USE this component:\n');
        for (const conn of incoming) {
          const lineInfo = conn.code_reference.line_start ? `:${conn.code_reference.line_start}` : '';
          console.log(`  ${conn.code_reference.file}${lineInfo}`);
          if (conn.code_reference.symbol) {
            const symbolType = conn.code_reference.symbol_type ? ` (${conn.code_reference.symbol_type})` : '';
            console.log(`    Symbol: ${conn.code_reference.symbol}${symbolType}`);
          }
          if (conn.code_reference.code_snippet) {
            console.log(`    Code: ${conn.code_reference.code_snippet}`);
          }
          console.log('');
        }
      }

      if (outgoing.length > 0) {
        console.log(`\nOUTGOING CONNECTIONS (${outgoing.length}):`);
        console.log('This component USES these:\n');
        for (const conn of outgoing) {
          const target = components.find((c) => c.component_id === conn.to.component_id);
          console.log(`  → ${target?.name || conn.to.component_id}`);
          console.log(`    Type: ${conn.connection_type}`);
          console.log('');
        }
      }

      // Show transitive impacts if any
      const transitiveAffected = impact.affected.filter((a) => a.impact_type === 'transitive');
      if (transitiveAffected.length > 0) {
        console.log(`\nTRANSITIVE IMPACT (${transitiveAffected.length}):`);
        for (const a of transitiveAffected) {
          console.log(`  ~ ${a.component.name} (${a.component.type})`);
          console.log(`    ${a.change_required}`);
        }
      }

      if (incoming.length === 0 && outgoing.length === 0) {
        console.log('\nNo connections found for this component.');
      }

      console.log('\n========================================');
      console.log(`Files that may need changes if you modify ${component.name}:`);
      const affectedFiles = new Set(incoming.map((c) => c.code_reference.file));
      for (const file of affectedFiles) {
        console.log(`  - ${file}`);
      }
    } catch (error) {
      console.error('Impact analysis failed:', error);
      process.exit(1);
    }
  });

// =============================================================================
// CONNECTIONS COMMAND
// =============================================================================

program
  .command('connections <component>')
  .description('Show all connections for a specific component')
  .option('--json', 'Output as JSON')
  .option('--agent', 'Output wrapped in agent envelope (implies --json)')
  .option('--incoming', 'Show only incoming connections')
  .option('--outgoing', 'Show only outgoing connections')
  .action(async (componentName, options) => {
    try {
      const config = getConfig();
      const components = await loadAllComponents(config);
      const connections = await loadAllConnections(config);
      const fileMap = await loadFileMap(config);

      const component = resolveComponent(componentName, components, fileMap);

      if (!component) {
        console.log(`Component "${componentName}" not found.`);
        const candidates = findCandidates(componentName, components);
        if (candidates.length > 0) {
          console.log('\nDid you mean:');
          for (const name of candidates) {
            console.log(`  - ${name}`);
          }
        }
        return;
      }

      const incoming = options.outgoing
        ? []
        : connections.filter((c) => c.to.component_id === component.component_id);

      const outgoing = options.incoming
        ? []
        : connections.filter((c) => c.from.component_id === component.component_id);

      if (options.agent) {
        console.log(wrapInEnvelope('connections', { component, incoming, outgoing }));
        return;
      }

      if (options.json) {
        console.log(JSON.stringify({ component, incoming, outgoing }, null, 2));
        return;
      }

      console.log(`NavGator - Connections: ${component.name}\n`);
      console.log('========================================');
      console.log(`Component: ${component.name} (${component.type})`);
      console.log(`Layer: ${component.role.layer}`);

      if (!options.outgoing && incoming.length > 0) {
        console.log(`\nINCOMING (${incoming.length}):`);
        for (const conn of incoming) {
          const lineInfo = conn.code_reference.line_start ? `:${conn.code_reference.line_start}` : '';
          const symbolInfo = conn.code_reference.symbol ? ` (${conn.code_reference.symbol})` : '';
          console.log(`├── ${conn.connection_type}`);
          console.log(`│   └── ${conn.code_reference.file}${lineInfo}${symbolInfo}`);
        }
      }

      if (!options.incoming && outgoing.length > 0) {
        console.log(`\nOUTGOING (${outgoing.length}):`);
        for (const conn of outgoing) {
          const target = components.find((c) => c.component_id === conn.to.component_id);
          console.log(`├── ${conn.connection_type} → ${target?.name || 'unknown'}`);
        }
      }
    } catch (error) {
      console.error('Connections query failed:', error);
      process.exit(1);
    }
  });

// =============================================================================
// LIST COMMAND
// =============================================================================

program
  .command('list')
  .description('List all tracked components')
  .option('-t, --type <type>', 'Filter by type')
  .option('-l, --layer <layer>', 'Filter by layer')
  .option('--json', 'Output as JSON')
  .option('--agent', 'Output wrapped in agent envelope (implies --json)')
  .action(async (options) => {
    try {
      const config = getConfig();
      let components = await loadAllComponents(config);

      if (options.type) {
        components = components.filter((c) => c.type === options.type);
      }
      if (options.layer) {
        components = components.filter((c) => c.role.layer === options.layer);
      }

      if (options.agent) {
        console.log(wrapInEnvelope('list', components));
        return;
      }

      if (options.json) {
        console.log(JSON.stringify(components, null, 2));
        return;
      }

      console.log(`NavGator - Components (${components.length})\n`);

      // Group by layer
      const byLayer: Record<string, typeof components> = {};
      for (const c of components) {
        if (!byLayer[c.role.layer]) byLayer[c.role.layer] = [];
        byLayer[c.role.layer].push(c);
      }

      for (const [layer, comps] of Object.entries(byLayer)) {
        console.log(`\n${layer.toUpperCase()}:`);
        for (const c of comps) {
          const version = c.version ? `@${c.version}` : '';
          console.log(`  ${c.name}${version} (${c.type})`);
        }
      }
    } catch (error) {
      console.error('List failed:', error);
      process.exit(1);
    }
  });

// =============================================================================
// DIAGRAM COMMAND
// =============================================================================

program
  .command('diagram')
  .description('Generate a Mermaid diagram of the architecture')
  .option('-f, --focus <component>', 'Center diagram on a specific component')
  .option('-l, --layer <layer>', 'Show only a specific layer')
  .option('-s, --summary', 'Show only top connected components')
  .option('-d, --direction <dir>', 'Diagram direction: TB, BT, LR, RL', 'TB')
  .option('--no-styles', 'Disable color styling')
  .option('--no-labels', 'Hide connection labels')
  .option('-o, --output <file>', 'Save to file instead of stdout')
  .option('-m, --max-nodes <n>', 'Maximum nodes to show', '50')
  .option('--markdown', 'Wrap diagram in markdown code block')
  .action(async (options) => {
    try {
      const config = getConfig();
      const graph = await loadGraph(config);

      if (!graph) {
        console.error('No architecture data found. Run `navgator scan` first.');
        process.exit(1);
      }

      const diagramOpts: DiagramOptions = {
        direction: options.direction as 'TB' | 'BT' | 'LR' | 'RL',
        includeStyles: options.styles !== false,
        showLabels: options.labels !== false,
        maxNodes: parseInt(options.maxNodes, 10),
      };

      let diagram: string;

      if (options.focus) {
        // Resolve component by name, file path, or partial match
        const components = await loadAllComponents(config);
        const fileMap = await loadFileMap(config);
        const component = resolveComponent(options.focus, components, fileMap);

        if (!component) {
          console.error(`Component "${options.focus}" not found.`);
          const candidates = findCandidates(options.focus, components);
          if (candidates.length > 0) {
            console.log('Did you mean:');
            for (const name of candidates) {
              console.log(`  - ${name}`);
            }
          } else {
            console.log('Available components:');
            for (const c of components.slice(0, 10)) {
              console.log(`  - ${c.name}`);
            }
          }
          process.exit(1);
        }

        diagram = generateComponentDiagram(graph, component.component_id, 2, diagramOpts);
      } else if (options.layer) {
        const validLayers: ArchitectureLayer[] = ['frontend', 'backend', 'database', 'queue', 'infra', 'external'];
        if (!validLayers.includes(options.layer as ArchitectureLayer)) {
          console.error(`Invalid layer "${options.layer}". Valid layers: ${validLayers.join(', ')}`);
          process.exit(1);
        }
        diagram = generateLayerDiagram(graph, options.layer as ArchitectureLayer, diagramOpts);
      } else if (options.summary) {
        diagram = generateSummaryDiagram(graph, { ...diagramOpts, maxNodes: 20 });
      } else {
        diagram = generateMermaidDiagram(graph, diagramOpts);
      }

      // Optionally wrap in markdown
      if (options.markdown) {
        const title = options.focus
          ? `Architecture: ${options.focus}`
          : options.layer
          ? `${options.layer} Layer`
          : 'Architecture Diagram';
        diagram = wrapInMarkdown(diagram, title);
      }

      // Output
      if (options.output) {
        await fs.promises.writeFile(options.output, diagram, 'utf-8');
        console.log(`Diagram saved to ${options.output}`);
      } else {
        console.log(diagram);
      }
    } catch (error) {
      console.error('Diagram generation failed:', error);
      process.exit(1);
    }
  });

// =============================================================================
// UI COMMAND
// =============================================================================

program
  .command('ui')
  .description('Launch the NavGator dashboard in your browser')
  .option('-p, --port <port>', 'Port to serve on', '3000')
  .option('--path <path>', 'Project path to analyze (defaults to current directory)')
  .option('--no-open', 'Don\'t open browser automatically')
  .action(async (options) => {
    try {
      if (isSandboxMode()) {
        console.log('Web UI not available in sandbox mode.');
        return;
      }

      const port = parseInt(options.port, 10);
      const projectPath = options.path
        ? (await import('path')).resolve(options.path)
        : process.cwd();

      console.log('');
      console.log('🐊 NavGator Dashboard');
      console.log(`   Project: ${projectPath}`);
      console.log('');

      const { process: serverProcess } = await launchWebUI({
        port,
        projectPath,
      });

      const url = `http://localhost:${port}`;
      console.log(`Dashboard running at: ${url}`);
      console.log('');
      console.log('Press Ctrl+C to stop');
      console.log('');

      // Try to open browser
      if (options.open !== false) {
        const { exec } = await import('child_process');
        const openCmd = process.platform === 'darwin' ? 'open' :
                        process.platform === 'win32' ? 'start' : 'xdg-open';
        exec(`${openCmd} ${url}`);
      }

      // Keep process running, clean up child on exit
      const cleanup = () => {
        console.log('\nShutting down...');
        serverProcess.kill();
        process.exit(0);
      };
      process.on('SIGINT', cleanup);
      process.on('SIGTERM', cleanup);

    } catch (error) {
      console.error('Failed to start UI:', error);
      process.exit(1);
    }
  });

// =============================================================================
// PROMPTS COMMAND
// =============================================================================

program
  .command('prompts')
  .description('Scan and display AI prompts in the codebase')
  .option('-v, --verbose', 'Show full prompt content')
  .option('--json', 'Output as JSON')
  .option('--agent', 'Output wrapped in agent envelope (implies --json)')
  .option('--detail <name>', 'Show detailed view of a specific prompt')
  .action(async (options) => {
    try {
      const result = await scanPromptsOnly(process.cwd());

      if (options.agent) {
        console.log(wrapInEnvelope('prompts', result));
        return;
      }

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      if (options.detail) {
        // Find specific prompt
        const prompt = result.prompts.find(
          (p) => p.name.toLowerCase() === options.detail.toLowerCase() ||
                 p.id.toLowerCase() === options.detail.toLowerCase()
        );

        if (!prompt) {
          console.log(`Prompt "${options.detail}" not found.`);
          console.log('\nAvailable prompts:');
          for (const p of result.prompts.slice(0, 10)) {
            console.log(`  - ${p.name} (${p.location.file}:${p.location.lineStart})`);
          }
          return;
        }

        console.log(formatPromptDetail(prompt));
        return;
      }

      // Standard output
      console.log(formatPromptsOutput(result));

      // Show prompt details if verbose
      if (options.verbose && result.prompts.length > 0) {
        console.log('\n' + '='.repeat(60));
        console.log('PROMPT DETAILS');
        console.log('='.repeat(60));

        for (const prompt of result.prompts) {
          console.log(`\n--- ${prompt.name} ---`);
          console.log(`File: ${prompt.location.file}:${prompt.location.lineStart}`);

          if (prompt.purpose) {
            console.log(`Purpose: ${prompt.purpose}`);
          }

          for (const msg of prompt.messages) {
            console.log(`\n[${msg.role.toUpperCase()}]:`);
            // Show up to 300 chars of content
            const preview = msg.content.slice(0, 300);
            console.log(preview);
            if (msg.content.length > 300) {
              console.log(`... (${msg.content.length - 300} more chars)`);
            }
          }
        }
      }
    } catch (error) {
      console.error('Prompt scan failed:', error);
      process.exit(1);
    }
  });

// =============================================================================
// HISTORY COMMAND
// =============================================================================

program
  .command('history')
  .description('Show architecture change timeline')
  .option('--json', 'Output as JSON')
  .option('--agent', 'Output wrapped in agent envelope (implies --json)')
  .option('-n, --limit <n>', 'Show last N entries', '20')
  .option('-s, --significance <level>', 'Filter by significance (major, minor, patch)')
  .action(async (options) => {
    try {
      const { loadTimeline, formatTimeline } = await import('../diff.js');
      const config = getConfig();
      const timeline = await loadTimeline(config);

      if (options.agent) {
        let entries = [...timeline.entries].reverse();
        if (options.significance) {
          entries = entries.filter((e) => e.significance === options.significance);
        }
        entries = entries.slice(0, parseInt(options.limit, 10));
        console.log(wrapInEnvelope('history', entries));
        return;
      }

      const output = formatTimeline(timeline, {
        limit: parseInt(options.limit, 10),
        significance: options.significance,
        json: options.json,
      });

      console.log(output);
    } catch (error) {
      console.error('Failed to load history:', error);
      process.exit(1);
    }
  });

// =============================================================================
// DIFF COMMAND
// =============================================================================

program
  .command('diff [entry-id]')
  .description('Show detailed architecture diff (most recent if no ID given)')
  .option('--json', 'Output as JSON')
  .option('--agent', 'Output wrapped in agent envelope (implies --json)')
  .action(async (entryId, options) => {
    try {
      const { loadTimeline, formatDiffSummary } = await import('../diff.js');
      const config = getConfig();
      const timeline = await loadTimeline(config);

      if (timeline.entries.length === 0) {
        console.log('No timeline entries found. Run `navgator scan` at least twice to see diffs.');
        return;
      }

      let entry;
      if (entryId) {
        entry = timeline.entries.find((e) => e.id === entryId);
        if (!entry) {
          console.error(`Timeline entry "${entryId}" not found.`);
          console.log('Available entries:');
          for (const e of timeline.entries.slice(-5).reverse()) {
            console.log(`  ${e.id}  (${new Date(e.timestamp).toLocaleString()})`);
          }
          process.exit(1);
        }
      } else {
        entry = timeline.entries[timeline.entries.length - 1];
      }

      if (options.agent) {
        console.log(wrapInEnvelope('diff', entry));
        return;
      }

      console.log(formatDiffSummary(entry, options.json));
    } catch (error) {
      console.error('Failed to load diff:', error);
      process.exit(1);
    }
  });

// =============================================================================
// PROJECTS COMMAND
// =============================================================================

program
  .command('projects')
  .description('List all registered NavGator projects')
  .option('--json', 'Output as JSON')
  .option('--agent', 'Output wrapped in agent envelope (implies --json)')
  .action(async (options) => {
    try {
      const { listProjects, formatProjectsList } = await import('../projects.js');
      const projects = await listProjects();

      if (options.agent) {
        console.log(wrapInEnvelope('projects', projects));
        return;
      }

      console.log(formatProjectsList(projects, options.json));
    } catch (error) {
      console.error('Failed to list projects:', error);
      process.exit(1);
    }
  });

// =============================================================================
// SUMMARY COMMAND (Agent-oriented executive summary)
// =============================================================================

program
  .command('summary')
  .description('Output executive summary with risks, blockers, and next actions (JSON)')
  .option('--agent', 'Wrap output in agent envelope')
  .action(async (options) => {
    try {
      const config = getConfig();
      const components = await loadAllComponents(config);
      const connections = await loadAllConnections(config);
      const projectPath = process.cwd();

      // Try to get git info for context
      const gitInfo = await getGitInfo(projectPath) || undefined;

      const summary = buildExecutiveSummary(components, connections, projectPath, gitInfo);

      if (options.agent) {
        console.log(wrapInEnvelope('summary', summary));
      } else {
        console.log(JSON.stringify(summary, null, 2));
      }
    } catch (error) {
      console.error('Summary generation failed:', error);
      process.exit(1);
    }
  });

// =============================================================================
// TRACE COMMAND
// =============================================================================

program
  .command('trace <component>')
  .description('Trace dataflow paths from a component through the architecture')
  .option('--direction <dir>', 'Trace direction: forward, backward, both', 'both')
  .option('--depth <n>', 'Maximum trace depth', '5')
  .option('--classification <class>', 'Filter by semantic classification')
  .option('--json', 'Output as JSON')
  .option('--agent', 'Output wrapped in agent envelope (implies --json)')
  .action(async (componentName, options) => {
    try {
      const config = getConfig();
      const components = await loadAllComponents(config);
      const connections = await loadAllConnections(config);
      const fileMap = await loadFileMap(config);

      const component = resolveComponent(componentName, components, fileMap);

      if (!component) {
        console.log(`Component "${componentName}" not found.`);
        const candidates = findCandidates(componentName, components);
        if (candidates.length > 0) {
          console.log('\nDid you mean:');
          for (const name of candidates) {
            console.log(`  - ${name}`);
          }
        }
        return;
      }

      const result = traceDataflow(component, components, connections, {
        direction: options.direction as 'forward' | 'backward' | 'both',
        maxDepth: parseInt(options.depth, 10),
        filterClassification: options.classification,
      });

      if (options.agent) {
        console.log(wrapInEnvelope('trace', result));
        return;
      }

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      console.log(formatTraceOutput(result));
    } catch (error) {
      console.error('Trace failed:', error);
      process.exit(1);
    }
  });

// =============================================================================
// RULES COMMAND
// =============================================================================

program
  .command('rules')
  .description('Check architecture rules and show violations')
  .option('--severity <level>', 'Filter by severity: error, warning, info')
  .option('--json', 'Output as JSON')
  .option('--agent', 'Output wrapped in agent envelope (implies --json)')
  .action(async (options) => {
    try {
      const config = getConfig();
      const components = await loadAllComponents(config);
      const connections = await loadAllConnections(config);

      const allRules = [...getBuiltinRules(), ...loadCustomRules()];
      const violations = checkRules(components, connections, allRules);

      if (options.agent) {
        const data = {
          violations,
          summary: {
            total: violations.length,
            errors: violations.filter(v => v.severity === 'error').length,
            warnings: violations.filter(v => v.severity === 'warning').length,
            info: violations.filter(v => v.severity === 'info').length,
          },
          rules_checked: allRules.length,
        };
        console.log(wrapInEnvelope('rules', data));
        return;
      }

      if (options.json) {
        console.log(JSON.stringify({
          violations: options.severity
            ? violations.filter(v => v.severity === options.severity)
            : violations,
          summary: {
            total: violations.length,
            errors: violations.filter(v => v.severity === 'error').length,
            warnings: violations.filter(v => v.severity === 'warning').length,
            info: violations.filter(v => v.severity === 'info').length,
          },
        }, null, 2));
        return;
      }

      console.log(formatRulesOutput(violations, options.severity));
    } catch (error) {
      console.error('Rules check failed:', error);
      process.exit(1);
    }
  });

// =============================================================================
// COVERAGE COMMAND
// =============================================================================

program
  .command('coverage')
  .description('Show architecture tracking coverage and identify gaps')
  .option('--gaps-only', 'Show only gaps')
  .option('--json', 'Output as JSON')
  .option('--agent', 'Output wrapped in agent envelope (implies --json)')
  .action(async (options) => {
    try {
      const config = getConfig();
      const components = await loadAllComponents(config);
      const connections = await loadAllConnections(config);
      const fileMap = await loadFileMap(config);
      const projectRoot = process.cwd();

      const report = await computeCoverage(components, connections, projectRoot, fileMap);

      if (options.agent) {
        console.log(wrapInEnvelope('coverage', report));
        return;
      }

      if (options.json) {
        console.log(JSON.stringify(report, null, 2));
        return;
      }

      console.log(formatCoverageOutput(report, !!options.gapsOnly));
    } catch (error) {
      console.error('Coverage check failed:', error);
      process.exit(1);
    }
  });

// =============================================================================
// SUBGRAPH COMMAND
// =============================================================================

program
  .command('subgraph')
  .description('Extract a focused subgraph from the architecture')
  .option('--focus <components>', 'Comma-separated component names to focus on')
  .option('--layer <layers>', 'Comma-separated layers to include')
  .option('--classification <class>', 'Filter connections by semantic classification')
  .option('--depth <n>', 'BFS depth from focus components', '2')
  .option('--max-nodes <n>', 'Maximum nodes in subgraph', '50')
  .option('--format <fmt>', 'Output format: json, mermaid', 'json')
  .option('--json', 'Output as JSON (same as --format json)')
  .option('--agent', 'Output wrapped in agent envelope (implies --json)')
  .action(async (options) => {
    try {
      const config = getConfig();
      const components = await loadAllComponents(config);
      const connections = await loadAllConnections(config);

      const subgraphOpts = {
        focus: options.focus ? options.focus.split(',').map((s: string) => s.trim()) : undefined,
        layers: options.layer
          ? options.layer.split(',').map((s: string) => s.trim()) as ArchitectureLayer[]
          : undefined,
        classification: options.classification,
        depth: parseInt(options.depth, 10),
        maxNodes: parseInt(options.maxNodes, 10),
      };

      const result = extractSubgraph(components, connections, subgraphOpts);

      if (options.agent) {
        console.log(wrapInEnvelope('subgraph', result));
        return;
      }

      if (options.format === 'mermaid') {
        console.log(subgraphToMermaid(result));
        return;
      }

      // Default: JSON
      console.log(JSON.stringify(result, null, 2));
    } catch (error) {
      console.error('Subgraph extraction failed:', error);
      process.exit(1);
    }
  });

// =============================================================================
// PARSE AND RUN
// =============================================================================

// If no command or flags provided, show welcome menu
const arg = process.argv[2];
const isFlag = arg?.startsWith('-');
const hasCommandOrFlag = process.argv.length > 2;

if (!hasCommandOrFlag) {
  // No arguments at all → show welcome menu
  showWelcomeMenu('no-command').catch((err) => {
    console.error('Error:', err);
    process.exit(1);
  });
} else {
  // Has a command or flag (--help, --version, etc.) → let Commander handle it
  program.parse();
}
