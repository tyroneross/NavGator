import { scanPromptsOnly, formatPromptsOutput, formatPromptDetail } from '../../scanner.js';
import { wrapInEnvelope } from '../../agent-output.js';
import { checkDataAvailability } from './helpers.js';
export function registerPromptsCommand(program) {
    program
        .command('prompts')
        .description('Scan and display AI prompts in the codebase')
        .option('-v, --verbose', 'Show full prompt content')
        .option('--json', 'Output as JSON')
        .option('--agent', 'Output wrapped in agent envelope (implies --json)')
        .option('--detail <name>', 'Show detailed view of a specific prompt')
        .action(async (options) => {
        try {
            const dataWarning = checkDataAvailability();
            if (dataWarning) {
                console.log(dataWarning);
                return;
            }
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
                const prompt = result.prompts.find((p) => p.name.toLowerCase() === options.detail.toLowerCase() ||
                    p.id.toLowerCase() === options.detail.toLowerCase());
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
        }
        catch (error) {
            console.error('Prompt scan failed:', error);
            process.exit(1);
        }
    });
}
//# sourceMappingURL=prompts.js.map