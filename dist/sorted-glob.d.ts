/**
 * Deterministic wrappers around `glob`.
 *
 * `glob` v9+ walks the tree asynchronously and returns matches in whatever
 * order the walk finished, which differs from run to run on the same tree.
 * Scanners keep the first occurrence of a name, framework import or type
 * declaration, so an unordered walk made two scans of an unchanged repo
 * disagree. Every scanner imports `glob` from here, never from 'glob'
 * directly (enforced by `__tests__/scan-determinism.test.ts`).
 */
import { glob as rawGlob, globSync as rawGlobSync } from 'glob';
export declare const glob: typeof rawGlob;
export declare const globSync: typeof rawGlobSync;
//# sourceMappingURL=sorted-glob.d.ts.map