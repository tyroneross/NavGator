/**
 * Regression tests for the filed defect: a Python-majority repo scanned to
 * zero components, exit 0, zero warnings — a false negative that read as a
 * verified clean result. These tests run the real `scan()` pipeline (Chunks
 * 1 + 2) against real fixtures, not the pure-function unit tests in
 * `python-imports.test.ts`.
 *
 * Fixture-copy convention: the canonical fixture tree lives at
 * `__tests__/fixtures/python-repo/` (checked in, git-tracked, reusable) and
 * is copied into a fresh `os.tmpdir()` per test group before `scan()` runs —
 * mirroring the tmpdir-per-run isolation `scanner-full-scan-diff.test.ts` and
 * `scan-degradation.test.ts` use for every full-`scan()` integration test, so
 * parallel test files never contend over one shared `.navgator/` lease.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { scan, SCAN_COVERAGE_ANALYZED_LANGUAGES } from '../scanner.js';
import { computeImpact } from '../impact.js';
import type { ArchitectureComponent, ArchitectureConnection } from '../types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PYTHON_REPO_FIXTURE = path.resolve(__dirname, '..', '..', '__tests__', 'fixtures', 'python-repo');

function writeFixture(dir: string, relPath: string, content: string): void {
  const fullPath = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, 'utf-8');
}

function componentFile(c: ArchitectureComponent): string | undefined {
  return c.source?.config_files?.[0];
}

function importEdgePairs(connections: ArchitectureConnection[]): string[] {
  return connections
    .filter(c => c.connection_type === 'imports')
    .map(c => `${c.from.location?.file} -> ${c.to.location?.file}`)
    .sort();
}

// The exact edge set the python-repo fixture must produce. See the fixture
// files' own docstrings for why each edge does or doesn't exist —
// `pkg/wiki_index.py` is the leaf with two known importers (`pkg/search.py`
// via an absolute dotted import, `pkg/cli.py` via `from pkg import
// wiki_index`); `pkg/util/helpers.py` also imports it directly (two-level
// relative); `pkg/multi.py` imports `pkg/util/helpers.py` (parenthesized
// multi-line `from ... import (`). Stdlib imports (`os`, `sys`), the
// third-party `requests` import, the commented-out import, and the
// docstring-embedded import all correctly produce NO edge.
const EXPECTED_PY_EDGES = [
  'pkg/search.py -> pkg/wiki_index.py',
  'pkg/cli.py -> pkg/search.py',
  'pkg/cli.py -> pkg/wiki_index.py',
  'pkg/util/helpers.py -> pkg/wiki_index.py',
  'pkg/multi.py -> pkg/util/helpers.py',
].sort();

describe('Python import graph (regression fixture: __tests__/fixtures/python-repo)', () => {
  let tmpRoot: string;
  let components: ArchitectureComponent[];
  let connections: ArchitectureConnection[];

  // 30s: a scanner-process cold start (first `scan()` call in a fresh forked
  // test-worker process — dynamic imports, ts-morph, etc.) measured well
  // over the default 10s hookTimeout on this runner, even for an 8-file
  // fixture; every subsequent `scan()` call in the same process is ~100ms.
  // Every `it`/`beforeAll` below that calls `scan()` for the first time in
  // its file gets the same allowance for the same reason.
  beforeAll(async () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-python-repo-'));
    fs.cpSync(PYTHON_REPO_FIXTURE, tmpRoot, { recursive: true });
    const outcome = await scan(tmpRoot, { mode: 'full' });
    expect(outcome.status).toBe('completed');
    components = outcome.components;
    connections = outcome.connections;
  }, 30000);

  afterAll(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('yields one component per .py file (the filed defect: this used to be zero)', () => {
    const pyComponents = components.filter(c => componentFile(c)?.endsWith('.py'));
    const files = pyComponents.map(c => componentFile(c)).sort();
    expect(files).toEqual(
      [
        'pkg/__init__.py',
        'pkg/cli.py',
        'pkg/multi.py',
        'pkg/search.py',
        'pkg/util/__init__.py',
        'pkg/util/helpers.py',
        'pkg/wiki_index.py',
      ].sort()
    );
  });

  it('yields exactly the expected `imports` edge set — not just a non-zero count', () => {
    expect(importEdgePairs(connections)).toEqual(EXPECTED_PY_EDGES);
  });

  it('computeImpact on the leaf module (pkg/wiki_index.py) names both known importers', () => {
    const wikiIndex = components.find(c => componentFile(c) === 'pkg/wiki_index.py');
    expect(wikiIndex).toBeDefined();

    const impact = computeImpact(wikiIndex!, components, connections);
    const affectedFiles = impact.affected.map(a => componentFile(a.component));

    // The literal check the filed report demanded: `navgator impact
    // wiki_index` must name both real importers, not resolve to nothing.
    expect(affectedFiles).toContain('pkg/search.py');
    expect(affectedFiles).toContain('pkg/cli.py');
    // pkg/util/helpers.py also imports pkg/wiki_index.py directly (a third
    // real importer via the two-level-relative edge) — asserted here too
    // since it's a direct consequence of the exact edge set proven above,
    // not an extra claim.
    expect(affectedFiles).toContain('pkg/util/helpers.py');
  });

  it('the commented-out import and the docstring-embedded import produce no edge', () => {
    // Neither target is a real file in the fixture, so resolution alone
    // already guarantees no edge — this asserts the stronger claim that
    // extraction never even produced a dangling reference to either name.
    const symbols = connections.map(c => c.code_reference?.symbol ?? '');
    expect(symbols.some(s => s.includes('commented_out'))).toBe(false);
    expect(symbols.some(s => s.includes('docstring_only'))).toBe(false);
    // And the edge-set assertion above already pins the connection count at
    // exactly 5 — no phantom edges from either negative case.
    expect(connections.filter(c => c.connection_type === 'imports')).toHaveLength(5);
  });
});

describe('scan coverage reporting (honest disclosure of what was and was not analyzed)', () => {
  it('a repo with a language no scanner consumes (Go) warns, names Go, and reports non-zero warnings_count', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-coverage-go-'));
    try {
      writeFixture(tmpRoot, 'main.go', 'package main\n\nfunc main() {}\n');

      const outcome = await scan(tmpRoot, { mode: 'full' });
      expect(outcome.status).toBe('completed');
      if (outcome.status !== 'completed') return;

      expect(outcome.coverage).toBeDefined();
      expect(outcome.coverage?.status).not.toBe('full');
      const goSpot = outcome.coverage?.blind_spots.find(s => s.includes('Go'));
      expect(goSpot).toBeDefined();
      expect(goSpot).toContain('NOT analyzed');

      // The exact false negative this chunk regresses against: a repo
      // NavGator did not look at must never report zero warnings.
      expect(outcome.stats.warnings_count).toBeGreaterThan(0);
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  }, 30000);

  it('an analyzed language that produces zero internal edges warns with "analyzed but produced zero internal edges" wording, not "NOT analyzed"', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-coverage-edgeless-'));
    try {
      // Two Python files that each import stdlib only — no import between
      // them, so Python is ANALYZED but produces zero internal edges.
      writeFixture(tmpRoot, 'a.py', 'import os\n\n\ndef a():\n    return os.name\n');
      writeFixture(tmpRoot, 'b.py', 'import sys\n\n\ndef b():\n    return sys.platform\n');

      const outcome = await scan(tmpRoot, { mode: 'full' });
      expect(outcome.status).toBe('completed');
      if (outcome.status !== 'completed') return;

      expect(outcome.coverage).toBeDefined();
      const pySpot = outcome.coverage?.blind_spots.find(s => s.includes('Python'));
      expect(pySpot).toBeDefined();
      // The two arms must not be confusable: this one says "analyzed but
      // produced zero internal edges", never "NOT analyzed".
      expect(pySpot).toContain('were analyzed but produced zero internal');
      expect(pySpot).not.toContain('NOT analyzed');

      const pyLang = outcome.coverage?.languages.find(l => l.language === 'Python');
      expect(pyLang?.analyzed).toBe(true);
      expect(pyLang?.internal_edges).toBe(0);
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  }, 30000);

  it('a fully-analyzed repo (TS-only, with a real internal import) emits no `coverage` key — byte-identical to today', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-coverage-full-'));
    try {
      writeFixture(
        tmpRoot,
        'package.json',
        JSON.stringify({ name: 'ts-only-fixture', version: '0.0.0' }, null, 2)
      );
      writeFixture(tmpRoot, 'src/a.ts', `export function fromA() { return 1; }\n`);
      writeFixture(
        tmpRoot,
        'src/b.ts',
        `import { fromA } from './a';\nexport function fromB() { return fromA() + 1; }\n`
      );

      const outcome = await scan(tmpRoot, { mode: 'full' });
      expect(outcome.status).toBe('completed');
      if (outcome.status !== 'completed') return;

      // This pins the "byte-identical when nothing is wrong" contract.
      expect(outcome.coverage).toBeUndefined();
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  }, 30000);
});

describe('SCAN_COVERAGE_ANALYZED_LANGUAGES is honest about what has a scanner', () => {
  // There is no per-language scanner registry to introspect yet — see the
  // plan's Chunk 1 write-up ("Chosen: current-constraints, with the seam
  // pre-cut"): TS/JS and Python are two hand-coded branches inside
  // `scanImports`, and Swift/Rust are separate source scanners. A fully
  // mechanical derivation of "languages with a scanner" from the source tree
  // does not exist today, so this pins the current set by hand (per this
  // chunk's own instructions: "assert the current exact set and leave a
  // comment naming the coupling"). The second `it` below is the partial
  // mechanical guard: it fails if any of these files is deleted or renamed
  // without this test being updated.
  const LANGUAGE_SCANNER_FILES: Record<string, string> = {
    TypeScript: 'src/scanners/connections/import-scanner.ts',
    JavaScript: 'src/scanners/connections/import-scanner.ts',
    Python: 'src/scanners/connections/python-imports.ts',
    Swift: 'src/scanners/swift/code-scanner.ts',
    Rust: 'src/scanners/rust/code-scanner.ts',
  };

  it('matches exactly this hand-pinned set — adding a language here without updating this test fails it', () => {
    expect([...SCAN_COVERAGE_ANALYZED_LANGUAGES].sort()).toEqual(
      Object.keys(LANGUAGE_SCANNER_FILES).sort()
    );
  });

  it('every claimed scanner file actually exists on disk', () => {
    const repoRoot = path.resolve(__dirname, '..', '..');
    for (const file of Object.values(LANGUAGE_SCANNER_FILES)) {
      expect(fs.existsSync(path.join(repoRoot, file)), `missing scanner file: ${file}`).toBe(true);
    }
  });
});
