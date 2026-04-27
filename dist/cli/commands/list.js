import * as fs from 'fs';
import * as path from 'path';
import { loadAllComponents } from '../../storage.js';
import { getConfig } from '../../config.js';
import { wrapInEnvelope } from '../../agent-output.js';
export function registerListCommand(program) {
    program
        .command('list')
        .description('List all tracked components')
        .option('-t, --type <type>', 'Filter by type')
        .option('-l, --layer <layer>', 'Filter by layer')
        .option('--json', 'Output as JSON')
        .option('--agent', 'Output wrapped in agent envelope (implies --json)')
        .action(async (options) => {
        try {
            const config = getConfig();
            let components = await loadAllComponents(config);
            if (options.type) {
                components = components.filter((c) => c.type === options.type);
            }
            if (options.layer) {
                components = components.filter((c) => c.role.layer === options.layer);
            }
            if (options.agent) {
                console.log(wrapInEnvelope('list', components));
                return;
            }
            if (options.json) {
                console.log(JSON.stringify(components, null, 2));
                return;
            }
            if (components.length === 0) {
                const cwd = process.cwd();
                const navDir = path.join(cwd, '.navgator', 'architecture');
                if (!fs.existsSync(navDir)) {
                    console.log(`No NavGator data in ${cwd}`);
                    console.log('Run `navgator scan` first, or `navgator projects` to find scanned projects.');
                }
                else {
                    console.log('No components found. Try running `navgator scan` to refresh.');
                }
                return;
            }
            // Deduplicate: merge components with same base name + type
            // "Railway Config" and "Railway" → keep the one with more connections
            const seen = new Map();
            for (const c of components) {
                // Extract base name: "Railway Config" → "railway", "Heroku/Procfile Config (worker)" → "heroku"
                const baseName = c.name.toLowerCase()
                    .replace(/\s*config\b.*$/i, '') // Remove "Config" and anything after
                    .replace(/\s*\(.*\)$/i, '') // Remove parenthetical
                    .replace(/[@/].*/g, '') // Remove @scope/version
                    .trim();
                const key = `${baseName}|${c.type}`;
                const existing = seen.get(key);
                if (!existing) {
                    seen.set(key, c);
                }
                else {
                    // Keep the one with more connections
                    const existingConns = existing.connects_to.length + existing.connected_from.length;
                    const newConns = c.connects_to.length + c.connected_from.length;
                    if (newConns > existingConns) {
                        seen.set(key, c);
                    }
                }
            }
            const dedupedComponents = [...seen.values()];
            console.log(`NavGator - Components (${dedupedComponents.length})\n`);
            // Group by layer
            const byLayer = {};
            for (const c of dedupedComponents) {
                if (!byLayer[c.role.layer])
                    byLayer[c.role.layer] = [];
                byLayer[c.role.layer].push(c);
            }
            for (const [layer, comps] of Object.entries(byLayer)) {
                console.log(`\n${layer.toUpperCase()}:`);
                for (const c of comps) {
                    const version = c.version ? `@${c.version}` : '';
                    console.log(`  ${c.name}${version} (${c.type})`);
                }
            }
        }
        catch (error) {
            console.error('List failed:', error);
            process.exit(1);
        }
    });
}
//# sourceMappingURL=list.js.map