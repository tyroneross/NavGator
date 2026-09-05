/**
 * npm oracle — truth frame: root package.json `dependencies` ∪ `devDependencies`.
 *
 * Map side: every component derived from the ROOT package.json, whatever type
 * the scanner assigned it (npm / database / queue / service / llm / framework —
 * the type is a classification on top of the same manifest fact). Recall is
 * exact because the manifest enumerates truth (protocol step 10).
 */

import * as path from 'path';
import { isRootPackageDerived, noOracle, readJsonSafe, setDiffOracle, type OracleInput, type OracleResult } from './common.js';

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

export function npmOracle(input: OracleInput): OracleResult {
  const pkg = readJsonSafe<PackageJson>(path.join(input.projectRoot, 'package.json'));
  if (!pkg) return noOracle('npm', 'package', 'no readable package.json at project root');

  const truth = new Set<string>([
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.devDependencies ?? {}),
  ]);
  // Run 4 fix2 #3: a manifest that exists and parses is a VALID, possibly
  // empty, frame. Every package-derived component is then a false positive.

  const map = new Set<string>();
  let nested = 0;
  for (const c of input.components) {
    const files = c.source?.config_files ?? [];
    if (isRootPackageDerived(c)) map.add(c.name);
    else if (files.some((f) => path.basename(f) === 'package.json')) nested++;
  }
  const notes = ['truth = dependencies ∪ devDependencies of root package.json; map = components sourced from that file'];
  if (truth.size === 0) notes.push('package.json declares no dependencies: the frame is empty, so every package-derived component is a false positive');
  if (nested > 0) notes.push(`${nested} components from nested package.json files excluded (outside the truth frame)`);
  return setDiffOracle('npm', 'package', 'independent', truth, map, notes);
}
