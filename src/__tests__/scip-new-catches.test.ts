/**
 * SCIP new-catch tests (Wave 2 T12).
 *
 * Each fixture under `__tests__/fixtures/scip-catches/case-N-*` exercises
 * one cross-file reference pattern. Goal: SCIP must catch ≥3/5 patterns
 * the regex import-scanner misses on those isolated cases.
 *
 * Patterns:
 *   case-1-type-only-reexport: `export type { X } from './foo'` (type-only)
 *   case-2-jsdoc-import:       `/** @type {import('./foo').X} *​/` (JSDoc)
 *   case-3-template-import:    `await import(modName)` w/ computed name
 *   case-4-decorator:          decorator-only usage of imported symbol
 *   case-5-typeof-import:      `typeof import('./foo')` in type position
 *
 * If SCIP slips below 3/5 over time, treat it as a regression — either
 * SCIP got worse, or the regex got smarter (good problem; update test).
 */

import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { glob } from 'glob';

import { scanImports } from '../scanners/connections/import-scanner.js';
import { runScip, crossFileEdges, hasTsConfig } from '../parsers/scip-runner.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = path.resolve(__dirname, '..', '..', '__tests__', 'fixtures', 'scip-catches');
const CASES = [
  'case-1-type-only-reexport',
  'case-2-jsdoc-import',
  'case-3-template-import',
  'case-4-decorator',
  'case-5-typeof-import',
];

interface CaseResult {
  name: string;
  regex_edges: number;
  scip_edges: number;
  scip_only: number;
  scip_caught: boolean;
}

async function evaluateCase(caseName: string): Promise<CaseResult> {
  // Run regex import-scanner against the case's directory only — we treat
  // the per-case dir as a tiny project to isolate the pattern.
  const caseDir = path.join(FIXTURE_ROOT, caseName);

  const sourceFiles = await glob('**/*.{ts,tsx,js,jsx}', {
    cwd: caseDir,
    ignore: ['**/node_modules/**'],
  });
  const importResult = await scanImports(caseDir, sourceFiles);
  const regexImports = importResult.connections.filter((c) => c.connection_type === 'imports');

  // Run SCIP against the WHOLE fixture root (single tsconfig at root) and
  // filter to edges originating in this case's dir.
  if (!hasTsConfig(FIXTURE_ROOT)) {
    throw new Error('fixture root missing tsconfig.json — required for SCIP');
  }
  const scipResult = await runScip(FIXTURE_ROOT);
  const scipEdges = crossFileEdges(scipResult.edges).filter((e) => e.from_file.startsWith(`${caseName}/`));

  // "scip-only edges" = SCIP file→file pairs that the regex pass missed.
  const regexPairs = new Set(
    regexImports.map((c) => {
      const from = c.from?.location?.file ?? '';
      const to = (c.code_reference as { file?: string } | undefined)?.file ?? '';
      // regex stores `from = code file`, `to = imported file resolved`
      // (or unresolved). Use file→description for a stable key.
      const desc = c.description ?? '';
      return `${from}::${desc}`;
    })
  );
  const scipPairs = new Set(scipEdges.map((e) => `${e.from_file}->${e.to_file}`));
  const scipOnlyPairs = [...scipPairs].filter((k) => {
    // A SCIP pair "<case>/A.ts->/case>/B.ts" is "new" if no regex edge is
    // reported as originating in A pointing at B (regex stores resolved file
    // in code_reference.file? — varies; use a coarse heuristic: did regex
    // produce ANY connection from file A?).
    const fromFile = k.split('->')[0];
    return ![...regexPairs].some((r) => r.startsWith(`${fromFile}::`));
  });

  return {
    name: caseName,
    regex_edges: regexImports.length,
    scip_edges: scipEdges.length,
    scip_only: scipOnlyPairs.length,
    scip_caught: scipOnlyPairs.length > 0,
  };
}

describe('SCIP new-catches (Wave 2 T12)', () => {
  it.skipIf(!fs.existsSync(FIXTURE_ROOT))(
    'catches ≥3/5 patterns the regex import-scanner misses',
    { timeout: 30_000 },
    async () => {
      const results: CaseResult[] = [];
      for (const c of CASES) {
        const r = await evaluateCase(c);
        results.push(r);
      }
      const caught = results.filter((r) => r.scip_caught).length;
      // eslint-disable-next-line no-console
      console.log('SCIP catches:', JSON.stringify(results, null, 2));
      expect(caught, `SCIP caught ${caught}/${CASES.length} patterns; expected ≥3`).toBeGreaterThanOrEqual(3);
    }
  );
});
