/**
 * Field Usage Analyzer
 * Cross-references Prisma schema fields against actual code usage.
 * Uses grep-like scanning (no AST) for speed.
 */
import { ScanResult } from '../../types.js';
export type FieldUsageStatus = 'used' | 'unused' | 'write-only' | 'read-only';
export interface FieldUsageRecord {
    fieldName: string;
    columnName?: string;
    modelName: string;
    prismaType: string;
    isRelation: boolean;
    status: FieldUsageStatus;
    readFiles: string[];
    writeFiles: string[];
    allFiles: string[];
}
export interface ModelFieldUsage {
    modelName: string;
    totalFields: number;
    usedFields: number;
    unusedFields: number;
    writeOnlyFields: number;
    readOnlyFields: number;
    fields: FieldUsageRecord[];
}
export interface FieldUsageReport {
    scannedModels: number;
    scannedFiles: number;
    totalFields: number;
    usedFields: number;
    unusedFields: number;
    writeOnlyFields: number;
    readOnlyFields: number;
    models: ModelFieldUsage[];
}
/**
 * Scan field usage across the codebase for all Prisma models
 */
export declare function scanFieldUsage(projectRoot: string, walkSet?: Set<string>): Promise<ScanResult & {
    report?: FieldUsageReport;
}>;
/**
 * Detect if field usage analysis is possible (requires Prisma schema)
 */
export declare function canAnalyzeFieldUsage(projectRoot: string): boolean;
/**
 * Format field usage report for CLI output
 */
export declare function formatFieldUsageReport(report: FieldUsageReport): string;
//# sourceMappingURL=field-usage-analyzer.d.ts.map