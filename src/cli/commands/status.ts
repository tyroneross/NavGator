import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { loadIndex, loadAllComponents, loadAllConnections } from '../../storage.js';
import { getConfig } from '../../config.js';
import { wrapInEnvelope } from '../../agent-output.js';

export function registerStatusCommand(program: Command): void {
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

        // Infrastructure summary
        const infraTypes = ['database', 'config', 'queue', 'cron', 'infra'];
        const infraCounts: Record<string, number> = {};
        for (const t of infraTypes) {
          const count = index.stats.components_by_type[t];
          if (count) infraCounts[t] = count;
        }
        if (Object.keys(infraCounts).length > 0) {
          console.log('\nINFRASTRUCTURE:');
          for (const [type, count] of Object.entries(infraCounts)) {
            const label = type === 'database' ? 'DB models'
              : type === 'config' ? 'Env vars'
              : type === 'queue' ? 'Queues'
              : type === 'cron' ? 'Cron jobs'
              : 'Infra services';
            console.log(`  ${label}: ${count}`);
          }
          // Show infra connection types
          const infraConnTypes = ['schema-relation', 'env-dependency', 'queue-produces', 'queue-consumes', 'cron-triggers'];
          const infraConnCounts: string[] = [];
          for (const ct of infraConnTypes) {
            const count = index.stats.connections_by_type[ct];
            if (count) infraConnCounts.push(`${ct}: ${count}`);
          }
          if (infraConnCounts.length > 0) {
            console.log(`  Connections: ${infraConnCounts.join(', ')}`);
          }

          // Show field usage summary if stored in component metadata
          try {
            const allComps = await loadAllComponents(config);
            const summaryComp = allComps.find(c => c.name === 'DB Field Usage' && c.tags?.includes('field-usage'));
            if (summaryComp?.metadata?.report) {
              const r = summaryComp.metadata.report as { totalFields: number; unusedFields: number; writeOnlyFields: number; scannedModels: number };
              console.log(`  Field usage: ${r.totalFields} fields across ${r.scannedModels} models`);
              if (r.unusedFields > 0) console.log(`    Unused fields: ${r.unusedFields} (run 'navgator coverage --fields' for details)`);
              if (r.writeOnlyFields > 0) console.log(`    Write-only fields: ${r.writeOnlyFields}`);
            }
          } catch {
            // Field usage data not available — non-critical
          }
        }

        // Runtime topology section
        try {
          const runtimeComps = await loadAllComponents(config);
          const withRuntime = runtimeComps.filter(c => c.runtime?.resource_type);

          if (withRuntime.length > 0) {
            const resourceTypeLabels: Record<string, string> = {
              database: 'database',
              cache: 'cache',
              queue: 'queues',
              worker: 'workers',
              cron: 'crons',
              api: 'apis',
              storage: 'storage',
            };

            // Group by resource_type
            const grouped: Record<string, typeof withRuntime> = {};
            for (const comp of withRuntime) {
              const rt = comp.runtime!.resource_type!;
              if (!grouped[rt]) grouped[rt] = [];
              grouped[rt].push(comp);
            }

            console.log('\nRUNTIME TOPOLOGY:');
            const typeOrder = ['database', 'cache', 'queue', 'worker', 'cron', 'api', 'storage'];
            for (const rt of typeOrder) {
              if (!grouped[rt]) continue;
              const label = resourceTypeLabels[rt] ?? rt;
              const comps = grouped[rt];

              if (rt === 'api') {
                // Skip noisy API entries — env vars with URLs are better shown as env vars
                continue;
              } else if (rt === 'queue' || rt === 'worker' || rt === 'cron' || rt === 'storage') {
                // Multi-item types: list names with extra context
                const names = comps.map(c => {
                  const name = c.runtime?.service_name ?? c.name;
                  if (rt === 'cron' && c.runtime?.endpoint?.path) {
                    const platform = c.runtime?.platform ? `, ${c.runtime.platform}` : '';
                    return `${c.runtime.endpoint.path}${platform}`;
                  }
                  if (rt === 'worker' && c.runtime?.platform) {
                    return `${name} (${c.runtime.platform})`;
                  }
                  if (rt === 'queue' && c.runtime?.engine) {
                    return name;
                  }
                  return name;
                });
                // For queues, append engine info from first component
                if (rt === 'queue') {
                  const engine = comps[0]?.runtime?.engine;
                  const engineSuffix = engine ? ` (${engine})` : '';
                  console.log(`  ${label}: ${names.join(', ')}${engineSuffix}`);
                } else {
                  console.log(`  ${label}: ${names.join(', ')}`);
                }
              } else {
                // Single-detail types: database, cache — dedup by unique (engine, host, port, env_var)
                const seen = new Set<string>();
                for (const comp of comps) {
                  const r = comp.runtime!;
                  const enginePart = r.engine ?? comp.name;
                  const hostPart = r.endpoint?.host
                    ? ` @ ${r.endpoint.host}${r.endpoint.port ? `:${r.endpoint.port}` : ''}`
                    : '';
                  const envPart = r.connection_env_var ? ` (via ${r.connection_env_var})` : '';
                  const line = `${enginePart}${hostPart}${envPart}`;
                  if (seen.has(line)) continue;
                  seen.add(line);
                  console.log(`  ${label}: ${line}`);
                }
              }
            }
          }
        } catch {
          // Runtime topology data not available — non-critical
        }

        // AI/LLM use case summary (3-layer dedup: filter → group by purpose → display)
        try {
          const { deduplicateLLMUseCases } = await import('../../llm-dedup.js');
          const aiComps = await loadAllComponents(config);
          const aiConns = await loadAllConnections(config);

          // Try to load prompt data for strongest grouping signal
          let prompts;
          try {
            const promptsPath = path.join(config.storagePath, 'prompts.json');
            const raw = await fs.promises.readFile(promptsPath, 'utf-8');
            const data = JSON.parse(raw);
            prompts = data?.prompts;
          } catch { /* no prompts data — dedup falls back to function/file grouping */ }

          const dedup = deduplicateLLMUseCases(aiComps, aiConns, prompts);

          if (dedup.useCases.length > 0) {
            console.log('\nAI/LLM:');
            console.log(`  ${dedup.useCases.length} use case${dedup.useCases.length !== 1 ? 's' : ''} across ${dedup.providers.length} provider${dedup.providers.length !== 1 ? 's' : ''} (${dedup.productionCallSites} production call sites)`);
            if (dedup.providers.length > 0) {
              console.log(`  Providers: ${dedup.providers.join(', ')}`);
            }
            // Show use case table if ≤15 use cases
            if (dedup.useCases.length <= 15) {
              console.log('');
              for (const uc of dedup.useCases) {
                const name = uc.name.padEnd(24);
                const provider = uc.provider.padEnd(12);
                console.log(`    ${name} ${provider} ${uc.primaryFile}`);
              }
            }
          }
        } catch {
          // AI/LLM dedup not available — non-critical
        }

        if (hoursSince > 24) {
          console.log('\n⚠️  Architecture data is stale. Consider running `navgator scan`');
        }
      } catch (error) {
        console.error('Status check failed:', error);
        process.exit(1);
      }
    });
}
