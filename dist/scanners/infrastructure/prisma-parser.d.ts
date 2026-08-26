/**
 * Shared Prisma schema parser utility.
 *
 * Replaces the broken /model\s+(\w+)\s*\{([^}]*)\}/gs regex pattern used
 * across multiple scanners. That regex stops at the first `}`, silently
 * dropping fields that appear after nested braces such as @default({}) or
 * @relation({fields: [...], references: [...]}).
 *
 * This implementation uses a small lexer plus brace-depth counting to locate
 * active model declarations and their matching closing braces. The lexer
 * ignores comments and quoted strings so their contents cannot change parser
 * state or create phantom models.
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