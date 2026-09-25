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
/** Code-point order: locale-independent, identical on every host. */
function byCodePoint(a, b) {
    return a < b ? -1 : a > b ? 1 : 0;
}
function sorted(result) {
    if (!Array.isArray(result))
        return result;
    return [...result].sort((a, b) => byCodePoint(String(a), String(b)));
}
export const glob = (async (...args) => sorted(await rawGlob(...args)));
export const globSync = ((...args) => sorted(rawGlobSync(...args)));
//# sourceMappingURL=sorted-glob.js.map