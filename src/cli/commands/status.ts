import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { loadIndex, loadAllComponents, loadAllConnections } from '../../storage.js';
import { getConfig } from '../../config.js';
import { wrapInEnvelope } from '../../agent-output.js';
import { checkDataAvailability } from './helpers.js';

export function registerStatusCommand(program: Command): void {
  program
    .command('status')
    .description('Show architecture summary and health status')
    .option('--json', 'Output as JSON')
    .option('--agent', 'Output wrapped in agent envelope (implies --json)')
    .action(async (options) => {
      try {
        const dataWarning = checkDataAvailability();
        if (dataWarning) {
          console.log(dataWarning);
          return;
        }
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
          // Split connections into architecture (meaningful) vs code (mechanical)
          const archTypes = new Set(['queue-produces', 'queue-consumes', 'queue-uses-cache', 'deploys-to', 'cron-triggers', 'schema-relation', 'field-reference', 'runtime-binding', 'service-call', 'api-calls-db', 'frontend-calls-api', 'queue-triggers', 'prompt-location', 'prompt-usage']);
          const codeTypes = new Set(['imports', 'env-dependency']);
          let archCount = 0;
          let codeCount = 0;
          const archBreakdown: string[] = [];
          const codeBreakdown: string[] = [];
          for (const [type, count] of Object.entries(index.stats.connections_by_type)) {
            if (codeTypes.has(type)) {
              codeCount += count as number;
              codeBreakdown.push(`${type}: ${count}`);
            } else {
              archCount += count as number;
              archBreakdown.push(`${type}: ${count}`);
            }
          }
          console.log(`\nARCHITECTURE CONNECTIONS (${archCount}):`);
          for (const s of archBreakdown) console.log(`  ${s}`);
          if (codeCount > 0) {
            console.log(`CODE CONNECTIONS (${codeCount}):`);
            for (const s of codeBreakdown) console.log(`  ${s}`);
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

        // Dead code detection: orphan components with 0 connections
        try {
          const allComps = await loadAllComponents(config);
          const allConns = await loadAllConnections(config);
          const connectedIds = new Set<string>();
          for (const conn of allConns) {
            connectedIds.add(conn.from.component_id);
            connectedIds.add(conn.to.component_id);
          }
          // Only flag non-code components (packages, queues, services, infra) — code components are too numerous.
          // 'pip' is excluded: NavGator has no Python import scanner, so pip components can never accumulate
          // connections, which makes orphan-flagging them a guaranteed false positive. Re-include when a
          // Python import scanner ships. Aligned with rules.ts:366 (transitive dead-code already excludes pip).
          const orphanTypes = new Set(['npm', 'spm', 'queue', 'service', 'llm', 'infra', 'database', 'framework']);
          const orphans = allComps.filter(c =>
            orphanTypes.has(c.type) &&
            !connectedIds.has(c.component_id) &&
            c.status === 'active'
          );
          if (orphans.length > 0) {
            console.log(`\nPOTENTIAL DEAD CODE (${orphans.length} orphaned components):`);
            for (const o of orphans.slice(0, 10)) {
              console.log(`  ${o.name} (${o.type}) — 0 connections`);
            }
            if (orphans.length > 10) console.log(`  ... and ${orphans.length - 10} more`);
          }
        } catch { /* non-critical */ }

        // Anomaly detection: queues with multiple consumers
        try {
          const qComps = (await loadAllComponents(config)).filter(c => c.type === 'queue');
          const qConns = await loadAllConnections(config);
          const anomalies: string[] = [];
          for (const q of qComps) {
            const consumers = qConns.filter(c =>
              c.from.component_id === q.component_id && c.connection_type === 'queue-consumes'
            );
            if (consumers.length > 1) {
              const files = consumers.map(c => c.to.component_id?.startsWith('FILE:') ? c.to.component_id.slice(5) : c.code_reference?.file || 'unknown').join(', ');
              anomalies.push(`${q.name}: ${consumers.length} consumers (${files}) — verify this is intentional`);
            }
          }
          if (anomalies.length > 0) {
            console.log(`\nANOMALIES (${anomalies.length}):`);
            for (const a of anomalies) console.log(`  ⚠️  ${a}`);
          }
        } catch { /* non-critical */ }

        // Recent changes (temporal awareness)
        try {
          const { loadTimeline } = await import('../../diff.js');
          const timeline = await loadTimeline(config);
          if (timeline && timeline.entries.length > 0) {
            const latest = timeline.entries[timeline.entries.length - 1];
            const diff = latest.diff;
            const age = Math.round((Date.now() - latest.timestamp) / 3600000);
            const ageStr = age < 1 ? 'just now' : age < 24 ? `${age}h ago` : `${Math.round(age / 24)}d ago`;

            const parts: string[] = [];
            if (diff.components.added.length > 0) parts.push(`+${diff.components.added.length} components`);
            if (diff.components.removed.length > 0) parts.push(`-${diff.components.removed.length} components`);
            if (diff.connections.added.length > 0) parts.push(`+${diff.connections.added.length} connections`);
            if (diff.connections.removed.length > 0) parts.push(`-${diff.connections.removed.length} connections`);

            if (parts.length > 0) {
              console.log(`\nRECENT CHANGES (${ageStr}, ${latest.significance.toUpperCase()}):`);
              console.log(`  ${parts.join(', ')}`);
              if (diff.components.added.length > 0) {
                const names = diff.components.added.slice(0, 5).map(c => c.name);
                console.log(`  Added: ${names.join(', ')}${diff.components.added.length > 5 ? ` +${diff.components.added.length - 5} more` : ''}`);
              }
              if (diff.components.removed.length > 0) {
                const names = diff.components.removed.slice(0, 5).map(c => c.name);
                console.log(`  Removed: ${names.join(', ')}${diff.components.removed.length > 5 ? ` +${diff.components.removed.length - 5} more` : ''}`);
              }
            }
          }
        } catch { /* timeline not available */ }

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
