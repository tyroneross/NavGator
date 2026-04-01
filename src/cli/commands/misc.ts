import { Command } from 'commander';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as readline from 'readline';
import { fileURLToPath } from 'url';
import { spawn, ChildProcess } from 'child_process';
import { loadIndex, loadAllComponents, loadAllConnections } from '../../storage.js';
import { getConfig } from '../../config.js';
import { wrapInEnvelope } from '../../agent-output.js';
import { getGitInfo } from '../../git.js';
import { setup, fastSetup, isSetupComplete, formatSetupStatus } from '../../setup.js';
import { buildExecutiveSummary } from '../../agent-output.js';
import { isSandboxMode } from '../../sandbox.js';
import { scan } from '../../scanner.js';

// =============================================================================
// SHARED HELPERS
// =============================================================================

export async function launchWebUI(options: {
  port?: number;
  projectPath?: string;
}): Promise<{ port: number; process: ChildProcess }> {
  const port = options.port || 3000;
  const projectPath = options.projectPath || process.cwd();

  // Resolve standalone server.js relative to package root
  const cliDir = path.dirname(fileURLToPath(import.meta.url));
  const packageRoot = path.resolve(cliDir, '..', '..', '..');
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

export async function showWelcomeMenu(context: 'post-setup' | 'no-command'): Promise<void> {
  if (context === 'no-command') {
    const NAVGATOR_LOGO = `
  _   _             ____       _
 | \\ | | __ ___   _/ ___| __ _| |_ ___  _ __
 |  \\| |/ _\` \\ \\ / / |  _ / _\` | __/ _ \\| '__|
 | |\\  | (_| |\\ V /| |_| | (_| | || (_) | |
 |_| \\_|\\__,_| \\_/  \\____|\\__,_|\\__\\___/|_|

  Architecture Connection Tracker
  Know your stack before you change it
`;
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
// SETUP COMMAND
// =============================================================================

export function registerSetupCommand(program: Command): void {
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
          const packageRoot = path.resolve(import.meta.dirname, '..', '..', '..');
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
}

// =============================================================================
// UI COMMAND
// =============================================================================

export function registerUICommand(program: Command): void {
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
}

// =============================================================================
// HISTORY COMMAND
// =============================================================================

export function registerHistoryCommand(program: Command): void {
  program
    .command('history')
    .description('Show architecture change timeline')
    .option('--json', 'Output as JSON')
    .option('--agent', 'Output wrapped in agent envelope (implies --json)')
    .option('-n, --limit <n>', 'Show last N entries', '20')
    .option('-s, --significance <level>', 'Filter by significance (major, minor, patch)')
    .action(async (options) => {
      try {
        const { loadTimeline, formatTimeline } = await import('../../diff.js');
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
}

// =============================================================================
// DIFF COMMAND
// =============================================================================

export function registerDiffCommand(program: Command): void {
  program
    .command('diff [entry-id]')
    .description('Show detailed architecture diff (most recent if no ID given)')
    .option('--json', 'Output as JSON')
    .option('--agent', 'Output wrapped in agent envelope (implies --json)')
    .action(async (entryId, options) => {
      try {
        const { loadTimeline, formatDiffSummary } = await import('../../diff.js');
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
}

// =============================================================================
// PROJECTS COMMAND
// =============================================================================

export function registerProjectsCommand(program: Command): void {
  program
    .command('projects')
    .description('List all registered NavGator projects')
    .option('--json', 'Output as JSON')
    .option('--agent', 'Output wrapped in agent envelope (implies --json)')
    .action(async (options) => {
      try {
        const { listProjects, formatProjectsList } = await import('../../projects.js');
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
}

// =============================================================================
// SUMMARY COMMAND
// =============================================================================

export function registerSummaryCommand(program: Command): void {
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
}
