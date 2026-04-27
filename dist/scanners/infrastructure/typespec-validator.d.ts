/**
 * TypeSpec Validator
 * Compares Prisma model definitions against TypeScript interfaces/types.
 * Best-effort: not all models will have matching TS interfaces.
 */
import { ScanResult } from '../../types.js';
export type ValidationStatus = 'match' | 'mismatch' | 'missing' | 'no-interface';
export interface FieldValidation {
    fieldName: string;
    prismaType: string;
    expectedTsTypes: string[];
    actualTsType?: string;
    status: ValidationStatus;
    note?: string;
}
export interface ModelValidation {
    modelName: string;
    interfaceName?: string;
    interfaceFile?: string;
    status: 'validated' | 'no-interface' | 'partial';
    matchedFields: number;
    mismatchedFields: number;
    missingFields: number;
    extraFields: number;
    fields: FieldValidation[];
    extraTsFields: string[];
}
export interface TypeSpecReport {
    modelsChecked: number;
    modelsWithInterfaces: number;
    modelsWithoutInterfaces: number;
    totalMismatches: number;
    totalMissing: number;
    models: ModelValidation[];
}
/**
 * Validate TypeScript interfaces against Prisma model definitions.
 */
export declare function scanTypeSpecValidation(projectRoot: string): Promise<ScanResult & {
    report?: TypeSpecReport;
}>;
/**
 * Detect if typespec validation is possible
 */
export declare function canValidateTypeSpec(projectRoot: string): boolean;
/**
 * Format typespec validation report for CLI output
 */
export declare function formatTypeSpecReport(report: TypeSpecReport): string;
//# sourceMappingURL=typespec-validator.d.ts.map