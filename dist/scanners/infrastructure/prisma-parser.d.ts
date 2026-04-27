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
export interface ParsedPrismaModel {
    name: string;
    body: string;
}
/**
 * Parse Prisma schema content into model blocks using brace-depth counting.
 * Handles nested braces like @default({}) correctly.
 */
export declare function parsePrismaModels(content: string): ParsedPrismaModel[];
//# sourceMappingURL=prisma-parser.d.ts.map