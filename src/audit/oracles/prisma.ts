/**
 * prisma oracle — truth frame: models declared in the Prisma schema.
 *
 * Strength:
 *   'independent' when `@prisma/internals` getDMMF resolves from the TARGET
 *   repo's node_modules (the compiler's own parse of the schema) — only with
 *   an explicit opt-in (`--trust-target-deps` / NAVGATOR_TRUST_TARGET_DEPS=1)
 *   because that is code execution from the audited repo;
 *   'weak' when we fall back to an independent regex (`^\s*model\s+(\w+)` plus
 *   `@@map("…")`), which is a re-derivation, not a second source.
 *
 * Map side: every `database` component. Prisma-model components (primary
 * config file ends in .prisma) are matched by model name or @@map table name.
 * Known client libraries typed `database` (Run 4 finding: @prisma/client,
 * ioredis, pg, redis, prisma, Supabase) are counted as false positives with
 * note `client-library-misclassified`; any other non-schema `database`
 * component is a false positive with note `not-a-schema-model`.
 */

import * as fs from 'fs';
import * as path from 'path';
import { createRequire } from 'module';
import { pathToFileURL } from 'url';
import { isRootPackageDerived, noOracle, setDiffOracle, type OracleInput, type OracleResult } from './common.js';

/** Client libraries / hosted DB services the npm and service scanners type as `database`. */
export const DATABASE_CLIENT_LIBRARIES = new Set(
  [
    '@prisma/client',
    'prisma',
    'ioredis',
    'redis',
    'pg',
    'mysql2',
    'mongoose',
    'drizzle-orm',
    '@supabase/supabase-js',
    'supabase',
    'postgresql',
    'postgres',
    'mongodb',
    'sqlite',
    'better-sqlite3',
    'knex',
    'typeorm',
    'sequelize',
  ].map((s) => s.toLowerCase())
);

const DMMF_TIMEOUT_MS = 15_000;

export interface PrismaTruth {
  models: Array<{ name: string; dbName?: string }>;
  strength: 'independent' | 'weak';
  files: string[];
  note?: string;
}

function findSchemaFiles(root: string): string[] {
  const out: string[] = [];
  for (const rel of ['prisma/schema.prisma', 'schema.prisma']) {
    const abs = path.join(root, rel);
    if (fs.existsSync(abs)) out.push(abs);
  }
  // Prisma multi-file schemas: prisma/schema/*.prisma
  const multi = path.join(root, 'prisma', 'schema');
  try {
    for (const f of fs.readdirSync(multi)) if (f.endsWith('.prisma')) out.push(path.join(multi, f));
  } catch {
    /* no multi-file dir */
  }
  return out;
}

/** Independent regex parse: `model Name {` … `@@map("table")` inside the block. */
export function regexModels(datamodel: string): Array<{ name: string; dbName?: string }> {
  const models: Array<{ name: string; dbName?: string }> = [];
  const re = /^\s*model\s+(\w+)\s*\{([\s\S]*?)^\s*\}/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(datamodel)) !== null) {
    const body = m[2] ?? '';
    const map = /@@map\(\s*"([^"]+)"\s*\)/.exec(body);
    models.push({ name: m[1]!, ...(map ? { dbName: map[1]! } : {}) });
  }
  return models;
}

async function dmmfModels(root: string, datamodel: string): Promise<Array<{ name: string; dbName?: string }> | null> {
  let resolved: string;
  try {
    const req = createRequire(path.join(root, 'package.json'));
    resolved = req.resolve('@prisma/internals');
  } catch {
    return null;
  }
  const mod = (await import(pathToFileURL(resolved).href)) as {
    getDMMF?: (o: { datamodel: string }) => Promise<{ datamodel: { models: Array<{ name: string; dbName?: string | null }> } }>;
    default?: { getDMMF?: (o: { datamodel: string }) => Promise<{ datamodel: { models: Array<{ name: string; dbName?: string | null }> } }> };
  };
  const getDMMF = mod.getDMMF ?? mod.default?.getDMMF;
  if (!getDMMF) return null;
  const timeout = new Promise<never>((_, rej) => setTimeout(() => rej(new Error('getDMMF timeout')), DMMF_TIMEOUT_MS).unref?.());
  const dmmf = await Promise.race([getDMMF({ datamodel }), timeout]);
  return dmmf.datamodel.models.map((m) => ({ name: m.name, ...(m.dbName ? { dbName: m.dbName } : {}) }));
}

export async function loadPrismaTruth(root: string, opts: { trustTargetDeps?: boolean } = {}): Promise<PrismaTruth | null> {
  const files = findSchemaFiles(root);
  if (files.length === 0) return null;
  const datamodel = files.map((f) => fs.readFileSync(f, 'utf-8')).join('\n');
  // Finding (b): importing @prisma/internals from the TARGET repo executes
  // code from the audited repo (relevant for scan-remote). Off unless the
  // caller opted in (--trust-target-deps / NAVGATOR_TRUST_TARGET_DEPS=1).
  if (!opts.trustTargetDeps) {
    return {
      models: regexModels(datamodel),
      strength: 'weak',
      files,
      note: 'regex oracle; pass --trust-target-deps (or NAVGATOR_TRUST_TARGET_DEPS=1) to parse with @prisma/internals from the target repo',
    };
  }
  try {
    const viaDmmf = await dmmfModels(root, datamodel);
    if (viaDmmf) return { models: viaDmmf, strength: 'independent', files };
  } catch (err) {
    return {
      models: regexModels(datamodel),
      strength: 'weak',
      files,
      note: `@prisma/internals getDMMF failed (${(err as Error).message}); regex fallback`,
    };
  }
  return { models: regexModels(datamodel), strength: 'weak', files, note: '@prisma/internals not resolvable from target node_modules; regex fallback' };
}

export async function prismaOracle(input: OracleInput, opts: { trustTargetDeps?: boolean } = {}): Promise<OracleResult> {
  const truthInfo = await loadPrismaTruth(input.projectRoot, opts);
  if (!truthInfo) return noOracle('prisma', 'infra', 'no prisma schema found (prisma/schema.prisma, schema.prisma, prisma/schema/*.prisma)');

  const truth = new Set(truthInfo.models.map((m) => m.name));
  const tableToModel = new Map<string, string>();
  for (const m of truthInfo.models) if (m.dbName) tableToModel.set(m.dbName, m.name);

  const map = new Set<string>();
  const clientLibs: string[] = [];
  const notModels: string[] = [];
  for (const c of input.components) {
    if (c.type !== 'database') continue;
    const primary = c.source?.config_files?.[0] ?? '';
    if (primary.endsWith('.prisma')) {
      map.add(truth.has(c.name) ? c.name : (tableToModel.get(c.name) ?? c.name));
      continue;
    }
    if (DATABASE_CLIENT_LIBRARIES.has(c.name.toLowerCase()) || isRootPackageDerived(c)) clientLibs.push(c.name);
    else notModels.push(c.name);
  }

  const notes = [
    `truth = ${truthInfo.models.length} models from ${truthInfo.files.map((f) => path.relative(input.projectRoot, f)).join(', ')}`,
    'map = all `database` components; prisma-model components matched by name or @@map table',
  ];
  if (truthInfo.note) notes.push(truthInfo.note);
  if (clientLibs.length > 0) notes.push(`client-library-misclassified: ${clientLibs.join(', ')}`);
  if (notModels.length > 0) notes.push(`not-a-schema-model: ${notModels.join(', ')}`);

  return setDiffOracle('prisma', 'infra', truthInfo.strength, truth, map, notes, [...clientLibs, ...notModels]);
}
