/**
 * TypeSpec Validator
 * Compares Prisma model definitions against TypeScript interfaces/types.
 * Best-effort: not all models will have matching TS interfaces.
 */

import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';
import {
  ScanResult,
  ScanWarning,
} from '../../types.js';

// =============================================================================
// TYPE MAPPING
// =============================================================================

/**
 * Prisma scalar type → canonical TypeScript type(s)
 * Multiple accepted values per Prisma type to handle common patterns.
 */
const PRISMA_TO_TS: Record<string, string[]> = {
  String:   ['string'],
  Int:      ['number'],
  Float:    ['number'],
  Boolean:  ['boolean'],
  DateTime: ['Date', 'string'],        // string is common for serialized forms
  Json:     ['any', 'Record<string, unknown>', 'object', 'unknown', 'JsonValue'],
  BigInt:   ['bigint', 'number'],      // some codebases use number for BigInt
  Decimal:  ['number', 'Decimal', 'string'],
  Bytes:    ['Buffer', 'Uint8Array'],
};

// =============================================================================
// TYPES
// =============================================================================

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
  interfaceName?: string;     // found TS interface/type name
  interfaceFile?: string;     // relative path to file containing interface
  status: 'validated' | 'no-interface' | 'partial';
  matchedFields: number;
  mismatchedFields: number;
  missingFields: number;     // fields in Prisma not in TS interface
  extraFields: number;       // fields in TS interface not in Prisma
  fields: FieldValidation[];
  extraTsFields: string[];   // TS-only fields
}

export interface TypeSpecReport {
  modelsChecked: number;
  modelsWithInterfaces: number;
  modelsWithoutInterfaces: number;
  totalMismatches: number;
  totalMissing: number;
  models: ModelValidation[];
}

// =============================================================================
// PARSING
// =============================================================================

interface PrismaScalarField {
  name: string;
  type: string;
  isOptional: boolean;
  isArray: boolean;
  isRelation: boolean;
}

interface PrismaModelDef {
  name: string;
  fields: PrismaScalarField[];
}

function parsePrismaForValidation(content: string): PrismaModelDef[] {
  const models: PrismaModelDef[] = [];
  const SCALAR_TYPES = new Set([
    'String', 'Int', 'Float', 'Boolean', 'DateTime',
    'Json', 'Bytes', 'BigInt', 'Decimal',
  ]);

  const modelRegex = /model\s+(\w+)\s*\{([^}]*)\}/gs;
  let match: RegExpExecArray | null;

  while ((match = modelRegex.exec(content)) !== null) {
    const modelName = match[1];
    const body = match[2];
    const fields: PrismaScalarField[] = [];

    for (const line of body.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('@')) continue;
      if (trimmed.startsWith('@@')) continue;

      const fieldMatch = trimmed.match(/^(\w+)\s+(\w+)(\[\])?\??/);
      if (!fieldMatch) continue;

      const fieldName = fieldMatch[1];
      const fieldType = fieldMatch[2];
      const isArray = !!fieldMatch[3];
      const isOptional = trimmed.includes('?') && !isArray;

      const hasRelationAttr = trimmed.includes('@relation');
      const isImplicitRelation =
        !SCALAR_TYPES.has(fieldType) &&
        fieldType[0] === fieldType[0].toUpperCase() &&
        fieldType[0] !== fieldType[0].toLowerCase();

      const isRelation = hasRelationAttr || isImplicitRelation;

      fields.push({ name: fieldName, type: fieldType, isOptional, isArray, isRelation });
    }

    models.push({ name: modelName, fields });
  }

  return models;
}

// =============================================================================
// TS INTERFACE PARSING
// =============================================================================

interface TsField {
  name: string;
  type: string;
  isOptional: boolean;
}

interface TsInterface {
  name: string;
  fields: TsField[];
  file: string;
}

/**
 * Extract TypeScript interfaces and type aliases from source content.
 * Uses regex — best-effort, not a full AST parser.
 */
function extractTsInterfaces(content: string, filePath: string): TsInterface[] {
  const interfaces: TsInterface[] = [];

  // Match: interface Foo { ... } and type Foo = { ... }
  // This regex handles moderately nested braces up to one level deep.
  // For deeply nested types, we use a fallback.
  const interfacePatterns = [
    /(?:export\s+)?interface\s+(\w+)(?:\s+extends[^{]*)?\s*\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/gs,
    /(?:export\s+)?type\s+(\w+)\s*=\s*\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/gs,
  ];

  for (const pattern of interfacePatterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(content)) !== null) {
      const interfaceName = match[1];
      const body = match[2];
      const fields: TsField[] = [];

      // Parse field lines: fieldName?: type;
      const fieldPattern = /^\s*(?:readonly\s+)?(\w+)(\?)?:\s*([^;,\n]+)/gm;
      let fieldMatch: RegExpExecArray | null;

      while ((fieldMatch = fieldPattern.exec(body)) !== null) {
        const fieldName = fieldMatch[1];
        const isOptional = !!fieldMatch[2];
        const rawType = fieldMatch[3].trim().replace(/\s*\/\/.*$/, '').trim(); // strip inline comments

        fields.push({ name: fieldName, type: rawType, isOptional });
      }

      if (fields.length > 0) {
        interfaces.push({ name: interfaceName, fields, file: filePath });
      }
    }
  }

  return interfaces;
}

/**
 * Normalize a TypeScript type string for comparison.
 * Strips `| null`, `| undefined`, whitespace, handles common aliases.
 */
function normalizeTsType(raw: string): string {
  return raw
    .replace(/\s*\|\s*null/g, '')
    .replace(/\s*\|\s*undefined/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Check if a TS type is compatible with the expected types for a Prisma field.
 */
function isTypeCompatible(tsType: string, expectedTypes: string[]): boolean {
  const normalized = normalizeTsType(tsType);

  for (const expected of expectedTypes) {
    if (normalized === expected) return true;
    // Handle array types: e.g. "string[]" vs base type "string"
    if (normalized === `${expected}[]`) return true;
    // Handle union that includes the expected type
    if (normalized.split('|').map(t => t.trim()).includes(expected)) return true;
  }
  return false;
}

// =============================================================================
// MAIN SCANNER
// =============================================================================

/**
 * Validate TypeScript interfaces against Prisma model definitions.
 */
export async function scanTypeSpecValidation(projectRoot: string): Promise<ScanResult & { report?: TypeSpecReport }> {
  const warnings: ScanWarning[] = [];

  // Locate Prisma schema
  const schemaCandidates = [
    path.join(projectRoot, 'prisma/schema.prisma'),
    path.join(projectRoot, 'schema.prisma'),
  ];

  let schemaContent: string | null = null;

  for (const candidate of schemaCandidates) {
    if (fs.existsSync(candidate)) {
      try {
        schemaContent = await fs.promises.readFile(candidate, 'utf-8');
        break;
      } catch {
        // continue
      }
    }
  }

  // Directory-based schema
  if (!schemaContent) {
    const schemaDir = path.join(projectRoot, 'prisma/schema');
    if (fs.existsSync(schemaDir) && fs.statSync(schemaDir).isDirectory()) {
      const parts: string[] = [];
      try {
        const files = fs.readdirSync(schemaDir);
        for (const f of files) {
          if (f.endsWith('.prisma')) {
            const c = await fs.promises.readFile(path.join(schemaDir, f), 'utf-8');
            parts.push(c);
          }
        }
        if (parts.length > 0) schemaContent = parts.join('\n');
      } catch {
        // ignore
      }
    }
  }

  if (!schemaContent) {
    return { components: [], connections: [], warnings };
  }

  const prismaModels = parsePrismaForValidation(schemaContent);
  if (prismaModels.length === 0) {
    return { components: [], connections: [], warnings };
  }

  // Collect all TypeScript files
  let tsFiles: string[];
  try {
    tsFiles = await glob('**/*.{ts,tsx}', {
      cwd: projectRoot,
      ignore: [
        '**/node_modules/**',
        '**/_archive/**',
        '**/.next/**',
        '**/dist/**',
        '**/build/**',
        '**/.git/**',
        '**/coverage/**',
        '**/*.d.ts',
        '**/prisma/migrations/**',
      ],
      absolute: true,
    });
  } catch (error) {
    warnings.push({
      type: 'parse_error',
      message: `TypeSpec validator: failed to collect TS files: ${error instanceof Error ? error.message : 'Unknown'}`,
    });
    return { components: [], connections: [], warnings };
  }

  // Build map of interface name → TsInterface
  // (first occurrence wins; later files may override — we take last for now)
  const interfaceMap = new Map<string, TsInterface>();

  for (const filePath of tsFiles) {
    try {
      const content = await fs.promises.readFile(filePath, 'utf-8');
      const interfaces = extractTsInterfaces(content, filePath);
      for (const iface of interfaces) {
        // Allow later definitions to override (last wins — handles re-exports)
        interfaceMap.set(iface.name, iface);
      }
    } catch {
      // Skip unreadable files
    }
  }

  // Validate each Prisma model
  const modelValidations: ModelValidation[] = [];
  let totalMismatches = 0;
  let totalMissing = 0;
  let modelsWithInterfaces = 0;

  for (const model of prismaModels) {
    // Try to find a matching TS interface: exact name, or common suffixes
    const candidates = [
      model.name,
      `${model.name}Type`,
      `${model.name}Interface`,
      `I${model.name}`,
    ];

    let matchedInterface: TsInterface | undefined;
    for (const candidate of candidates) {
      if (interfaceMap.has(candidate)) {
        matchedInterface = interfaceMap.get(candidate)!;
        break;
      }
    }

    if (!matchedInterface) {
      modelValidations.push({
        modelName: model.name,
        status: 'no-interface',
        matchedFields: 0,
        mismatchedFields: 0,
        missingFields: 0,
        extraFields: 0,
        fields: [],
        extraTsFields: [],
      });
      continue;
    }

    modelsWithInterfaces++;

    const tsFieldMap = new Map<string, TsField>();
    for (const f of matchedInterface.fields) {
      tsFieldMap.set(f.name, f);
    }

    const fieldValidations: FieldValidation[] = [];
    const prismaFieldNames = new Set<string>();

    for (const pField of model.fields) {
      if (pField.isRelation) continue; // Skip relation fields — they're often not in TS interfaces
      prismaFieldNames.add(pField.name);

      const expectedTypes = PRISMA_TO_TS[pField.type] ?? [];
      const tsField = tsFieldMap.get(pField.name);

      if (!tsField) {
        fieldValidations.push({
          fieldName: pField.name,
          prismaType: pField.type,
          expectedTsTypes: expectedTypes,
          status: 'missing',
          note: `Field '${pField.name}' in Prisma model not found in TS interface`,
        });
        totalMissing++;
        continue;
      }

      if (expectedTypes.length === 0) {
        // Unknown Prisma type (enum or custom scalar) — mark as match with note
        fieldValidations.push({
          fieldName: pField.name,
          prismaType: pField.type,
          expectedTsTypes: [],
          actualTsType: tsField.type,
          status: 'match',
          note: `Custom type '${pField.type}' — skipping type validation`,
        });
        continue;
      }

      const compatible = isTypeCompatible(tsField.type, expectedTypes);

      if (compatible) {
        fieldValidations.push({
          fieldName: pField.name,
          prismaType: pField.type,
          expectedTsTypes: expectedTypes,
          actualTsType: tsField.type,
          status: 'match',
        });
      } else {
        fieldValidations.push({
          fieldName: pField.name,
          prismaType: pField.type,
          expectedTsTypes: expectedTypes,
          actualTsType: tsField.type,
          status: 'mismatch',
          note: `Prisma ${pField.type} expects ${expectedTypes.join(' | ')} but TS has '${tsField.type}'`,
        });
        totalMismatches++;

        warnings.push({
          type: 'low_confidence',
          message: `TypeSpec mismatch: ${model.name}.${pField.name} — Prisma ${pField.type} vs TS '${tsField.type}'`,
          file: path.relative(projectRoot, matchedInterface.file),
        });
      }
    }

    // Extra TS fields not in Prisma
    const extraTsFields = matchedInterface.fields
      .filter(f => !prismaFieldNames.has(f.name))
      .map(f => f.name);

    const hasIssues = fieldValidations.some(f => f.status === 'mismatch' || f.status === 'missing');

    modelValidations.push({
      modelName: model.name,
      interfaceName: matchedInterface.name,
      interfaceFile: path.relative(projectRoot, matchedInterface.file),
      status: hasIssues ? 'partial' : 'validated',
      matchedFields: fieldValidations.filter(f => f.status === 'match').length,
      mismatchedFields: fieldValidations.filter(f => f.status === 'mismatch').length,
      missingFields: fieldValidations.filter(f => f.status === 'missing').length,
      extraFields: extraTsFields.length,
      fields: fieldValidations,
      extraTsFields,
    });
  }

  const report: TypeSpecReport = {
    modelsChecked: prismaModels.length,
    modelsWithInterfaces,
    modelsWithoutInterfaces: prismaModels.length - modelsWithInterfaces,
    totalMismatches,
    totalMissing,
    models: modelValidations,
  };

  return {
    components: [],
    connections: [],
    warnings,
    report,
  } as ScanResult & { report: TypeSpecReport };
}

/**
 * Detect if typespec validation is possible
 */
export function canValidateTypeSpec(projectRoot: string): boolean {
  return (
    fs.existsSync(path.join(projectRoot, 'prisma/schema.prisma')) ||
    fs.existsSync(path.join(projectRoot, 'schema.prisma')) ||
    fs.existsSync(path.join(projectRoot, 'prisma/schema'))
  );
}

// =============================================================================
// FORMATTING
// =============================================================================

/**
 * Format typespec validation report for CLI output
 */
export function formatTypeSpecReport(report: TypeSpecReport): string {
  const lines: string[] = [];
  lines.push('TypeSpec Validation Report');
  lines.push('');
  lines.push(`Models checked:          ${report.modelsChecked}`);
  lines.push(`With TS interfaces:      ${report.modelsWithInterfaces}`);
  lines.push(`Without TS interfaces:   ${report.modelsWithoutInterfaces}`);
  lines.push(`Type mismatches:         ${report.totalMismatches}`);
  lines.push(`Missing fields (in TS):  ${report.totalMissing}`);
  lines.push('');

  const validated = report.models.filter(m => m.status === 'validated');
  const partial = report.models.filter(m => m.status === 'partial');
  const noInterface = report.models.filter(m => m.status === 'no-interface');

  if (validated.length > 0) {
    lines.push(`VALID (${validated.length}):`);
    for (const m of validated) {
      lines.push(`  ${m.modelName} -> ${m.interfaceName} (${m.matchedFields} fields match)`);
    }
    lines.push('');
  }

  if (partial.length > 0) {
    lines.push(`ISSUES FOUND (${partial.length}):`);
    for (const m of partial) {
      lines.push(`  ${m.modelName} -> ${m.interfaceName} in ${m.interfaceFile}`);
      for (const f of m.fields.filter(fv => fv.status === 'mismatch')) {
        lines.push(`    MISMATCH: ${f.fieldName} — ${f.note}`);
      }
      for (const f of m.fields.filter(fv => fv.status === 'missing')) {
        lines.push(`    MISSING:  ${f.fieldName} (${f.prismaType}) not in TS interface`);
      }
      if (m.extraTsFields.length > 0) {
        lines.push(`    EXTRA TS: ${m.extraTsFields.slice(0, 5).join(', ')}${m.extraTsFields.length > 5 ? '...' : ''}`);
      }
    }
    lines.push('');
  }

  if (noInterface.length > 0) {
    lines.push(`NO TS INTERFACE FOUND (${noInterface.length}):`);
    const shown = noInterface.slice(0, 20);
    lines.push(`  ${shown.map(m => m.modelName).join(', ')}${noInterface.length > 20 ? `, ... +${noInterface.length - 20} more` : ''}`);
  }

  if (report.totalMismatches === 0 && report.totalMissing === 0 && report.modelsWithInterfaces > 0) {
    lines.push('All validated interfaces match their Prisma models.');
  }

  return lines.join('\n');
}
