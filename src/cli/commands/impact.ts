import { Command } from 'commander';
import { loadAllComponents, loadAllConnections, loadFileMap } from '../../storage.js';
import { getConfig } from '../../config.js';
import { computeImpact } from '../../impact.js';
import { wrapInEnvelope } from '../../agent-output.js';
import { resolveComponent, findCandidates } from '../../resolve.js';
import { resolveFileConnections, formatFileImpact, formatFileConnections } from '../../file-resolve.js';
import { checkDataAvailability } from './helpers.js';

export function registerImpactCommand(program: Command): void {
  program
    .command('impact <component>')
    .description('Show what\'s affected if you change a component')
    .option('--json', 'Output as JSON')
    .option('--agent', 'Output wrapped in agent envelope (implies --json)')
    .action(async (componentName, options) => {
      try {
        const dataWarning = checkDataAvailability();
        if (dataWarning) {
          console.log(dataWarning);
          return;
        }
        const config = getConfig();
        const components = await loadAllComponents(config);
        const connections = await loadAllConnections(config);
        const fileMap = await loadFileMap(config);

        // Resolve the component (supports name, file path, partial match)
        const component = resolveComponent(componentName, components, fileMap);

        if (!component) {
          // Fall back to file-level import analysis
          const { looksLikeFilePath } = await import('../../file-resolve.js');
          if (looksLikeFilePath(componentName)) {
            const fc = resolveFileConnections(componentName, connections);
            if (fc) {
              if (options.agent) {
                console.log(wrapInEnvelope('impact', {
                  file: fc.filePath,
                  imported_by: fc.importedBy.length,
                  imports: fc.imports.length,
                  other_connections: fc.otherFrom.length + fc.otherTo.length,
                  importers: fc.importedBy.map(c => ({
                    file: c.from.component_id.replace('FILE:', ''),
                    line: c.code_reference?.line_start,
                    symbol: c.code_reference?.symbol,
                  })),
                }));
                return;
              }
              if (options.json) {
                console.log(JSON.stringify(fc, null, 2));
                return;
              }
              console.log(formatFileImpact(fc));
              return;
            }
          }

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
}
