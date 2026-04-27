/**
 * Prisma Call Scanner
 * Detects prisma.{modelName}.{operation}() patterns in source files
 * and creates api-calls-db connections from source files to Prisma model components.
 */
import { ArchitectureComponent, ScanResult } from '../../types.js';
/**
 * Scan source files for Prisma client calls and create api-calls-db connections
 */
export declare function scanPrismaCalls(projectRoot: string, modelComponents: ArchitectureComponent[], walkSet?: Set<string>): Promise<ScanResult>;
//# sourceMappingURL=prisma-calls.d.ts.map