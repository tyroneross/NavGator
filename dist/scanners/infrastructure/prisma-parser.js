/**
 * Shared Prisma schema parser utility.
 *
 * Replaces the broken /model\s+(\w+)\s*\{([^}]*)\}/gs regex pattern used
 * across multiple scanners. That regex stops at the first `}`, silently
 * dropping fields that appear after nested braces such as @default({}) or
 * @relation({fields: [...], references: [...]}).
 *
 * This implementation uses brace-depth counting to correctly locate the
 * matching closing brace for each model block.
 */
/**
 * Parse Prisma schema content into model blocks using brace-depth counting.
 * Handles nested braces like @default({}) correctly.
 */
export function parsePrismaModels(content) {
    const models = [];
    const modelStartRegex = /model\s+(\w+)\s*\{/g;
    let startMatch;
    while ((startMatch = modelStartRegex.exec(content)) !== null) {
        const modelName = startMatch[1];
        const bodyStart = startMatch.index + startMatch[0].length;
        // Count braces to find the matching closing brace, skipping string literals
        let depth = 1;
        let i = bodyStart;
        let inString = false;
        let stringChar = '';
        while (i < content.length && depth > 0) {
            const ch = content[i];
            const prev = i > 0 ? content[i - 1] : '';
            if ((ch === '"' || ch === "'") && prev !== '\\') {
                if (!inString) {
                    inString = true;
                    stringChar = ch;
                }
                else if (ch === stringChar) {
                    inString = false;
                }
            }
            else if (!inString) {
                if (ch === '{')
                    depth++;
                else if (ch === '}')
                    depth--;
            }
            i++;
        }
        if (depth === 0) {
            const body = content.substring(bodyStart, i - 1);
            models.push({ name: modelName, body });
        }
        // Resume regex search after this model block so consecutive models
        // are not skipped and the regex does not re-scan already-parsed text.
        modelStartRegex.lastIndex = i;
    }
    return models;
}
//# sourceMappingURL=prisma-parser.js.map