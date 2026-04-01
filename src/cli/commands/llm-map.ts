import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { loadAllComponents, loadAllConnections } from '../../storage.js';
import { getConfig } from '../../config.js';
import { wrapInEnvelope } from '../../agent-output.js';
import { deduplicateLLMUseCases, type LLMUseCase } from '../../llm-dedup.js';
import { checkDataAvailability } from './helpers.js';

export function registerLLMMapCommand(program: Command): void {
  program
    .command('llm-map')
    .description('Map LLM use cases by purpose — shows what each LLM call does and what it connects to')
    .option('--provider <name>', 'Filter by provider (e.g., groq, openai)')
    .option('--category <name>', 'Filter by purpose category (e.g., search, synthesis)')
    .option('--json', 'Output as JSON')
    .option('--agent', 'Output wrapped in agent envelope (implies --json)')
    .option('--classify', 'Output context for AI agent to classify uncategorized use cases')
    .action(async (options) => {
      try {
        const dataWarning = checkDataAvailability();
        if (dataWarning) {
          console.log(dataWarning);
          return;
        }

        const config = getConfig();
        const components = await loadAllComponents(config);
        const connections = await loadAllConnections(config);

        // Try to load prompt data
        let prompts;
        try {
          const promptsPath = path.join(config.storagePath, 'prompts.json');
          const raw = await fs.promises.readFile(promptsPath, 'utf-8');
          prompts = JSON.parse(raw)?.prompts;
        } catch { /* no prompts data */ }

        const dedup = deduplicateLLMUseCases(components, connections, prompts);

        let useCases = dedup.useCases;

        // Apply filters
        if (options.provider) {
          const prov = options.provider.toLowerCase();
          useCases = useCases.filter(uc => uc.provider.toLowerCase().includes(prov));
        }
        if (options.category) {
          const cat = options.category.toLowerCase();
          useCases = useCases.filter(uc => uc.category?.toLowerCase().includes(cat));
        }

        if (options.agent) {
          console.log(wrapInEnvelope('llm-map', { useCases, providers: dedup.providers }));
          return;
        }

        if (options.json) {
          console.log(JSON.stringify({ useCases, providers: dedup.providers }, null, 2));
          return;
        }

        // --classify mode: output context for AI agent classification
        if (options.classify) {
          const uncategorized = useCases.filter(uc => !uc.category || uc.category === 'ai-core');
          if (uncategorized.length === 0) {
            console.log('All LLM use cases have categories. No classification needed.');
            return;
          }

          console.log('LLM USE CASES NEEDING CLASSIFICATION\n');
          console.log('For each use case below, read the primary file and classify the LLM\'s purpose.');
          console.log('Record classifications in .navgator/lessons/lessons.json or .navgator/features.yaml.\n');

          for (const uc of uncategorized) {
            console.log(`--- ${uc.name} (${uc.provider}) ---`);
            console.log(`  File: ${uc.primaryFile}`);
            console.log(`  Call sites: ${uc.productionCallSites}`);
            if (uc.feedsInto && uc.feedsInto.length > 0) {
              console.log(`  Feeds into: ${uc.feedsInto.join(', ')}`);
            }
            console.log(`  Action: Read ${uc.primaryFile} and classify purpose`);
            console.log('');
          }
          return;
        }

        // Default display: group by category
        console.log(`LLM USE CASE MAP — ${useCases.length} use cases across ${dedup.providers.length} providers\n`);

        // Group by category
        const byCategory = new Map<string, LLMUseCase[]>();
        for (const uc of useCases) {
          const cat = uc.category || 'uncategorized';
          if (!byCategory.has(cat)) byCategory.set(cat, []);
          byCategory.get(cat)!.push(uc);
        }

        // Sort categories: named first, uncategorized last
        const sortedCategories = [...byCategory.keys()].sort((a, b) => {
          if (a === 'uncategorized') return 1;
          if (b === 'uncategorized') return -1;
          return a.localeCompare(b);
        });

        for (const cat of sortedCategories) {
          const group = byCategory.get(cat)!;
          console.log(`${cat.toUpperCase()} (${group.length}):`);
          for (const uc of group) {
            const provTag = uc.provider.padEnd(12);
            const file = uc.primaryFile;
            const feeds = uc.feedsInto && uc.feedsInto.length > 0
              ? ` → ${uc.feedsInto.slice(0, 3).join(', ')}`
              : '';
            console.log(`  ${provTag} ${file}${feeds}`);
          }
          console.log('');
        }

        // Summary
        const categorized = useCases.filter(uc => uc.category && uc.category !== 'uncategorized');
        const uncategorized = useCases.filter(uc => !uc.category || uc.category === 'uncategorized');
        if (uncategorized.length > 0) {
          console.log(`${categorized.length} categorized, ${uncategorized.length} uncategorized.`);
          console.log('Run `navgator llm-map --classify` for AI-assisted classification context.');
        }
      } catch (error) {
        console.error('LLM map failed:', error);
        process.exit(1);
      }
    });
}
