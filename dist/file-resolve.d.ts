/**
 * NavGator File-Level Resolution
 * Resolves file paths to import connections when no component exists.
 * Enables `navgator impact src/foo.ts` and `navgator connections src/foo.ts`.
 */
import type { ArchitectureConnection } from './types.js';
export interface FileConnections {
    filePath: string;
    fileId: string;
    /** Files that import this file */
    importedBy: ArchitectureConnection[];
    /** Files this file imports */
    imports: ArchitectureConnection[];
    /** Non-import connections (service calls, etc.) where this file appears */
    otherFrom: ArchitectureConnection[];
    otherTo: ArchitectureConnection[];
}
/**
 * Check if a query looks like a file path.
 */
export declare function looksLikeFilePath(query: string): boolean;
/**
 * Resolve a file path to its import connections.
 * Returns null if no connections found for this file.
 */
export declare function resolveFileConnections(query: string, allConnections: ArchitectureConnection[]): FileConnections | null;
/**
 * Format file-level impact analysis for CLI output.
 */
export declare function formatFileImpact(fc: FileConnections): string;
/**
 * Format file-level connections for CLI output.
 */
export declare function formatFileConnections(fc: FileConnections): string;
//# sourceMappingURL=file-resolve.d.ts.map