#!/usr/bin/env node

/**
 * NavGator CLI
 * Architecture connection tracker for Claude Code
 */

import { Command } from 'commander';
import { registerScanCommand } from './commands/scan.js';
import { registerStatusCommand } from './commands/status.js';
import { registerImpactCommand } from './commands/impact.js';
import { registerConnectionsCommand } from './commands/connections.js';
import { registerListCommand } from './commands/list.js';
import { registerDiagramCommand } from './commands/diagram.js';
import { registerPromptsCommand } from './commands/prompts.js';
import { registerTraceCommand } from './commands/trace.js';
import { registerRulesCommand } from './commands/rules.js';
import { registerCoverageCommand } from './commands/coverage.js';
import { registerSubgraphCommand } from './commands/subgraph.js';
import {
  registerSetupCommand,
  registerUICommand,
  registerHistoryCommand,
  registerDiffCommand,
  registerProjectsCommand,
  registerSummaryCommand,
  showWelcomeMenu,
} from './commands/misc.js';

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

// Register all commands
registerSetupCommand(program);
registerScanCommand(program);
registerStatusCommand(program);
registerImpactCommand(program);
registerConnectionsCommand(program);
registerListCommand(program);
registerDiagramCommand(program);
registerUICommand(program);
registerPromptsCommand(program);
registerHistoryCommand(program);
registerDiffCommand(program);
registerProjectsCommand(program);
registerSummaryCommand(program);
registerTraceCommand(program);
registerRulesCommand(program);
registerCoverageCommand(program);
registerSubgraphCommand(program);

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
