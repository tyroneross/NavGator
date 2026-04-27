import { loadAllComponents } from '../../storage.js';
import { getConfig } from '../../config.js';
import { wrapInEnvelope } from '../../agent-output.js';
/**
 * Lightweight fuzzy scorer with no new dependencies.
 *
 * Scoring (max ≈ 100):
 *   - exact name match (case-insensitive)              → 100
 *   - name contains query as substring                 → 60 + length-bonus
 *   - any token of name matches a query token exactly  → 30 per token
 *   - purpose contains query as substring              → 20
 *   - tag matches query token exactly                  → 10 per token
 *   - file_path contains query                         → 8
 *   - subsequence-only match (chars in order)          → 4
 *
 * Multiple bonuses stack. Returned `score` is the raw sum (uncapped).
 */
function scoreComponent(c, query) {
    const q = query.toLowerCase().trim();
    if (!q)
        return 0;
    const qTokens = q.split(/\s+/).filter(Boolean);
    const name = (c.name || '').toLowerCase();
    const purpose = (c.role?.purpose || '').toLowerCase();
    const tags = (c.tags || []).map((t) => t.toLowerCase());
    const file = (c.source?.config_files?.[0] || '').toLowerCase();
    const nameTokens = name.split(/[\s/_.\-]+/).filter(Boolean);
    let score = 0;
    if (name === q)
        score += 100;
    else if (name.includes(q))
        score += 60 + Math.min(20, q.length);
    for (const qt of qTokens) {
        if (nameTokens.includes(qt))
            score += 30;
        if (tags.includes(qt))
            score += 10;
    }
    if (purpose.includes(q))
        score += 20;
    if (file.includes(q))
        score += 8;
    if (score === 0) {
        // Subsequence match: every char of q appears in name in order.
        let i = 0;
        for (const ch of name) {
            if (ch === q[i])
                i++;
            if (i === q.length)
                break;
        }
        if (i === q.length)
            score = 4;
    }
    return score;
}
function buildContext(c) {
    const parts = [];
    if (c.role?.purpose)
        parts.push(c.role.purpose);
    const file = c.source?.config_files?.[0];
    if (file)
        parts.push(`@ ${file}`);
    return parts.join(' — ');
}
export function registerFindCommand(program) {
    program
        .command('find <query>')
        .description('Fuzzy-find components by name, purpose, tag, or file path')
        .option('-l, --limit <n>', 'Max hits to return', '10')
        .option('-t, --type <type>', 'Filter by component type')
        .option('--json', 'Output as JSON')
        .option('--agent', 'Output wrapped in agent envelope (implies --json)')
        .action(async (query, options) => {
        try {
            const config = getConfig();
            let components = await loadAllComponents(config);
            if (options.type) {
                components = components.filter((c) => c.type === options.type);
            }
            const limit = Math.max(1, Number(options.limit) || 10);
            const hits = components
                .map((c) => ({
                comp: c,
                score: scoreComponent(c, query),
            }))
                .filter((h) => h.score > 0)
                .sort((a, b) => b.score - a.score)
                .slice(0, limit)
                .map(({ comp, score }) => ({
                stable_id: comp.stable_id ?? comp.component_id,
                component_id: comp.component_id,
                name: comp.name,
                type: comp.type,
                layer: comp.role?.layer ?? 'unknown',
                score,
                context: buildContext(comp),
            }));
            if (options.agent) {
                console.log(wrapInEnvelope('find', { query, hits }));
                return;
            }
            if (options.json) {
                console.log(JSON.stringify({ query, hits }, null, 2));
                return;
            }
            if (hits.length === 0) {
                console.log(`No components matched "${query}".`);
                if (components.length === 0) {
                    console.log('No NavGator data found. Run `navgator scan` first.');
                }
                return;
            }
            console.log(`Found ${hits.length} component(s) matching "${query}":\n`);
            for (const h of hits) {
                console.log(`  [${h.score.toString().padStart(3)}] ${h.name}  (${h.type}/${h.layer})`);
                if (h.context)
                    console.log(`        ${h.context}`);
                console.log(`        stable_id: ${h.stable_id}`);
            }
        }
        catch (err) {
            console.error(`Error: ${err.message}`);
            process.exit(1);
        }
    });
}
//# sourceMappingURL=find.js.map