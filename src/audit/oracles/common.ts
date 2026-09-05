/**
 * Shared oracle helpers (Run 4). Kept separate from index.ts so each oracle
 * module can import them without a circular import through the registry.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ArchitectureComponent, ArchitectureConnection, AuditOracleResult, NavHashes } from '../../types.js';
import { proportionInterval } from '../sampler.js';

export type OracleResult = AuditOracleResult;

export interface OracleInput {
  projectRoot: string;
  components: ReadonlyArray<ArchitectureComponent>;
  connections: ReadonlyArray<ArchitectureConnection>;
  componentById: Map<string, ArchitectureComponent>;
  hashes?: NavHashes | null;
}

export interface OracleOptions {
  /** Run the SCIP imports oracle (spawns scip-typescript; 1–120 s). */
  scip?: boolean;
  /** Restrict to these oracle ids. */
  only?: string[];
  /** Allow importing `@prisma/internals` from the TARGET repo's node_modules (code execution from an audited repo). Default false → regex oracle marked weak. */
  trustTargetDeps?: boolean;
  /** scip-typescript timeout in ms (default 120000). */
  scipTimeoutMs?: number;
}

const SAMPLE_CAP = 10;

/**
 * Build an OracleResult from two name sets. Precision = tp / map_count,
 * recall = tp / truth_count, both with 95% intervals (Wilson; Clopper-Pearson
 * at 0 or n — protocol step 9).
 */
export function setDiffOracle(
  oracle: string,
  stratum: string,
  strength: OracleResult['oracle_strength'],
  truth: ReadonlySet<string>,
  map: ReadonlySet<string>,
  notes: string[] = [],
  extraFp: string[] = []
): OracleResult {
  let tp = 0;
  const fpList: string[] = [];
  const fnList: string[] = [];
  for (const m of map) {
    if (truth.has(m)) tp++;
    else fpList.push(m);
  }
  for (const t of truth) if (!map.has(t)) fnList.push(t);
  fpList.push(...extraFp);
  const fp = fpList.length;
  const fn = fnList.length;
  const mapCount = tp + fp;
  const truthCount = truth.size;
  return {
    oracle,
    stratum,
    oracle_strength: strength,
    truth_count: truthCount,
    map_count: mapCount,
    tp,
    fp,
    fn,
    precision: mapCount > 0 ? tp / mapCount : null,
    recall: truthCount > 0 ? tp / truthCount : null,
    precision_ci: mapCount > 0 ? proportionInterval(tp, mapCount) : null,
    recall_ci: truthCount > 0 ? proportionInterval(tp, truthCount) : null,
    fp_samples: fpList.slice(0, SAMPLE_CAP),
    fn_samples: fnList.slice(0, SAMPLE_CAP),
    notes,
  };
}

/** Result for an oracle whose truth source is absent or unreadable. */
export function noOracle(oracle: string, stratum: string, note: string): OracleResult {
  return {
    oracle,
    stratum,
    oracle_strength: 'none',
    truth_count: 0,
    map_count: 0,
    tp: 0,
    fp: 0,
    fn: 0,
    precision: null,
    recall: null,
    precision_ci: null,
    recall_ci: null,
    fp_samples: [],
    fn_samples: [],
    notes: [note],
  };
}

export function readJsonSafe<T>(absPath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(absPath, 'utf-8')) as T;
  } catch {
    return null;
  }
}

const WALK_IGNORE = new Set([
  'node_modules',
  '.git',
  '.next',
  'dist',
  'build',
  'out',
  'coverage',
  '.navgator',
  'vendor',
  '.turbo',
  '.cache',
  'target',
]);
const SOURCE_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

/** Independent source walk (does not reuse the scanner's file list). Bounded at `max` files. */
export function walkSourceFiles(root: string, max = 20000): string[] {
  const out: string[] = [];
  const stack: string[] = [root];
  while (stack.length > 0 && out.length < max) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.name.startsWith('.') && e.name !== '.') {
        if (WALK_IGNORE.has(e.name)) continue;
      }
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!WALK_IGNORE.has(e.name)) stack.push(abs);
      } else if (e.isFile() && SOURCE_EXT.has(path.extname(e.name))) {
        out.push(abs);
        if (out.length >= max) break;
      }
    }
  }
  return out;
}

/** True when the component was derived from the ROOT package manifest. */
export function isRootPackageDerived(c: ArchitectureComponent): boolean {
  return (c.source?.config_files ?? []).some((f) => f === 'package.json' || f === './package.json');
}

