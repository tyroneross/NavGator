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
import { registerFindCommand } from './commands/find.js';
import { registerTemporalCommands } from './commands/temporal.js';
import { registerDiagramCommand } from './commands/diagram.js';
import { registerPromptsCommand } from './commands/prompts.js';
import { registerTraceCommand } from './commands/trace.js';
import { registerRulesCommand } from './commands/rules.js';
import { registerCoverageCommand } from './commands/coverage.js';
import { registerSubgraphCommand } from './commands/subgraph.js';
import { registerLLMMapCommand } from './commands/llm-map.js';
import { registerSchemaCommand } from './commands/schema.js';
import { registerDeadCommand } from './commands/dead.js';
import { registerLessonsCommand } from './commands/lessons.js';
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
  .version('0.8.1')
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
registerFindCommand(program);
registerTemporalCommands(program);
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
registerLLMMapCommand(program);
registerSchemaCommand(program);
registerDeadCommand(program);
registerLessonsCommand(program);

// =============================================================================
// PARSE AND RUN
// =============================================================================

// If no command or flags provided, show welcome menu
const arg = process.argv[2];
const isFlag = arg?.startsWith('-');
const hasCommandOrFlag = process.argv.length > 2;

/**
 * Detect a natural-language intent argument: a non-flag, non-subcommand
 * first arg that contains spaces or quotes (e.g. `navgator "review my auth"`).
 *
 * Run 1 — D3: redirect such input to /navgator:plan. The planner agent runs
 * inside Claude Code; the bare CLI cannot reach it. Print a redirect message
 * and exit 0 so wrappers don't treat this as a failure.
 */
function looksLikeNaturalLanguage(rawArg: string | undefined, knownCommands: Set<string>): boolean {
  if (!rawArg) return false;
  if (rawArg.startsWith('-')) return false;
  // Subcommand match → not natural language.
  if (knownCommands.has(rawArg)) return false;
  // Quotes, spaces, or known NL-shaped punctuation → treat as intent.
  if (rawArg.includes(' ') || rawArg.includes('"') || rawArg.includes("'")) return true;
  // Single token that's NOT a registered command and NOT in knownCommands:
  // let commander handle it (will produce its own unknown-command error).
  return false;
}

if (!hasCommandOrFlag) {
  // No arguments at all → show welcome menu
  showWelcomeMenu('no-command').catch((err) => {
    console.error('Error:', err);
    process.exit(1);
  });
} else if (!isFlag && arg !== undefined) {
  // Build the set of registered subcommand names from commander's metadata.
  const knownCommands = new Set<string>(program.commands.map((c) => c.name()));
  if (looksLikeNaturalLanguage(arg, knownCommands)) {
    // Natural-language intent — redirect to /navgator:plan.
    const intent = arg;
    process.stdout.write(
      `navgator "${intent}" needs Claude Code. From a terminal use a subcommand directly ` +
        `(e.g. \`navgator scan\`, \`navgator impact <component>\`), or run /navgator:plan "${intent}" ` +
        `from inside Claude Code.\n`
    );
    process.exit(0);
  }
  // Non-NL token → fall through to commander (it will print its own error).
  program.parse();
} else {
  // Has a flag (--help, --version, etc.) → let Commander handle it
  program.parse();
}
