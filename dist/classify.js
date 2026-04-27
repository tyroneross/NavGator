/**
 * NavGator Semantic Connection Classification
 * Classifies connections as production, admin, analytics, test, dev-only, migration, or unknown
 */
/**
 * Classify a connection based on file path patterns of source and target components.
 */
export function classifyConnection(conn, fromComponent, toComponent) {
    // Collect all relevant file paths
    const paths = [
        conn.code_reference?.file,
        conn.from.location?.file,
        conn.to.location?.file,
        ...(fromComponent.source.config_files || []),
    ].filter(Boolean);
    // Check each classification pattern against all paths
    for (const p of paths) {
        const lower = p.toLowerCase();
        // Test patterns (highest priority — test files shouldn't be treated as production)
        if (isTestPath(lower)) {
            return { classification: 'test', confidence: 0.9 };
        }
        // Migration patterns
        if (isMigrationPath(lower)) {
            return { classification: 'migration', confidence: 0.9 };
        }
        // Dev-only patterns
        if (isDevPath(lower)) {
            return { classification: 'dev-only', confidence: 0.9 };
        }
        // Admin patterns
        if (isAdminPath(lower)) {
            return { classification: 'admin', confidence: 0.9 };
        }
        // Analytics patterns
        if (isAnalyticsPath(lower)) {
            return { classification: 'analytics', confidence: 0.9 };
        }
    }
    // Component name heuristic
    const fromName = fromComponent.name.toLowerCase();
    const toName = toComponent.name.toLowerCase();
    if (fromName.includes('test') || toName.includes('test')) {
        return { classification: 'test', confidence: 0.7 };
    }
    if (fromName.includes('admin') || toName.includes('admin')) {
        return { classification: 'admin', confidence: 0.7 };
    }
    if (fromName.includes('analytics') || fromName.includes('metric') || toName.includes('analytics') || toName.includes('metric')) {
        return { classification: 'analytics', confidence: 0.7 };
    }
    // Final file path check — catches scripts/ when component names didn't trigger above
    const connFile = conn.code_reference?.file?.toLowerCase() || '';
    const fromFile = conn.from.location?.file?.toLowerCase() || '';
    if (/(^scripts\/|\/scripts\/)/.test(connFile) || /(^scripts\/|\/scripts\/)/.test(fromFile)) {
        return { classification: 'dev-only', confidence: 0.9 };
    }
    if (isTestPath(connFile) || isTestPath(fromFile)) {
        return { classification: 'test', confidence: 0.8 };
    }
    // Default: production
    return { classification: 'production', confidence: 0.4 };
}
/**
 * Classify all connections in a batch
 */
export function classifyAllConnections(connections, components) {
    const componentMap = new Map(components.map(c => [c.component_id, c]));
    const result = new Map();
    for (const conn of connections) {
        const from = componentMap.get(conn.from.component_id);
        const to = componentMap.get(conn.to.component_id);
        if (from && to) {
            result.set(conn.connection_id, classifyConnection(conn, from, to));
        }
        else {
            // Components not resolved (FILE: prefix IDs) — classify by file paths only
            const filePaths = [
                conn.code_reference?.file,
                conn.from.location?.file,
                conn.to.location?.file,
            ].filter(Boolean);
            let classified = false;
            for (const p of filePaths) {
                const lower = p.toLowerCase();
                if (isTestPath(lower)) {
                    result.set(conn.connection_id, { classification: 'test', confidence: 0.8 });
                    classified = true;
                    break;
                }
                if (isDevPath(lower)) {
                    result.set(conn.connection_id, { classification: 'dev-only', confidence: 0.8 });
                    classified = true;
                    break;
                }
                if (isMigrationPath(lower)) {
                    result.set(conn.connection_id, { classification: 'migration', confidence: 0.8 });
                    classified = true;
                    break;
                }
            }
            if (!classified) {
                result.set(conn.connection_id, { classification: 'production', confidence: 0.4 });
            }
        }
    }
    return result;
}
function isTestPath(p) {
    return /(__tests__|\.test\.|\.spec\.|\/tests?\/|\/testing\/)/.test(p);
}
function isMigrationPath(p) {
    return /(\/migrations?\/|\/migrate|\.migration\.|\/seeds?\/)/.test(p);
}
function isDevPath(p) {
    return /(^scripts\/|\/scripts\/|\/dev\/|\.dev\.|webpack\.config|vite\.config|rollup\.config|jest\.config|eslint|prettier|\.storybook)/.test(p);
}
function isAdminPath(p) {
    return /(\/admin\/|\/dashboard\/|\/internal\/|\/backoffice\/)/.test(p);
}
function isAnalyticsPath(p) {
    return /(\/analytics\/|\/tracking\/|\/telemetry\/|\/metrics\/|\/monitoring\/)/.test(p);
}
//# sourceMappingURL=classify.js.map