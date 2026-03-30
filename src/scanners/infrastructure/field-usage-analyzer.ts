/**
 * Field Usage Analyzer
 * Cross-references Prisma schema fields against actual code usage.
 * Uses grep-like scanning (no AST) for speed.
 */

import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';
import {
  ArchitectureComponent,
  ArchitectureConnection,
  ScanResult,
  ScanWarning,
  generateComponentId,
  generateConnectionId,
} from '../../types.js';

// =============================================================================
// TYPES
// =============================================================================

export type FieldUsageStatus = 'used' | 'unused' | 'write-only' | 'read-only';

export interface FieldUsageRecord {
  fieldName: string;
  columnName?: string;
  modelName: string;
  prismaType: string;
  isRelation: boolean;
  status: FieldUsageStatus;
  readFiles: string[];   // files that reference this field in a read context
  writeFiles: string[];  // files that reference this field in a write context
  allFiles: string[];    // all files referencing this field
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

// =============================================================================
// PRISMA FIELD EXTRACTION (minimal re-parse, no full schema re-parse)
// =============================================================================

interface MinimalField {
  name: string;
  type: string;
  columnName?: string;
  isRelation: boolean;
  isOptional: boolean;
}

interface MinimalModel {
  name: string;
  fields: MinimalField[];
}

function extractModelsFromSchema(content: string): MinimalModel[] {
  const models: MinimalModel[] = [];
  const SCALAR_TYPES = new Set([
    'String', 'Int', 'Float', 'Boolean', 'DateTime',
    'Json', 'Bytes', 'BigInt', 'Decimal',
  ]);

  const modelRegex = /model\s+(\w+)\s*\{([^}]*)\}/gs;
  let match: RegExpExecArray | null;

  while ((match = modelRegex.exec(content)) !== null) {
    const modelName = match[1];
    const body = match[2];
    const fields: MinimalField[] = [];

    for (const line of body.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('@')) continue;
      if (trimmed.startsWith('@@')) continue;

      const fieldMatch = trimmed.match(/^(\w+)\s+(\w+)(\[\])?\??/);
      if (!fieldMatch) continue;

      const fieldName = fieldMatch[1];
      const fieldType = fieldMatch[2];
      const isOptional = trimmed.includes('?');

      // Detect relation: has @relation or type is a non-scalar uppercase type
      const hasRelationAttr = trimmed.includes('@relation');
      const isImplicitRelation =
        !SCALAR_TYPES.has(fieldType) &&
        fieldType[0] === fieldType[0].toUpperCase() &&
        fieldType[0] !== fieldType[0].toLowerCase();

      const isRelation = hasRelationAttr || isImplicitRelation;

      // @map("column_name")
      const colMapMatch = trimmed.match(/@map\(\s*"([^"]+)"\s*\)/);

      fields.push({
        name: fieldName,
        type: fieldType,
        columnName: colMapMatch?.[1],
        isRelation,
        isOptional,
      });
    }

    models.push({ name: modelName, fields });
  }

  return models;
}

// =============================================================================
// GREP-LIKE SCANNER
// =============================================================================

// Write-context patterns: field being assigned, used in create/update/set
const WRITE_PATTERNS = [
  /\.create\s*\(/,
  /\.createMany\s*\(/,
  /\.update\s*\(/,
  /\.updateMany\s*\(/,
  /\.upsert\s*\(/,
  /data\s*:\s*\{/,
  /INSERT\s+INTO/i,
  /UPDATE\s+\w+\s+SET/i,
];

// Read-context patterns: field being selected/returned
const READ_PATTERNS = [
  /\.findUnique\s*\(/,
  /\.findFirst\s*\(/,
  /\.findMany\s*\(/,
  /select\s*:\s*\{/,
  /SELECT\s+/i,
  /\.map\s*\(/,
  /\.filter\s*\(/,
  /res\.|response\.|result\./,
];

/**
 * Read all source files eligible for scanning
 */
async function collectSourceFiles(projectRoot: string): Promise<string[]> {
  return glob('**/*.{ts,tsx,js,jsx}', {
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
}

/**
 * For a given field (camelCase name + optional snake_case columnName),
 * scan all source files and return categorized usage.
 */
function scanFieldInFiles(
  fieldName: string,
  columnName: string | undefined,
  files: Map<string, string>  // filename -> content
): { readFiles: string[]; writeFiles: string[]; allFiles: string[] } {
  const readFiles: string[] = [];
  const writeFiles: string[] = [];
  const allFilesSet = new Set<string>();

  // Build search terms: camelCase name + snake_case @map name (if different)
  const searchTerms = new Set<string>([fieldName]);
  if (columnName && columnName !== fieldName) {
    searchTerms.add(columnName);
  }

  for (const [filePath, content] of files) {
    let foundInFile = false;
    let isRead = false;
    let isWrite = false;

    for (const term of searchTerms) {
      // Simple word-boundary check: look for the field name as a property access,
      // object key, or standalone identifier — not as a substring of longer words
      const fieldRegex = new RegExp(
        `(?:^|[^a-zA-Z0-9_])${escapeRegex(term)}(?:[^a-zA-Z0-9_]|$)`,
        'gm'
      );

      if (!fieldRegex.test(content)) continue;
      foundInFile = true;

      // Now check the context around occurrences
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Quick test: does this line contain the term?
        if (!line.includes(term)) continue;

        // Check surrounding context (3 lines before + 3 lines after)
        const contextStart = Math.max(0, i - 3);
        const contextEnd = Math.min(lines.length - 1, i + 3);
        const context = lines.slice(contextStart, contextEnd + 1).join('\n');

        for (const pattern of READ_PATTERNS) {
          if (pattern.test(context)) {
            isRead = true;
            break;
          }
        }
        for (const pattern of WRITE_PATTERNS) {
          if (pattern.test(context)) {
            isWrite = true;
            break;
          }
        }
      }
    }

    if (foundInFile) {
      const relPath = filePath; // keep as-is; caller normalizes
      allFilesSet.add(relPath);
      if (isRead) readFiles.push(relPath);
      if (isWrite) writeFiles.push(relPath);
    }
  }

  return {
    readFiles,
    writeFiles,
    allFiles: Array.from(allFilesSet),
  };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Classify field usage from read/write file sets
 */
function classifyUsage(
  allFiles: string[],
  readFiles: string[],
  writeFiles: string[]
): FieldUsageStatus {
  if (allFiles.length === 0) return 'unused';
  if (readFiles.length > 0 && writeFiles.length > 0) return 'used';
  if (readFiles.length > 0 && writeFiles.length === 0) return 'read-only';
  if (writeFiles.length > 0 && readFiles.length === 0) return 'write-only';
  // Found in files but no clear read/write context — treat as 'used'
  return 'used';
}

// =============================================================================
// MAIN SCANNER
// =============================================================================

/**
 * Scan field usage across the codebase for all Prisma models
 */
export async function scanFieldUsage(projectRoot: string): Promise<ScanResult & { report?: FieldUsageReport }> {
  const components: ArchitectureComponent[] = [];
  const connections: ArchitectureConnection[] = [];
  const warnings: ScanWarning[] = [];
  const timestamp = Date.now();

  // Locate Prisma schema
  const schemaCandidates = [
    path.join(projectRoot, 'prisma/schema.prisma'),
    path.join(projectRoot, 'schema.prisma'),
  ];

  let schemaContent: string | null = null;
  let schemaFile: string | null = null;

  for (const candidate of schemaCandidates) {
    if (fs.existsSync(candidate)) {
      try {
        schemaContent = await fs.promises.readFile(candidate, 'utf-8');
        schemaFile = path.relative(projectRoot, candidate);
        break;
      } catch {
        // continue
      }
    }
  }

  // Also check directory-based schema (Prisma 5.15+)
  if (!schemaContent) {
    const schemaDir = path.join(projectRoot, 'prisma/schema');
    if (fs.existsSync(schemaDir) && fs.statSync(schemaDir).isDirectory()) {
      const parts: string[] = [];
      try {
        const files = fs.readdirSync(schemaDir);
        for (const f of files) {
          if (f.endsWith('.prisma')) {
            const content = await fs.promises.readFile(path.join(schemaDir, f), 'utf-8');
            parts.push(content);
          }
        }
        if (parts.length > 0) {
          schemaContent = parts.join('\n');
          schemaFile = 'prisma/schema/';
        }
      } catch {
        // ignore
      }
    }
  }

  if (!schemaContent) {
    // No Prisma schema found — return empty results (not an error)
    return { components, connections, warnings };
  }

  const models = extractModelsFromSchema(schemaContent);
  if (models.length === 0) {
    return { components, connections, warnings };
  }

  // Collect source files
  let sourceFilePaths: string[];
  try {
    sourceFilePaths = await collectSourceFiles(projectRoot);
  } catch (error) {
    warnings.push({
      type: 'parse_error',
      message: `Field usage analyzer: failed to collect source files: ${error instanceof Error ? error.message : 'Unknown'}`,
    });
    return { components, connections, warnings };
  }

  // Load all source file contents into memory (cache for repeated field lookups)
  const fileContents = new Map<string, string>();
  for (const filePath of sourceFilePaths) {
    try {
      const content = await fs.promises.readFile(filePath, 'utf-8');
      fileContents.set(filePath, content);
    } catch {
      // Skip unreadable files
    }
  }

  console.log(`  Field usage: scanning ${models.length} models across ${fileContents.size} source files...`);

  // Build report
  const reportModels: ModelFieldUsage[] = [];
  let totalFields = 0;
  let totalUsed = 0;
  let totalUnused = 0;
  let totalWriteOnly = 0;
  let totalReadOnly = 0;

  for (const model of models) {
    // Skip relation-only models (no scalar fields)
    const scalarFields = model.fields.filter(f => !f.isRelation);
    if (scalarFields.length === 0) continue;

    const fieldRecords: FieldUsageRecord[] = [];

    for (const field of model.fields) {
      // Relation fields that are implicit (no column) are less interesting for usage
      // but we still track them
      const { readFiles, writeFiles, allFiles } = scanFieldInFiles(
        field.name,
        field.columnName,
        fileContents
      );

      const status = classifyUsage(allFiles, readFiles, writeFiles);

      fieldRecords.push({
        fieldName: field.name,
        columnName: field.columnName,
        modelName: model.name,
        prismaType: field.type,
        isRelation: field.isRelation,
        status,
        readFiles: readFiles.map(f => path.relative(projectRoot, f)),
        writeFiles: writeFiles.map(f => path.relative(projectRoot, f)),
        allFiles: allFiles.map(f => path.relative(projectRoot, f)),
      });

      totalFields++;
      if (status === 'used') totalUsed++;
      else if (status === 'unused') totalUnused++;
      else if (status === 'write-only') totalWriteOnly++;
      else if (status === 'read-only') totalReadOnly++;
    }

    const modelUsage: ModelFieldUsage = {
      modelName: model.name,
      totalFields: fieldRecords.length,
      usedFields: fieldRecords.filter(f => f.status === 'used').length,
      unusedFields: fieldRecords.filter(f => f.status === 'unused').length,
      writeOnlyFields: fieldRecords.filter(f => f.status === 'write-only').length,
      readOnlyFields: fieldRecords.filter(f => f.status === 'read-only').length,
      fields: fieldRecords,
    };
    reportModels.push(modelUsage);

    // Create a component for field usage metadata (attached to the model)
    const componentId = generateComponentId('database', `field-usage-${model.name}`);
    const unusedCount = fieldRecords.filter(f => f.status === 'unused' && !f.isRelation).length;

    const component: ArchitectureComponent = {
      component_id: componentId,
      name: `${model.name}.field-usage`,
      type: 'database',
      role: {
        purpose: `Field usage analysis for ${model.name}: ${fieldRecords.filter(f => f.status === 'used').length}/${fieldRecords.length} fields used`,
        layer: 'database',
        critical: unusedCount > 0,
      },
      source: {
        detection_method: 'auto',
        config_files: [schemaFile || 'prisma/schema.prisma'],
        confidence: 0.75,
      },
      connects_to: [],
      connected_from: [],
      status: unusedCount > 0 ? 'active' : 'active',
      tags: ['prisma', 'field-usage', 'database', model.name.toLowerCase()],
      metadata: {
        modelName: model.name,
        fieldUsage: modelUsage,
        unusedFieldCount: unusedCount,
        unusedFields: fieldRecords
          .filter(f => f.status === 'unused' && !f.isRelation)
          .map(f => f.fieldName),
      },
      timestamp,
      last_updated: timestamp,
    };
    components.push(component);

    // Emit connections: model component → each file that references its fields
    // (field-usage type connections)
    const allReferencingFiles = new Set<string>();
    for (const fr of fieldRecords) {
      for (const f of fr.allFiles) allReferencingFiles.add(f);
    }

    for (const relFile of allReferencingFiles) {
      const connId = generateConnectionId('other');
      connections.push({
        connection_id: connId,
        from: {
          component_id: componentId,
          location: { file: schemaFile || 'prisma/schema.prisma', line: 0 },
        },
        to: {
          component_id: componentId, // self-ref; file components not always available
          location: { file: relFile, line: 0 },
        },
        connection_type: 'other',
        code_reference: {
          file: relFile,
          symbol: `${model.name}-fields`,
          symbol_type: 'variable',
        },
        description: `${model.name} fields referenced in ${relFile}`,
        detected_from: 'field-usage-analyzer',
        confidence: 0.75,
        timestamp,
        last_verified: timestamp,
      });
    }
  }

  const report: FieldUsageReport = {
    scannedModels: reportModels.length,
    scannedFiles: fileContents.size,
    totalFields,
    usedFields: totalUsed,
    unusedFields: totalUnused,
    writeOnlyFields: totalWriteOnly,
    readOnlyFields: totalReadOnly,
    models: reportModels,
  };

  // Attach the aggregate report to a top-level summary component
  const summaryId = generateComponentId('database', 'field-usage-summary');
  components.push({
    component_id: summaryId,
    name: 'DB Field Usage',
    type: 'database',
    role: {
      purpose: `Field usage summary: ${totalFields} fields, ${totalUnused} unused across ${reportModels.length} models`,
      layer: 'database',
      critical: totalUnused > 0,
    },
    source: {
      detection_method: 'auto',
      config_files: [schemaFile || 'prisma/schema.prisma'],
      confidence: 0.75,
    },
    connects_to: [],
    connected_from: [],
    status: 'active',
    tags: ['prisma', 'field-usage', 'database', 'summary'],
    metadata: {
      report,
    },
    timestamp,
    last_updated: timestamp,
  });

  return { components, connections, warnings, report } as ScanResult & { report: FieldUsageReport };
}

/**
 * Detect if field usage analysis is possible (requires Prisma schema)
 */
export function canAnalyzeFieldUsage(projectRoot: string): boolean {
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
 * Format field usage report for CLI output
 */
export function formatFieldUsageReport(report: FieldUsageReport): string {
  const lines: string[] = [];
  lines.push('DB Field Usage Report');
  lines.push('');
  lines.push(`Models scanned:  ${report.scannedModels}`);
  lines.push(`Source files:    ${report.scannedFiles}`);
  lines.push(`Total fields:    ${report.totalFields}`);
  lines.push(`  Used:          ${report.usedFields}`);
  lines.push(`  Read-only:     ${report.readOnlyFields}`);
  lines.push(`  Write-only:    ${report.writeOnlyFields}`);
  lines.push(`  Unused:        ${report.unusedFields}`);
  lines.push('');

  if (report.unusedFields === 0) {
    lines.push('No unused fields detected.');
    return lines.join('\n');
  }

  lines.push('UNUSED FIELDS BY MODEL:');
  for (const model of report.models) {
    const unused = model.fields.filter(f => f.status === 'unused' && !f.isRelation);
    if (unused.length === 0) continue;
    lines.push(`  ${model.modelName} (${unused.length} unused):`);
    for (const f of unused.slice(0, 20)) {
      lines.push(`    - ${f.fieldName}: ${f.prismaType}${f.columnName ? ` (@map: ${f.columnName})` : ''}`);
    }
    if (unused.length > 20) {
      lines.push(`    ... and ${unused.length - 20} more`);
    }
  }

  lines.push('');
  lines.push('WRITE-ONLY FIELDS (never read):');
  let writeOnlyShown = false;
  for (const model of report.models) {
    const writeOnly = model.fields.filter(f => f.status === 'write-only' && !f.isRelation);
    if (writeOnly.length === 0) continue;
    writeOnlyShown = true;
    lines.push(`  ${model.modelName}:`);
    for (const f of writeOnly.slice(0, 10)) {
      lines.push(`    - ${f.fieldName}: ${f.prismaType}`);
    }
  }
  if (!writeOnlyShown) {
    lines.push('  None detected.');
  }

  return lines.join('\n');
}
