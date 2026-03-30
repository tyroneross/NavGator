/**
 * Prisma Schema Scanner
 * Parses prisma/schema.prisma to extract database models, relations, and indexes
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  ArchitectureComponent,
  ArchitectureConnection,
  RuntimeIdentity,
  ScanResult,
  ScanWarning,
  generateComponentId,
  generateConnectionId,
} from '../../types.js';
import { parsePrismaModels } from './prisma-parser.js';

// =============================================================================
// PRISMA MODEL PARSING
// =============================================================================

interface PrismaField {
  name: string;
  type: string;
  columnName?: string;     // @map("column_name")
  isRelation: boolean;
  relationTarget?: string; // The model it relates to
  relationFields?: string[];
  references?: string[];
  isOptional: boolean;
  isArray: boolean;
  isId: boolean;
  isUnique: boolean;
  defaultValue?: string;
}

interface PrismaModel {
  name: string;
  tableName?: string;      // @@map("table_name")
  fields: PrismaField[];
  indexes: string[];       // @@index fields
  uniqueConstraints: string[][]; // @@unique field groups
}

/**
 * Find Prisma schema files in the project
 */
function findPrismaSchemas(projectRoot: string): string[] {
  const candidates = [
    'prisma/schema.prisma',
    'schema.prisma',
    'prisma/schema',  // directory-based schemas (Prisma 5.15+)
  ];

  const found: string[] = [];
  for (const candidate of candidates) {
    const fullPath = path.join(projectRoot, candidate);
    if (fs.existsSync(fullPath)) {
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        // Multi-file schema: scan all .prisma files in directory
        try {
          const files = fs.readdirSync(fullPath);
          for (const f of files) {
            if (f.endsWith('.prisma')) {
              found.push(path.join(candidate, f));
            }
          }
        } catch {
          // Skip unreadable directories
        }
      } else {
        found.push(candidate);
      }
    }
  }
  return found;
}

/**
 * Parse a Prisma schema file into model definitions
 */
function parsePrismaSchema(content: string): PrismaModel[] {
  const models: PrismaModel[] = [];

  for (const { name: modelName, body } of parsePrismaModels(content)) {

    const fields: PrismaField[] = [];
    let tableName: string | undefined;
    const indexes: string[] = [];
    const uniqueConstraints: string[][] = [];

    const lines = body.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('//')) continue;

      // @@map("table_name")
      const mapMatch = trimmed.match(/@@map\(\s*"([^"]+)"\s*\)/);
      if (mapMatch) {
        tableName = mapMatch[1];
        continue;
      }

      // @@index([field1, field2])
      const indexMatch = trimmed.match(/@@index\(\s*\[([^\]]+)\]/);
      if (indexMatch) {
        indexes.push(indexMatch[1].trim());
        continue;
      }

      // @@unique([field1, field2])
      const uniqueMatch = trimmed.match(/@@unique\(\s*\[([^\]]+)\]/);
      if (uniqueMatch) {
        const fields = uniqueMatch[1].split(',').map(f => f.trim());
        uniqueConstraints.push(fields);
        continue;
      }

      // @@id - composite primary key
      if (trimmed.startsWith('@@id') || trimmed.startsWith('@@')) continue;

      // Field definition: name Type modifiers @attributes
      const fieldMatch = trimmed.match(/^(\w+)\s+(\w+)(\[\])?\??/);
      if (!fieldMatch) continue;

      const fieldName = fieldMatch[1];
      const fieldType = fieldMatch[2];
      const isArray = !!fieldMatch[3];
      const isOptional = trimmed.includes('?');

      const field: PrismaField = {
        name: fieldName,
        type: fieldType,
        isRelation: false,
        isOptional,
        isArray,
        isId: trimmed.includes('@id'),
        isUnique: trimmed.includes('@unique'),
      };

      // @map("column_name")
      const colMapMatch = trimmed.match(/@map\(\s*"([^"]+)"\s*\)/);
      if (colMapMatch) {
        field.columnName = colMapMatch[1];
      }

      // @default(value)
      const defaultMatch = trimmed.match(/@default\(([^)]+)\)/);
      if (defaultMatch) {
        field.defaultValue = defaultMatch[1];
      }

      // @relation - indicates this field is a relation to another model
      const relationMatch = trimmed.match(/@relation\(([^)]*)\)/);
      if (relationMatch) {
        field.isRelation = true;
        field.relationTarget = fieldType;

        const fieldsMatch = relationMatch[1].match(/fields:\s*\[([^\]]+)\]/);
        if (fieldsMatch) {
          field.relationFields = fieldsMatch[1].split(',').map(f => f.trim());
        }

        const refsMatch = relationMatch[1].match(/references:\s*\[([^\]]+)\]/);
        if (refsMatch) {
          field.references = refsMatch[1].split(',').map(f => f.trim());
        }
      } else if (
        // Implicit relation: field type matches another model name (uppercase start, not a scalar)
        fieldType[0] === fieldType[0].toUpperCase() &&
        !['String', 'Int', 'Float', 'Boolean', 'DateTime', 'Json', 'Bytes', 'BigInt', 'Decimal'].includes(fieldType)
      ) {
        field.isRelation = true;
        field.relationTarget = fieldType;
      }

      fields.push(field);
    }

    models.push({
      name: modelName,
      tableName,
      fields,
      indexes,
      uniqueConstraints,
    });
  }

  return models;
}

// =============================================================================
// DATASOURCE PARSING
// =============================================================================

const PROVIDER_ENGINE_MAP: Record<string, string> = {
  postgresql: 'postgres',
  mysql: 'mysql',
  sqlite: 'sqlite',
  mongodb: 'mongodb',
  cockroachdb: 'cockroachdb',
};

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
export function parseDatasource(content: string): DatasourceInfo | null {
  const blockMatch = content.match(/datasource\s+\w+\s*\{([^}]*)\}/s);
  if (!blockMatch) return null;

  const block = blockMatch[1];

  // Extract provider value
  const providerMatch = block.match(/provider\s*=\s*"([^"]+)"/);
  if (!providerMatch) return null;

  const providerRaw = providerMatch[1].toLowerCase();
  const engine = PROVIDER_ENGINE_MAP[providerRaw] ?? providerRaw;

  // Extract env var from url = env("VAR_NAME") or directUrl = env("VAR_NAME")
  // Prefer url over directUrl
  const urlMatch = block.match(/\burl\s*=\s*env\(\s*"([^"]+)"\s*\)/);
  const connection_env_var = urlMatch ? urlMatch[1] : undefined;

  return { engine, connection_env_var };
}

// =============================================================================
// SCANNER
// =============================================================================

/**
 * Scan for Prisma schema and extract database models
 */
export async function scanPrismaSchema(projectRoot: string): Promise<ScanResult> {
  const components: ArchitectureComponent[] = [];
  const connections: ArchitectureConnection[] = [];
  const warnings: ScanWarning[] = [];
  const timestamp = Date.now();

  const schemaFiles = findPrismaSchemas(projectRoot);
  if (schemaFiles.length === 0) {
    return { components, connections, warnings };
  }

  // Parse all schema files
  const allModels: PrismaModel[] = [];
  // Track datasource info per schema file (used to populate runtime identity on components)
  const datasourceByFile = new Map<string, DatasourceInfo>();

  for (const schemaFile of schemaFiles) {
    try {
      const content = await fs.promises.readFile(
        path.join(projectRoot, schemaFile),
        'utf-8'
      );
      const models = parsePrismaSchema(content);
      for (const model of models) {
        (model as PrismaModel & { _sourceFile: string })._sourceFile = schemaFile;
      }
      allModels.push(...models);

      // Extract datasource provider/env var for this file
      const dsInfo = parseDatasource(content);
      if (dsInfo) {
        datasourceByFile.set(schemaFile, dsInfo);
      }
    } catch (error) {
      warnings.push({
        type: 'parse_error',
        message: `Failed to parse Prisma schema ${schemaFile}: ${error instanceof Error ? error.message : 'Unknown error'}`,
        file: schemaFile,
      });
    }
  }

  if (allModels.length === 0) {
    return { components, connections, warnings };
  }

  // Create a component for each model
  const modelComponentMap = new Map<string, string>(); // modelName -> component_id

  for (const model of allModels) {
    const sourceFile = (model as PrismaModel & { _sourceFile?: string })._sourceFile || schemaFiles[0];
    const componentId = generateComponentId('database', model.name);
    modelComponentMap.set(model.name, componentId);

    const relationCount = model.fields.filter(f => f.isRelation).length;
    const fieldCount = model.fields.filter(f => !f.isRelation).length;

    // Build runtime identity from datasource block (if available for this file)
    const dsInfo = datasourceByFile.get(sourceFile);
    const runtime: RuntimeIdentity | undefined = dsInfo
      ? {
          resource_type: 'database',
          engine: dsInfo.engine,
          ...(dsInfo.connection_env_var !== undefined
            ? { connection_env_var: dsInfo.connection_env_var }
            : {}),
        }
      : undefined;

    const component: ArchitectureComponent = {
      component_id: componentId,
      name: model.name,
      type: 'database',
      role: {
        purpose: `Prisma model${model.tableName ? ` (table: ${model.tableName})` : ''} — ${fieldCount} fields, ${relationCount} relations`,
        layer: 'database',
        critical: true,
      },
      source: {
        detection_method: 'auto',
        config_files: [sourceFile],
        confidence: 1.0,
      },
      connects_to: [],
      connected_from: [],
      status: 'active',
      tags: ['prisma', 'database', 'model'],
      metadata: {
        tableName: model.tableName || model.name,
        fieldCount,
        relationCount,
        indexes: model.indexes,
        uniqueConstraints: model.uniqueConstraints,
        fields: model.fields.map(f => ({
          name: f.name,
          type: f.type,
          columnName: f.columnName,
          isRelation: f.isRelation,
          isOptional: f.isOptional,
          isId: f.isId,
          isUnique: f.isUnique,
        })),
      },
      runtime,
      timestamp,
      last_updated: timestamp,
    };

    components.push(component);
  }

  // Create connections for relations between models
  for (const model of allModels) {
    const sourceFile = (model as PrismaModel & { _sourceFile?: string })._sourceFile || schemaFiles[0];
    const fromId = modelComponentMap.get(model.name);
    if (!fromId) continue;

    for (const field of model.fields) {
      if (!field.isRelation || !field.relationTarget) continue;

      const toId = modelComponentMap.get(field.relationTarget);
      if (!toId) continue;

      // Only create connection for the side that has @relation(fields: [...])
      // or for implicit relations (no explicit @relation on either side)
      if (field.relationFields || !field.isArray) {
        const connectionId = generateConnectionId('schema-relation');
        connections.push({
          connection_id: connectionId,
          from: {
            component_id: fromId,
            location: { file: sourceFile, line: 0 },
          },
          to: {
            component_id: toId,
          },
          connection_type: 'schema-relation',
          code_reference: {
            file: sourceFile,
            symbol: `${model.name}.${field.name}`,
            symbol_type: 'variable',
          },
          description: `${model.name}.${field.name} -> ${field.relationTarget}`,
          detected_from: 'prisma-scanner',
          confidence: 1.0,
          timestamp,
          last_verified: timestamp,
        });
      }
    }
  }

  return { components, connections, warnings };
}

/**
 * Detect if project uses Prisma
 */
export function detectPrisma(projectRoot: string): boolean {
  return findPrismaSchemas(projectRoot).length > 0;
}
