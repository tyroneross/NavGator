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
import { loadIndex, loadAllComponents, loadAllConnections, loadGraph, getStorageStats } from '../storage.js';
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
import { setup, fastSetup, isSetupComplete, formatSetupStatus } from '../setup.js';
import { startUIServer } from '../ui-server.js';

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
  .version('0.1.1')
  .addHelpText('beforeAll', NAVGATOR_LOGO);

// =============================================================================
// WELCOME MENU (shown after setup or when no command provided)
// =============================================================================

async function launchUI(projectPath?: string): Promise<void> {
  const resolvedPath = projectPath || process.cwd();

  console.log('');
  console.log('🐊 NavGator Dashboard');
  console.log(`   Project: ${resolvedPath}`);
  console.log('');

  const { port: actualPort } = await startUIServer({
    port: 3333,
    projectPath: resolvedPath,
  });

  const url = `http://localhost:${actualPort}`;
  console.log(`Dashboard running at: ${url}`);
  console.log('');
  console.log('Press Ctrl+C to stop');
  console.log('');

  // Try to open browser
  const { exec } = await import('child_process');
  const openCmd = process.platform === 'darwin' ? 'open' :
                  process.platform === 'win32' ? 'start' : 'xdg-open';
  exec(`${openCmd} ${url}`);

  // Keep process running
  process.on('SIGINT', () => {
    console.log('\nShutting down...');
    process.exit(0);
  });
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

async function showWelcomeMenu(context: 'post-setup' | 'no-command'): Promise<void> {
  if (context === 'no-command') {
    console.log(NAVGATOR_LOGO);
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

      // Offer to link as Claude Code plugin
      const claudeDir = path.join(os.homedir(), '.claude');
      if (fs.existsSync(claudeDir)) {
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

      // Show welcome menu after setup
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
  .action(async (options) => {
    try {
      console.log('NavGator - Scanning architecture...\n');

      const result = await scan(process.cwd(), {
        quick: options.quick,
        connections: options.connections,
        prompts: options.prompts,
        verbose: options.verbose,
        clearFirst: options.clear,
        useAST: options.ast,
      });

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

      // Auto-register project in ~/.navgator/projects.json
      try {
        const os = await import('os');
        const path = await import('path');
        const registryDir = path.join(os.homedir(), '.navgator');
        const registryPath = path.join(registryDir, 'projects.json');

        await fs.promises.mkdir(registryDir, { recursive: true });

        let registry: { version: number; projects: Array<{ path: string; name: string; addedAt: number; lastScan: number | null }> };
        try {
          registry = JSON.parse(await fs.promises.readFile(registryPath, 'utf-8'));
        } catch {
          registry = { version: 1, projects: [] };
        }

        const projectRoot = process.cwd();
        const existing = registry.projects.find(p => p.path === projectRoot);
        if (existing) {
          existing.lastScan = Date.now();
        } else {
          const dirName = projectRoot.split(path.sep).pop() || 'project';
          const name = dirName.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).trim();
          registry.projects.push({ path: projectRoot, name, addedAt: Date.now(), lastScan: Date.now() });
        }

        await fs.promises.writeFile(registryPath, JSON.stringify(registry, null, 2), 'utf-8');
      } catch {
        // Non-critical — don't fail the scan
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
  .action(async (options) => {
    try {
      const config = getConfig();
      const index = await loadIndex(config);

      if (!index) {
        console.log('No architecture data found. Run `navgator scan` first.');
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
  .action(async (componentName, options) => {
    try {
      const config = getConfig();
      const components = await loadAllComponents(config);
      const connections = await loadAllConnections(config);

      // Find the component
      const component = components.find(
        (c) => c.name.toLowerCase() === componentName.toLowerCase()
      );

      if (!component) {
        console.log(`Component "${componentName}" not found.`);
        console.log('\nAvailable components:');
        for (const c of components.slice(0, 10)) {
          console.log(`  - ${c.name} (${c.type})`);
        }
        if (components.length > 10) {
          console.log(`  ... and ${components.length - 10} more`);
        }
        return;
      }

      // Find connections TO this component
      const incoming = connections.filter(
        (c) => c.to.component_id === component.component_id
      );

      // Find connections FROM this component
      const outgoing = connections.filter(
        (c) => c.from.component_id === component.component_id
      );

      if (options.json) {
        console.log(JSON.stringify({ component, incoming, outgoing }, null, 2));
        return;
      }

      console.log(`NavGator - Impact Analysis: ${component.name}\n`);
      console.log('========================================');
      console.log(`Component: ${component.name}`);
      console.log(`Type: ${component.type}`);
      console.log(`Layer: ${component.role.layer}`);
      console.log(`Purpose: ${component.role.purpose}`);

      if (incoming.length > 0) {
        console.log(`\nINCOMING CONNECTIONS (${incoming.length}):`);
        console.log('These files/components USE this component:\n');
        for (const conn of incoming) {
          const lineInfo = conn.code_reference.line_start ? `:${conn.code_reference.line_start}` : '';
          console.log(`  ${conn.code_reference.file}${lineInfo}`);
          // Use symbol as primary identifier
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
  .option('--incoming', 'Show only incoming connections')
  .option('--outgoing', 'Show only outgoing connections')
  .action(async (componentName, options) => {
    try {
      const config = getConfig();
      const components = await loadAllComponents(config);
      const connections = await loadAllConnections(config);

      const component = components.find(
        (c) => c.name.toLowerCase() === componentName.toLowerCase()
      );

      if (!component) {
        console.log(`Component "${componentName}" not found.`);
        return;
      }

      const incoming = options.outgoing
        ? []
        : connections.filter((c) => c.to.component_id === component.component_id);

      const outgoing = options.incoming
        ? []
        : connections.filter((c) => c.from.component_id === component.component_id);

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
        // Find component by name
        const components = await loadAllComponents(config);
        const component = components.find(
          (c) => c.name.toLowerCase() === options.focus.toLowerCase()
        );

        if (!component) {
          console.error(`Component "${options.focus}" not found.`);
          console.log('Available components:');
          for (const c of components.slice(0, 10)) {
            console.log(`  - ${c.name}`);
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
  .option('-p, --port <port>', 'Port to serve on', '3333')
  .option('--path <path>', 'Project path to analyze (defaults to current directory)')
  .option('--no-open', 'Don\'t open browser automatically')
  .action(async (options) => {
    try {
      const port = parseInt(options.port, 10);
      const projectPath = options.path
        ? (await import('path')).resolve(options.path)
        : process.cwd();

      console.log('');
      console.log('🐊 NavGator Dashboard');
      console.log(`   Project: ${projectPath}`);
      console.log('');

      const { port: actualPort } = await startUIServer({
        port,
        projectPath,
      });

      const url = `http://localhost:${actualPort}`;
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

      // Keep process running
      process.on('SIGINT', () => {
        console.log('\nShutting down...');
        process.exit(0);
      });

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
  .option('--detail <name>', 'Show detailed view of a specific prompt')
  .action(async (options) => {
    try {
      const result = await scanPromptsOnly(process.cwd());

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
