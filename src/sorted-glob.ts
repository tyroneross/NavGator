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
function byCodePoint(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function sorted<T>(result: T): T {
  if (!Array.isArray(result)) return result;
  return [...result].sort((a, b) => byCodePoint(String(a), String(b))) as T;
}

export const glob = (async (...args: Parameters<typeof rawGlob>) =>
  sorted(await rawGlob(...args))) as typeof rawGlob;

export const globSync = ((...args: Parameters<typeof rawGlobSync>) =>
  sorted(rawGlobSync(...args))) as typeof rawGlobSync;
