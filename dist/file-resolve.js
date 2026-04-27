/**
 * NavGator File-Level Resolution
 * Resolves file paths to import connections when no component exists.
 * Enables `navgator impact src/foo.ts` and `navgator connections src/foo.ts`.
 */
/**
 * Normalize a query to match FILE: connection IDs.
 * Strips leading ./ and normalizes separators.
 */
function normalizeToFileId(query) {
    const normalized = query.replace(/\\/g, '/').replace(/^\.\//, '');
    return `FILE:${normalized}`;
}
/**
 * Check if a query looks like a file path.
 */
export function looksLikeFilePath(query) {
    return (query.includes('/') ||
        query.includes('.ts') ||
        query.includes('.js') ||
        query.includes('.tsx') ||
        query.includes('.jsx') ||
        query.includes('.py') ||
        query.includes('.swift'));
}
/**
 * Resolve a file path to its import connections.
 * Returns null if no connections found for this file.
 */
export function resolveFileConnections(query, allConnections) {
    const fileId = normalizeToFileId(query);
    const normalized = query.replace(/\\/g, '/').replace(/^\.\//, '');
    // Find connections where this file is the source or target
    const importedBy = [];
    const imports = [];
    const otherFrom = [];
    const otherTo = [];
    for (const conn of allConnections) {
        const fromMatch = conn.from.component_id === fileId ||
            conn.from.component_id === `FILE:${normalized}` ||
            conn.code_reference?.file === normalized;
        const toMatch = conn.to.component_id === fileId ||
            conn.to.component_id === `FILE:${normalized}`;
        if (conn.connection_type === 'imports') {
            if (fromMatch)
                imports.push(conn);
            if (toMatch)
                importedBy.push(conn);
        }
        else {
            if (fromMatch)
                otherFrom.push(conn);
            if (toMatch)
                otherTo.push(conn);
        }
    }
    const total = importedBy.length + imports.length + otherFrom.length + otherTo.length;
    if (total === 0)
        return null;
    return { filePath: normalized, fileId, importedBy, imports, otherFrom, otherTo };
}
/**
 * Format file-level impact analysis for CLI output.
 */
export function formatFileImpact(fc) {
    const lines = [];
    lines.push(`NavGator - File Impact: ${fc.filePath}\n`);
    lines.push('========================================');
    lines.push(`File: ${fc.filePath}`);
    const directCount = fc.importedBy.length;
    const severity = directCount > 5 ? 'CRITICAL' : directCount >= 3 ? 'HIGH' : directCount >= 1 ? 'MEDIUM' : 'LOW';
    lines.push(`Impact: ${severity} (${directCount} file${directCount !== 1 ? 's' : ''} import this)`);
    if (fc.importedBy.length > 0) {
        lines.push(`\nIMPORTED BY (${fc.importedBy.length}):`);
        lines.push('These files import this file:\n');
        for (const conn of fc.importedBy) {
            const fromFile = conn.from.component_id.replace('FILE:', '');
            const lineInfo = conn.code_reference?.line_start ? `:${conn.code_reference.line_start}` : '';
            lines.push(`  ${fromFile}${lineInfo}`);
            if (conn.code_reference?.symbol) {
                lines.push(`    import: ${conn.code_reference.symbol}`);
            }
        }
    }
    if (fc.imports.length > 0) {
        lines.push(`\nIMPORTS (${fc.imports.length}):`);
        lines.push('This file imports:\n');
        for (const conn of fc.imports) {
            const toFile = conn.to.component_id.replace('FILE:', '');
            lines.push(`  ${toFile}`);
        }
    }
    if (fc.otherFrom.length > 0) {
        lines.push(`\nOUTGOING SERVICE CALLS (${fc.otherFrom.length}):`);
        for (const conn of fc.otherFrom) {
            const target = conn.to.component_id;
            lines.push(`  → ${target} (${conn.connection_type})`);
        }
    }
    if (fc.otherTo.length > 0) {
        lines.push(`\nINCOMING REFERENCES (${fc.otherTo.length}):`);
        for (const conn of fc.otherTo) {
            const source = conn.from.component_id;
            lines.push(`  ← ${source} (${conn.connection_type})`);
        }
    }
    lines.push('\n========================================');
    lines.push('Files that may need changes:');
    for (const conn of fc.importedBy) {
        const fromFile = conn.from.component_id.replace('FILE:', '');
        lines.push(`  - ${fromFile}`);
    }
    return lines.join('\n');
}
/**
 * Format file-level connections for CLI output.
 */
export function formatFileConnections(fc) {
    const lines = [];
    lines.push(`NavGator - File Connections: ${fc.filePath}\n`);
    lines.push('========================================');
    lines.push(`File: ${fc.filePath}`);
    if (fc.importedBy.length > 0) {
        lines.push(`\nIMPORTED BY (${fc.importedBy.length}):`);
        for (const conn of fc.importedBy) {
            const fromFile = conn.from.component_id.replace('FILE:', '');
            const lineInfo = conn.code_reference?.line_start ? `:${conn.code_reference.line_start}` : '';
            lines.push(`├── ${fromFile}${lineInfo}`);
            if (conn.code_reference?.symbol) {
                lines.push(`│   └── import: ${conn.code_reference.symbol}`);
            }
        }
    }
    if (fc.imports.length > 0) {
        lines.push(`\nIMPORTS (${fc.imports.length}):`);
        for (const conn of fc.imports) {
            const toFile = conn.to.component_id.replace('FILE:', '');
            lines.push(`├── ${toFile}`);
        }
    }
    if (fc.otherFrom.length > 0) {
        lines.push(`\nOUTGOING (${fc.otherFrom.length}):`);
        for (const conn of fc.otherFrom) {
            lines.push(`├── ${conn.connection_type} → ${conn.to.component_id}`);
        }
    }
    if (fc.otherTo.length > 0) {
        lines.push(`\nINCOMING (${fc.otherTo.length}):`);
        for (const conn of fc.otherTo) {
            lines.push(`├── ${conn.connection_type} ← ${conn.from.component_id}`);
        }
    }
    const total = fc.importedBy.length + fc.imports.length + fc.otherFrom.length + fc.otherTo.length;
    if (total === 0) {
        lines.push('\nNo connections found for this file.');
    }
    return lines.join('\n');
}
//# sourceMappingURL=file-resolve.js.map