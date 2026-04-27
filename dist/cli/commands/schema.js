import { loadAllComponents, loadAllConnections } from '../../storage.js';
import { getConfig } from '../../config.js';
import { wrapInEnvelope } from '../../agent-output.js';
import { resolveComponent, findCandidates } from '../../resolve.js';
import { checkDataAvailability } from './helpers.js';
export function registerSchemaCommand(program) {
    program
        .command('schema [model]')
        .description('Show which files read from and write to a database model')
        .option('--reads', 'Show only files that read')
        .option('--writes', 'Show only files that write')
        .option('--json', 'Output as JSON')
        .option('--agent', 'Output wrapped in agent envelope (implies --json)')
        .action(async (modelName, options) => {
        try {
            const dataWarning = checkDataAvailability();
            if (dataWarning) {
                console.log(dataWarning);
                return;
            }
            const config = getConfig();
            const components = await loadAllComponents(config);
            const connections = await loadAllConnections(config);
            // If no model specified, show overview of all database models
            if (!modelName) {
                const dbComps = components.filter(c => c.type === 'database');
                const dbConns = connections.filter(c => c.connection_type === 'api-calls-db');
                if (options.agent) {
                    console.log(wrapInEnvelope('schema', { models: dbComps, connections: dbConns }));
                    return;
                }
                console.log(`NavGator - Schema Overview (${dbComps.length} models)\n`);
                for (const model of dbComps.sort((a, b) => {
                    const aConns = dbConns.filter(c => c.to.component_id === a.component_id).length;
                    const bConns = dbConns.filter(c => c.to.component_id === b.component_id).length;
                    return bConns - aConns;
                }).slice(0, 20)) {
                    const modelConns = dbConns.filter(c => c.to.component_id === model.component_id);
                    const readers = modelConns.filter(c => {
                        const d = c.description || '';
                        return (d.includes('[reads') || d.includes('reads]')) && !d.includes('writes');
                    });
                    const writers = modelConns.filter(c => {
                        const d = c.description || '';
                        return (d.includes('[writes') || d.includes('writes,')) && !d.includes('reads');
                    });
                    const both = modelConns.filter(c => {
                        const d = c.description || '';
                        return d.includes('reads') && d.includes('writes');
                    });
                    console.log(`  ${model.name}: ${modelConns.length} connections (${readers.length} read, ${writers.length} write, ${both.length} read+write)`);
                }
                return;
            }
            // Find the specific model
            const component = resolveComponent(modelName, components);
            if (!component || component.type !== 'database') {
                if (!component) {
                    console.log(`Model "${modelName}" not found.`);
                    const candidates = findCandidates(modelName, components, 5)
                        .filter(c => components.find(comp => comp.name === c && comp.type === 'database'));
                    if (candidates.length > 0) {
                        console.log('\nDid you mean:');
                        for (const name of candidates)
                            console.log(`  - ${name}`);
                    }
                }
                else {
                    console.log(`"${modelName}" is a ${component.type}, not a database model.`);
                }
                return;
            }
            const modelConns = connections.filter(c => c.to.component_id === component.component_id && c.connection_type === 'api-calls-db');
            // Separate reads and writes
            const readers = [];
            const writers = [];
            const readWriters = [];
            for (const conn of modelConns) {
                const desc = conn.description || '';
                const hasReads = desc.includes('[reads') || desc.includes('reads]');
                const hasWrites = desc.includes('[writes') || desc.includes('writes]') || desc.includes('writes,');
                if (hasReads && hasWrites)
                    readWriters.push(conn);
                else if (hasWrites)
                    writers.push(conn);
                else if (hasReads)
                    readers.push(conn);
                else
                    readers.push(conn); // default to read
            }
            if (options.agent) {
                console.log(wrapInEnvelope('schema', { model: component, readers, writers, readWriters }));
                return;
            }
            if (options.json) {
                console.log(JSON.stringify({ model: component.name, readers: readers.length, writers: writers.length, readWriters: readWriters.length, connections: modelConns }, null, 2));
                return;
            }
            console.log(`NavGator - Schema: ${component.name}\n`);
            console.log(`${modelConns.length} files access this model`);
            if (!options.writes && (readers.length > 0 || readWriters.length > 0)) {
                console.log(`\nREADERS (${readers.length + readWriters.length}):`);
                for (const conn of [...readers, ...readWriters].slice(0, 20)) {
                    const badge = conn.description?.includes('[reads+writes]') ? ' [also writes]' : '';
                    const cls = conn.semantic?.classification;
                    const clsBadge = cls && cls !== 'production' ? ` [${cls}]` : '';
                    console.log(`  ${conn.code_reference.file}:${conn.code_reference.line_start || ''}${badge}${clsBadge}`);
                }
            }
            if (!options.reads && (writers.length > 0 || readWriters.length > 0)) {
                console.log(`\nWRITERS (${writers.length + readWriters.length}):`);
                for (const conn of [...writers, ...readWriters].slice(0, 20)) {
                    const badge = conn.description?.includes('[reads+writes]') ? ' [also reads]' : '';
                    const cls = conn.semantic?.classification;
                    const clsBadge = cls && cls !== 'production' ? ` [${cls}]` : '';
                    console.log(`  ${conn.code_reference.file}:${conn.code_reference.line_start || ''}${badge}${clsBadge}`);
                }
            }
        }
        catch (error) {
            console.error('Schema query failed:', error);
            process.exit(1);
        }
    });
}
//# sourceMappingURL=schema.js.map