/**
 * NavGator Component Resolution
 * Resolves component queries (names, file paths, IDs) to ArchitectureComponent objects
 */
import { componentBaseName } from './component-identity.js';
/**
 * Resolve a query string to an architecture component.
 *
 * Resolution order:
 * 1. Exact component ID match
 * 2. Exact component name match (case-insensitive)
 * 3. File path match via fileMap → component ID → component
 * 4. Partial name match (substring, case-insensitive)
 * 4b. Base-name alias match (e.g. "Railway" / "Railway Config" / "Railway (infra)"
 *     all collapse to the same identity) — fires only when step 4 found nothing,
 *     preferring the candidate with the most connections.
 * 5. File path substring match (normalized, no leading ./)
 */
export function resolveComponent(query, components, fileMap) {
    if (!query || components.length === 0)
        return null;
    // 1. Exact component ID match
    const byId = components.find(c => c.component_id === query);
    if (byId)
        return byId;
    // 2. Exact name match (case-insensitive)
    const byName = components.find(c => c.name.toLowerCase() === query.toLowerCase());
    if (byName)
        return byName;
    // 3. File path match via fileMap
    if (fileMap) {
        const normalizedQuery = normalizePath(query);
        // Try exact match first
        const componentId = fileMap[normalizedQuery] || fileMap[query];
        if (componentId) {
            const byFileMap = components.find(c => c.component_id === componentId);
            if (byFileMap)
                return byFileMap;
        }
        // Try all fileMap entries for normalized match
        for (const [filePath, compId] of Object.entries(fileMap)) {
            if (normalizePath(filePath) === normalizedQuery) {
                const match = components.find(c => c.component_id === compId);
                if (match)
                    return match;
            }
        }
    }
    // 4. Partial name match (substring, case-insensitive)
    // When multiple matches exist, prefer the one with more connections (more architecturally relevant)
    const queryLower = query.toLowerCase();
    const partialMatches = components.filter(c => c.name.toLowerCase().includes(queryLower));
    if (partialMatches.length === 1)
        return partialMatches[0];
    if (partialMatches.length > 1) {
        // Sort by connection count (descending), then by name length (shorter = more specific)
        partialMatches.sort((a, b) => {
            const aConns = a.connects_to.length + a.connected_from.length;
            const bConns = b.connects_to.length + b.connected_from.length;
            if (bConns !== aConns)
                return bConns - aConns;
            return a.name.length - b.name.length;
        });
        return partialMatches[0];
    }
    // 4b. Base-name alias match — collapses "Railway" / "Railway Config" / "Railway (infra)"
    // into one identity. Only fires here because step 4 found nothing; preserves steps 1-4's
    // precedence entirely.
    const queryBaseName = componentBaseName(query);
    if (queryBaseName) {
        const aliasMatches = components.filter(c => componentBaseName(c.name) === queryBaseName);
        if (aliasMatches.length === 1)
            return aliasMatches[0];
        if (aliasMatches.length > 1) {
            aliasMatches.sort((a, b) => {
                const aConns = a.connects_to.length + a.connected_from.length;
                const bConns = b.connects_to.length + b.connected_from.length;
                return bConns - aConns;
            });
            return aliasMatches[0];
        }
    }
    // 5. File path substring match
    const normalizedQuery = normalizePath(query);
    if (fileMap) {
        for (const [filePath, compId] of Object.entries(fileMap)) {
            if (normalizePath(filePath).includes(normalizedQuery)) {
                const match = components.find(c => c.component_id === compId);
                if (match)
                    return match;
            }
        }
    }
    // Also check component source config_files for path matches
    for (const comp of components) {
        for (const configFile of comp.source.config_files || []) {
            if (normalizePath(configFile).includes(normalizedQuery)) {
                return comp;
            }
        }
    }
    return null;
}
/**
 * Find candidate suggestions when resolution fails.
 * Returns up to 5 closest matches for "Did you mean?" hints.
 */
export function findCandidates(query, components, maxResults = 5) {
    const queryLower = query.toLowerCase();
    // Score each component by relevance
    const scored = components.map(c => {
        const nameLower = c.name.toLowerCase();
        let score = 0;
        // Substring match
        if (nameLower.includes(queryLower) || queryLower.includes(nameLower)) {
            score += 3;
        }
        // Common prefix
        let prefix = 0;
        for (let i = 0; i < Math.min(nameLower.length, queryLower.length); i++) {
            if (nameLower[i] === queryLower[i])
                prefix++;
            else
                break;
        }
        score += prefix;
        // Levenshtein-like: penalize length difference
        score -= Math.abs(nameLower.length - queryLower.length) * 0.5;
        return { name: c.name, score };
    });
    return scored
        .filter(s => s.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, maxResults)
        .map(s => s.name);
}
/**
 * Normalize a file path for comparison:
 * - Remove leading ./
 * - Convert backslashes to forward slashes
 * - Lowercase for case-insensitive comparison
 */
function normalizePath(p) {
    return p
        .replace(/\\/g, '/')
        .replace(/^\.\//, '')
        .toLowerCase();
}
//# sourceMappingURL=resolve.js.map