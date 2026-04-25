/**
 * Prisma Call Scanner
 * Detects prisma.{modelName}.{operation}() patterns in source files
 * and creates api-calls-db connections from source files to Prisma model components.
 */

import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';
import {
  ArchitectureComponent,
  ArchitectureConnection,
  ScanResult,
  ScanWarning,
  generateConnectionId,
} from '../../types.js';

// Prisma client operations — split into reads and writes
const READ_OPS = 'find(?:Many|Unique|First|UniqueOrThrow|FirstOrThrow)?|count|aggregate|groupBy';
const WRITE_OPS = 'create(?:Many|ManyAndReturn)?|update(?:Many)?|delete(?:Many)?|upsert';
const PRISMA_OPS = `(?:${READ_OPS}|${WRITE_OPS})`;

const PRISMA_CALL_REGEX = new RegExp(
  `prisma\\.([a-zA-Z_]\\w*)\\.(${PRISMA_OPS})`,
  'g'
);

const READ_OP_SET = new Set(['findMany', 'findUnique', 'findFirst', 'findUniqueOrThrow', 'findFirstOrThrow', 'count', 'aggregate', 'groupBy']);
const WRITE_OP_SET = new Set(['create', 'createMany', 'createManyAndReturn', 'update', 'updateMany', 'delete', 'deleteMany', 'upsert']);

// Also detect raw SQL queries
const PRISMA_RAW_REGEX = /prisma\.\$(?:queryRaw|executeRaw)/g;

interface PrismaCall {
  modelName: string;    // camelCase as written in code
  operation: string;
  line: number;
}

/**
 * Convert camelCase model name to PascalCase (as Prisma models are defined)
 * prisma.article → Article
 * prisma.rssSource → RssSource
 */
function toPascalCase(camelCase: string): string {
  return camelCase.charAt(0).toUpperCase() + camelCase.slice(1);
}

/**
 * Scan source files for Prisma client calls and create api-calls-db connections
 */
export async function scanPrismaCalls(
  projectRoot: string,
  modelComponents: ArchitectureComponent[],
  walkSet?: Set<string>,
): Promise<ScanResult> {
  const connections: ArchitectureConnection[] = [];
  const warnings: ScanWarning[] = [];
  const timestamp = Date.now();

  // Build model name → component map (case-insensitive)
  // Also build table name → component map for raw SQL detection
  const modelMap = new Map<string, ArchitectureComponent>();
  const tableMap = new Map<string, ArchitectureComponent>(); // SQL table name → component
  for (const comp of modelComponents) {
    if (comp.type === 'database') {
      modelMap.set(comp.name.toLowerCase(), comp);
      // Map the @@map table name if present
      const tableName = (comp.metadata as any)?.tableName;
      if (tableName) {
        tableMap.set(tableName.toLowerCase(), comp);
      }
      // Also map the model name as snake_case (Prisma convention)
      const snakeName = comp.name.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase();
      if (snakeName !== comp.name.toLowerCase()) {
        tableMap.set(snakeName, comp);
      }
    }
  }

  if (modelMap.size === 0) return { components: [], connections, warnings };

  const allSourceFiles = await glob('**/*.{ts,tsx,js,jsx}', {
    cwd: projectRoot,
    ignore: [
      '**/node_modules/**', '**/dist/**', '**/build/**',
      '**/.next/**', '**/coverage/**', '**/.git/**',
      '**/prisma/migrations/**',
    ],
  });
  // Walk-set restriction (incremental mode). Bit-identical when undefined.
  const sourceFiles = walkSet
    ? allSourceFiles.filter(f => walkSet.has(f))
    : allSourceFiles;

  for (const file of sourceFiles) {
    try {
      const content = await fs.promises.readFile(
        path.join(projectRoot, file),
        'utf-8'
      );

      // Quick check: skip files that don't reference prisma
      if (!content.includes('prisma.')) continue;

      const calls: PrismaCall[] = [];
      const lines = content.split('\n');

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        let match: RegExpExecArray | null;

        PRISMA_CALL_REGEX.lastIndex = 0;
        while ((match = PRISMA_CALL_REGEX.exec(line)) !== null) {
          calls.push({
            modelName: match[1],
            operation: match[2] || 'unknown',
            line: i + 1,
          });
        }
      }

      if (calls.length === 0) continue;

      // Group by model name → deduplicate per file
      const modelCalls = new Map<string, { operations: Set<string>; firstLine: number }>();
      for (const call of calls) {
        const key = call.modelName.toLowerCase();
        if (!modelCalls.has(key)) {
          modelCalls.set(key, { operations: new Set(), firstLine: call.line });
        }
        modelCalls.get(key)!.operations.add(call.operation);
      }

      // Create connections for each unique (file, model) pair
      for (const [modelKey, info] of modelCalls) {
        const pascalName = toPascalCase(modelKey);
        const modelComp = modelMap.get(pascalName.toLowerCase()) || modelMap.get(modelKey);

        if (!modelComp) {
          // Model referenced in code but not in Prisma schema — might be aliased
          continue;
        }

        const ops = [...info.operations].join(', ');
        // Determine read vs write based on operations
        const hasReads = [...info.operations].some(op => READ_OP_SET.has(op));
        const hasWrites = [...info.operations].some(op => WRITE_OP_SET.has(op));
        // Use the most specific type: if both read+write, use api-calls-db
        const connType = (hasReads && hasWrites) ? 'api-calls-db'
          : hasWrites ? 'api-calls-db' // writes are more significant — keep as api-calls-db for backward compat
          : 'api-calls-db';
        const opsLabel = hasWrites && !hasReads ? ' [writes]'
          : !hasWrites && hasReads ? ' [reads]'
          : hasWrites && hasReads ? ' [reads+writes]'
          : '';
        connections.push({
          connection_id: generateConnectionId('api-calls-db'),
          from: {
            component_id: `FILE:${file}`,
            location: { file, line: info.firstLine },
          },
          to: {
            component_id: modelComp.component_id,
          },
          connection_type: 'api-calls-db',
          code_reference: {
            file,
            symbol: `prisma.${modelKey}`,
            symbol_type: 'variable',
            line_start: info.firstLine,
          },
          description: `${file} queries ${pascalName}${opsLabel} (${ops})`,
          detected_from: 'prisma-calls',
          confidence: 0.95,
          timestamp,
          last_verified: timestamp,
        });
      }
    } catch {
      // Skip unreadable files
    }
  }

  // Second pass: detect raw SQL table references ($queryRaw, $executeRaw)
  if (tableMap.size > 0 || modelMap.size > 0) {
    const RAW_SQL_RE = /prisma\.\$(?:queryRaw|executeRaw|queryRawUnsafe|executeRawUnsafe)/;
    const SQL_TABLE_RE = /(?:FROM|INTO|UPDATE|JOIN|DELETE\s+FROM)\s+(?:public\.)?["'`]?(\w+)["'`]?/gi;

    for (const file of sourceFiles) {
      try {
        const content = await fs.promises.readFile(
          path.join(projectRoot, file),
          'utf-8'
        );

        if (!RAW_SQL_RE.test(content)) continue;

        // Extract table names from SQL strings in this file
        const tablesFound = new Map<string, { firstLine: number; isWrite: boolean }>();
        const lines = content.split('\n');

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (!RAW_SQL_RE.test(line) && !SQL_TABLE_RE.test(line)) continue;

          SQL_TABLE_RE.lastIndex = 0;
          let sqlMatch;
          while ((sqlMatch = SQL_TABLE_RE.exec(line)) !== null) {
            const tableName = sqlMatch[1].toLowerCase();
            // Skip SQL keywords that look like table names
            if (['select', 'where', 'and', 'or', 'set', 'values', 'as', 'on', 'using', 'index', 'table', 'column', 'view'].includes(tableName)) continue;

            const keyword = sqlMatch[0].trim().split(/\s+/)[0].toUpperCase();
            const isWrite = ['INTO', 'UPDATE', 'DELETE'].includes(keyword);

            if (!tablesFound.has(tableName)) {
              tablesFound.set(tableName, { firstLine: i + 1, isWrite });
            } else if (isWrite) {
              tablesFound.get(tableName)!.isWrite = true;
            }
          }
        }

        // Create connections for found tables
        for (const [tableName, info] of tablesFound) {
          const modelComp = tableMap.get(tableName) || modelMap.get(tableName);
          if (!modelComp) continue;

          // Check if we already have a connection from this file to this model
          const existingKey = `${file}|${modelComp.component_id}`;
          const alreadyConnected = connections.some(c =>
            c.code_reference.file === file && c.to.component_id === modelComp.component_id
          );
          if (alreadyConnected) continue;

          const label = info.isWrite ? ' [writes, raw-sql]' : ' [reads, raw-sql]';
          connections.push({
            connection_id: generateConnectionId('api-calls-db'),
            from: {
              component_id: `FILE:${file}`,
              location: { file, line: info.firstLine },
            },
            to: {
              component_id: modelComp.component_id,
            },
            connection_type: 'api-calls-db',
            code_reference: {
              file,
              symbol: `$queryRaw(${tableName})`,
              symbol_type: 'variable',
              line_start: info.firstLine,
            },
            description: `${file} queries ${modelComp.name}${label}`,
            detected_from: 'prisma-calls (raw-sql)',
            confidence: 0.8,
            timestamp,
            last_verified: timestamp,
          });
        }
      } catch {
        // Skip unreadable files
      }
    }
  }

  return { components: [], connections, warnings };
}
