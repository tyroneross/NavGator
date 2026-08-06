#!/usr/bin/env node
/**
 * NavGator CLI
 * Architecture connection tracker for Claude Code
 */
import { Command, CommanderError } from 'commander';
import { NAVGATOR_VERSION } from '../version.js';
import { EXIT_CODES } from './exit-codes.js';
import { registerScanCommand } from './commands/scan.js';
import { registerStatusCommand } from './commands/status.js';
import { registerImpactCommand } from './commands/impact.js';
import { registerConnectionsCommand } from './commands/connections.js';
import { registerExploreCommand } from './commands/explore.js';
import { registerListCommand } from './commands/list.js';
import { registerFindCommand } from './commands/find.js';
import { registerTemporalCommands } from './commands/temporal.js';
import { registerDiagramCommand } from './commands/diagram.js';
import { registerPromptsCommand } from './commands/prompts.js';
import { registerTraceCommand } from './commands/trace.js';
import { registerRulesCommand } from './commands/rules.js';
import { registerReviewCommand } from './commands/review.js';
import { registerCoverageCommand } from './commands/coverage.js';
import { registerSubgraphCommand } from './commands/subgraph.js';
import { registerLLMMapCommand } from './commands/llm-map.js';
import { registerSchemaCommand } from './commands/schema.js';
import { registerDeadCommand } from './commands/dead.js';
import { registerLessonsCommand } from './commands/lessons.js';
import { registerFreshnessCommands } from './commands/freshness.js';
import { registerSetupCommand, registerUICommand, registerHistoryCommand, registerDiffCommand, registerProjectsCommand, registerSummaryCommand, registerRegistryLogCommand, showWelcomeMenu, } from './commands/misc.js';
import { registerPortfolioCommand } from './commands/portfolio.js';
import { registerScanRemoteCommand } from './commands/remote.js';
import { registerArchDiffCommand } from './commands/arch-diff.js';
import { registerDoctorCommand } from './commands/doctor.js';
import { registerDeepMapCommand } from './commands/deep-map.js';
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
    .version(NAVGATOR_VERSION)
    .option('--sandbox', 'Run in sandbox mode (restricts network, interactive, child processes)')
    .addHelpText('beforeAll', NAVGATOR_LOGO);
// Commander's own parse-time errors (unknown command/option, missing
// required argument, mutually exclusive flags, ...) call process.exit(1) by
// default — the same code a genuine crash uses. exitOverride() makes
// Commander throw a CommanderError instead, which `runProgram()` below
// catches and remaps: a real invocation error becomes USAGE (4); --help and
// --version (which Commander also routes through this path, at exitCode 0)
// stay SUCCESS (0). Must run before any `.command()` registration —
// `copyInheritedSettings()` copies the exit callback onto a subcommand at
// the moment it is created, so an override added after registration would
// not reach any subcommand, including `lessons`'s nested subcommands.
program.exitOverride();
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
registerFreshnessCommands(program);
registerImpactCommand(program);
registerConnectionsCommand(program);
registerExploreCommand(program);
registerListCommand(program);
registerFindCommand(program);
registerTemporalCommands(program);
registerDiagramCommand(program);
registerUICommand(program);
registerPromptsCommand(program);
registerHistoryCommand(program);
registerDiffCommand(program);
registerProjectsCommand(program);
registerRegistryLogCommand(program);
registerSummaryCommand(program);
registerTraceCommand(program);
registerRulesCommand(program);
registerReviewCommand(program);
registerCoverageCommand(program);
registerSubgraphCommand(program);
registerLLMMapCommand(program);
registerSchemaCommand(program);
registerDeadCommand(program);
registerLessonsCommand(program);
registerPortfolioCommand(program);
registerScanRemoteCommand(program);
registerArchDiffCommand(program);
registerDoctorCommand(program);
registerDeepMapCommand(program);
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
 * and exit USAGE (4) — this surface could not serve the request, which an
 * agent shelling out must be able to tell apart from a fulfilled command.
 */
function looksLikeNaturalLanguage(rawArg, knownCommands) {
    if (!rawArg)
        return false;
    if (rawArg.startsWith('-'))
        return false;
    // Subcommand match → not natural language.
    if (knownCommands.has(rawArg))
        return false;
    // Quotes, spaces, or known NL-shaped punctuation → treat as intent.
    if (rawArg.includes(' ') || rawArg.includes('"') || rawArg.includes("'"))
        return true;
    // Single token that's NOT a registered command and NOT in knownCommands:
    // let commander handle it (will produce its own unknown-command error).
    return false;
}
/**
 * Run Commander's parse, translating a thrown CommanderError (from
 * `exitOverride()` above) into the exit-code contract. Commander's own
 * parse-time errors all carry exitCode 1 except help/version (exitCode 0);
 * remap the former to USAGE (4) rather than letting it collide with
 * OPERATIONAL (1), and leave the latter as SUCCESS (0).
 */
function runProgram() {
    try {
        program.parse();
    }
    catch (err) {
        if (err instanceof CommanderError) {
            process.exitCode = err.exitCode === 0 ? EXIT_CODES.SUCCESS : EXIT_CODES.USAGE;
            return;
        }
        throw err;
    }
}
if (!hasCommandOrFlag) {
    // No arguments at all → show welcome menu
    showWelcomeMenu('no-command').catch((err) => {
        console.error('Error:', err);
        // Nothing runs after this .catch() callback, so exitCode (not exit())
        // is enough — no truncation risk from an in-flight write.
        process.exitCode = EXIT_CODES.OPERATIONAL;
    });
}
else if (!isFlag && arg !== undefined) {
    // Build the set of registered subcommand names from commander's metadata.
    const knownCommands = new Set(program.commands.map((c) => c.name()));
    if (looksLikeNaturalLanguage(arg, knownCommands)) {
        // Natural-language intent — redirect to /navgator:plan. This surface
        // cannot serve the request (USAGE), not a fulfilled command (SUCCESS):
        // an agent shelling out must be able to tell the two apart.
        const intent = arg;
        process.stdout.write(`navgator "${intent}" needs Claude Code. From a terminal use a subcommand directly ` +
            `(e.g. \`navgator scan\`, \`navgator impact <component>\`), or run /navgator:plan "${intent}" ` +
            `from inside Claude Code.\n`);
        process.exitCode = EXIT_CODES.USAGE;
    }
    else {
        // Non-NL token → fall through to commander (it will print its own error).
        runProgram();
    }
}
else {
    // Has a flag (--help, --version, etc.) → let Commander handle it
    runProgram();
}
//# sourceMappingURL=index.js.map