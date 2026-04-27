/**
 * Prisma Schema Scanner
 * Parses prisma/schema.prisma to extract database models, relations, and indexes
 */
import { ScanResult } from '../../types.js';
interface DatasourceInfo {
    engine: string;
    connection_env_var?: string;
}
/**
 * Parse the datasource block from a Prisma schema to extract provider and
 * connection env var.
 *
 * Handles:
 *   datasource db {
 *     provider = "postgresql"
 *     url      = env("DATABASE_URL")
 *   }
 */
export declare function parseDatasource(content: string): DatasourceInfo | null;
/**
 * Scan for Prisma schema and extract database models
 */
export declare function scanPrismaSchema(projectRoot: string): Promise<ScanResult>;
/**
 * Detect if project uses Prisma
 */
export declare function detectPrisma(projectRoot: string): boolean;
export {};
//# sourceMappingURL=prisma-scanner.d.ts.map