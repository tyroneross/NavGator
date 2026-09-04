/**
 * Unit tests for Python import extraction and resolution
 * (`src/scanners/connections/python-imports.ts`, Chunk 1 of the "Python
 * source coverage + honest coverage reporting" plan).
 *
 * Pure-function tests: `extractPythonImports` / `resolvePythonImport` take
 * strings and in-memory Sets, so there's no disk I/O and no `scan()` call
 * here. The full pipeline (real files, `scan()`, `computeImpact`, coverage
 * reporting) is covered by `scan-coverage.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import {
  extractPythonImports,
  resolvePythonImport,
  type PythonImportSpec,
} from '../scanners/connections/python-imports.js';

describe('extractPythonImports', () => {
  it('import a.b.c → one spec, relativeLevel 0, modulePath "a.b.c"', () => {
    const specs = extractPythonImports('import a.b.c\n');
    expect(specs).toHaveLength(1);
    expect(specs[0]).toMatchObject({
      relativeLevel: 0,
      modulePath: 'a.b.c',
      importedNames: [],
    });
  });

  it('import os, sys → two specs', () => {
    const specs = extractPythonImports('import os, sys\n');
    expect(specs).toHaveLength(2);
    expect(specs.map(s => s.modulePath)).toEqual(['os', 'sys']);
  });

  it('import a.b as x → modulePath "a.b" (alias stripped)', () => {
    const specs = extractPythonImports('import a.b as x\n');
    expect(specs).toHaveLength(1);
    expect(specs[0].modulePath).toBe('a.b');
  });

  it('from a.b import c, d → importedNames ["c", "d"]', () => {
    const specs = extractPythonImports('from a.b import c, d\n');
    expect(specs).toHaveLength(1);
    expect(specs[0].modulePath).toBe('a.b');
    expect(specs[0].relativeLevel).toBe(0);
    expect(specs[0].importedNames).toEqual(['c', 'd']);
  });

  it('from . import m → relativeLevel 1, modulePath "", importedNames ["m"]', () => {
    const specs = extractPythonImports('from . import m\n');
    expect(specs).toHaveLength(1);
    expect(specs[0]).toMatchObject({
      relativeLevel: 1,
      modulePath: '',
      importedNames: ['m'],
    });
  });

  it('from ..pkg.mod import y → relativeLevel 2, modulePath "pkg.mod"', () => {
    const specs = extractPythonImports('from ..pkg.mod import y\n');
    expect(specs).toHaveLength(1);
    expect(specs[0]).toMatchObject({
      relativeLevel: 2,
      modulePath: 'pkg.mod',
      importedNames: ['y'],
    });
  });

  it('parenthesized multi-line from-import captures every name', () => {
    const specs = extractPythonImports('from x import (\n    a,\n    b,\n)\n');
    expect(specs).toHaveLength(1);
    expect(specs[0].modulePath).toBe('x');
    expect(specs[0].importedNames).toEqual(['a', 'b']);
  });

  it('indented import inside a function body is extracted (a real runtime import)', () => {
    const specs = extractPythonImports('def f():\n    import os\n    return os\n');
    expect(specs).toHaveLength(1);
    expect(specs[0].modulePath).toBe('os');
  });

  it('indented import inside a try:/except: block is extracted', () => {
    const specs = extractPythonImports(
      'try:\n    import simplejson as json\nexcept ImportError:\n    import json\n'
    );
    expect(specs).toHaveLength(2);
    expect(specs.map(s => s.modulePath)).toEqual(['simplejson', 'json']);
  });

  it('# import a.b is a comment and is not extracted', () => {
    const specs = extractPythonImports('# import a.b\n');
    expect(specs).toHaveLength(0);
  });

  it('an import line inside a triple-double-quoted docstring is not extracted', () => {
    const specs = extractPythonImports('"""\nimport pkg.docstring_only\n"""\n');
    expect(specs).toHaveLength(0);
  });

  it('an import line inside a triple-single-quoted docstring is not extracted', () => {
    const specs = extractPythonImports("'''\nimport pkg.docstring_only\n'''\n");
    expect(specs).toHaveLength(0);
  });

  it('from __future__ import annotations is not extracted', () => {
    const specs = extractPythonImports('from __future__ import annotations\n');
    expect(specs).toHaveLength(0);
  });

  // Documented over-report case: a '#' inside a string literal on the same
  // line as a real `import` must not be mistaken for a comment start, but
  // this scanner has no notion of `;`-separated compound statements — so a
  // real import sharing a physical line with unrelated code produces one
  // GARBAGE spec (module path = everything after "import ") rather than
  // cleanly recognizing just the "os" import. That is the same error
  // direction `src/architecture-index.ts`'s blind-spot text documents for
  // this whole family of regex scanners: "over-report dependents, never hide
  // them". The garbage path never matches a real file, so
  // `resolvePythonImport` drops it (returns null) — the over-report never
  // becomes a wrong edge, only a spec that resolves to nothing.
  it('a "#" inside a string literal is comment-aware (not stripped mid-string), but a compound `import X; ...` statement over-reports a garbage spec that resolves to nothing', () => {
    const specs = extractPythonImports('import os; VERSION = "id#42"  # trailing comment\n');
    expect(specs).toHaveLength(1);
    // The embedded '#' inside "id#42" did NOT end the comment early — proof
    // the comment stripper is quote-aware. The real comment ("# trailing
    // comment") is what got removed instead.
    expect(specs[0].modulePath).toContain('id#42');
    expect(specs[0].modulePath).not.toContain('trailing comment');
    // Over-reported, but harmless: no real file can ever match this path.
    expect(
      resolvePythonImport(specs[0], 'app.py', new Set(['os.py', 'pkg/x.py']))
    ).toBeNull();
  });
});

describe('resolvePythonImport', () => {
  it('absolute dotted import resolves to <path>.py', () => {
    const spec: PythonImportSpec = {
      specifier: 'pkg.mod',
      relativeLevel: 0,
      modulePath: 'pkg.mod',
      importedNames: [],
    };
    expect(resolvePythonImport(spec, 'app.py', new Set(['pkg/mod.py']))).toBe('pkg/mod.py');
  });

  it('absolute dotted import resolves to <path>/__init__.py when the plain .py file does not exist', () => {
    const spec: PythonImportSpec = {
      specifier: 'pkg.mod',
      relativeLevel: 0,
      modulePath: 'pkg.mod',
      importedNames: [],
    };
    expect(
      resolvePythonImport(spec, 'app.py', new Set(['pkg/mod/__init__.py']))
    ).toBe('pkg/mod/__init__.py');
  });

  it('relative one-level import resolves within the importer\'s own directory', () => {
    const spec: PythonImportSpec = {
      specifier: '.sibling',
      relativeLevel: 1,
      modulePath: 'sibling',
      importedNames: [],
    };
    expect(resolvePythonImport(spec, 'pkg/a.py', new Set(['pkg/sibling.py']))).toBe(
      'pkg/sibling.py'
    );
  });

  it('relative two-level import walks up to the parent package', () => {
    const spec: PythonImportSpec = {
      specifier: '..mod',
      relativeLevel: 2,
      modulePath: 'mod',
      importedNames: [],
    };
    expect(
      resolvePythonImport(spec, 'pkg/sub/a.py', new Set(['pkg/mod.py']))
    ).toBe('pkg/mod.py');
  });

  it('from . import m resolves the bare-dots form', () => {
    const spec: PythonImportSpec = {
      specifier: '.',
      relativeLevel: 1,
      modulePath: '',
      importedNames: ['m'],
    };
    expect(resolvePythonImport(spec, 'pkg/a.py', new Set(['pkg/m.py']))).toBe('pkg/m.py');
  });

  it('an unresolvable target returns null — no ghost node', () => {
    const spec: PythonImportSpec = {
      specifier: 'nope.mod',
      relativeLevel: 0,
      modulePath: 'nope.mod',
      importedNames: [],
    };
    expect(resolvePythonImport(spec, 'app.py', new Set(['pkg/mod.py']))).toBeNull();
  });
});
