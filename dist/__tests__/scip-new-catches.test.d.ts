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
export {};
//# sourceMappingURL=scip-new-catches.test.d.ts.map