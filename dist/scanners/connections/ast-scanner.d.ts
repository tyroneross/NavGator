/**
 * AST-based Connection Scanner
 * Uses ts-morph for accurate TypeScript/JavaScript analysis
 *
 * This scanner provides higher accuracy than regex by:
 * - Tracking import statements and their usage
 * - Following method chains (import { customers } from 'stripe'; customers.create())
 * - Detecting API calls, database operations, and service integrations
 *
 * NOTE: ts-morph is an optional dependency. Install it with:
 *   npm install ts-morph
 */
import { ScanResult } from '../../types.js';
/**
 * Check if ts-morph is available
 */
export declare function isTsMorphAvailable(): Promise<boolean>;
/**
 * Scan TypeScript/JavaScript files using AST analysis
 *
 * When `walkSet` is provided (incremental mode), only files whose project-relative
 * path is in the set are loaded into the ts-morph project. When `undefined`, all
 * matching source files are loaded (bit-identical to full-scan behavior).
 */
export declare function scanWithAST(projectRoot: string, walkSet?: Set<string>): Promise<ScanResult>;
/**
 * Scan for database operations (Prisma patterns)
 *
 * Accepts an optional `walkSet` of project-relative paths to restrict
 * the scan in incremental mode. Bit-identical to today when undefined.
 */
export declare function scanDatabaseOperations(projectRoot: string, walkSet?: Set<string>): Promise<ScanResult>;
//# sourceMappingURL=ast-scanner.d.ts.map