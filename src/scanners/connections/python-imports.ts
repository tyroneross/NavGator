/**
 * Python import extraction and resolution.
 *
 * A regex/line-based peer to the TS/JS path in `import-scanner.ts`, matching
 * the same "no filesystem, no AST, no dependency" contract already used by
 * the Swift and Rust scanners. `scanImports` calls this module from its own
 * parallel branch — the TS/JS path is untouched.
 *
 * The exported shape (`extractPythonImports` / `resolvePythonImport`) is
 * deliberately strategy-shaped: a later refactor can fold this and the TS/JS
 * extractor/resolver pair into one per-language table without redesigning
 * either. That table does not exist yet — do not build it here.
 */

/** One import statement, decomposed enough to resolve without touching disk. */
export interface PythonImportSpec {
  /** Raw module path as written, e.g. "pkg.wiki_index" or ".search" or "..pkg.mod" */
  specifier: string;
  /** Count of leading dots. 0 for absolute imports. */
  relativeLevel: number;
  /** Dotted path with leading dots stripped. May be '' for `from . import x`. */
  modulePath: string;
  /** Names imported in a `from X import a, b` form. Empty for plain `import X`. */
  importedNames: string[];
}

// Common standard-library top-level modules. Not exhaustive by design — this
// only needs to keep obvious stdlib usage out of `uses-package` edges; a
// missed rare stdlib module just produces an edge to nothing (no
// `knownPackages` entry will match it) rather than a wrong one.
export const PYTHON_STDLIB_MODULES: ReadonlySet<string> = new Set([
  'os', 'sys', 're', 'json', 'pathlib', 'typing', 'logging', 'collections',
  'itertools', 'functools', 'subprocess', 'datetime', 'math', 'time',
  'random', 'asyncio', 'dataclasses', 'abc', 'argparse', 'csv', 'hashlib',
  'io', 'shutil', 'tempfile', 'textwrap', 'threading', 'traceback',
  'unittest', 'urllib', 'uuid', 'warnings', 'enum', 'glob', 'copy',
  'contextlib', 'base64', 'pickle', 'sqlite3', 'socket', 'string', 'struct',
  'inspect', 'importlib', '__future__', 'multiprocessing', 'signal',
  'platform', 'stat', 'array', 'heapq', 'bisect', 'queue', 'weakref',
  'operator', 'decimal', 'fractions', 'statistics', 'zlib', 'gzip',
  'tarfile', 'zipfile', 'configparser', 'xml', 'html', 'http', 'ftplib',
  'smtplib', 'email', 'ipaddress', 'ssl', 'select', 'ctypes', 'venv', 'pip',
  'setuptools', 'pkgutil', 'runpy', 'types', 'numbers', 'secrets', 'gc',
]);

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

/** `from <dots><module>? import <names>` — module is optional (bare-dots form). */
const FROM_IMPORT_RE = /^\s*from\s+(\.*)([A-Za-z_][\w.]*)?\s+import\s+(.+)$/;
/** `import <dotted>[, <dotted>...]` — deliberately NOT matched when `from` precedes it. */
const PLAIN_IMPORT_RE = /^\s*import\s+(.+)$/;

/**
 * Strip a trailing `# comment`, but only when the `#` sits outside an
 * ordinary (non-triple) quoted string on the same line. Triple-quoted
 * strings are handled one level up in `cleanPythonLines` before this ever
 * runs, so this only has to reason about `'...'` and `"..."`.
 */
function stripComment(line: string): string {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "'" && !inDouble) { inSingle = !inSingle; continue; }
    if (ch === '"' && !inSingle) { inDouble = !inDouble; continue; }
    if (ch === '#' && !inSingle && !inDouble) return line.slice(0, i);
  }
  return line;
}

/**
 * Blank out triple-quoted string bodies (docstrings) and strip comments,
 * one array entry per source line so downstream line numbers stay correct.
 * A docstring that happens to contain the word "import" must not produce a
 * spec — this is the pass that guarantees that.
 */
function cleanPythonLines(content: string): string[] {
  const rawLines = content.split('\n');
  const cleaned: string[] = [];
  let tripleDelim: '"""' | "'''" | null = null;

  for (const raw of rawLines) {
    let line = raw;

    if (tripleDelim) {
      const closeIdx = line.indexOf(tripleDelim);
      if (closeIdx === -1) {
        // Whole line is still inside the docstring/triple-quoted string.
        cleaned.push('');
        continue;
      }
      line = line.slice(closeIdx + 3);
      tripleDelim = null;
    }

    // A triple-quote can also open (and possibly close) on this same line —
    // a single-line docstring, or an assignment like `X = """text"""`. Loop
    // because a line can carry more than one such string.
    for (;;) {
      const dq = line.indexOf('"""');
      const sq = line.indexOf("'''");
      let start = -1;
      let delim: '"""' | "'''" = '"""';
      if (dq !== -1 && (sq === -1 || dq < sq)) { start = dq; delim = '"""'; }
      else if (sq !== -1) { start = sq; delim = "'''"; }
      if (start === -1) break;

      const closeIdx = line.indexOf(delim, start + 3);
      if (closeIdx === -1) {
        // Opens here, closes on a later line.
        line = line.slice(0, start);
        tripleDelim = delim;
        break;
      }
      // Opens and closes on the same line — drop the string body and keep
      // scanning the remainder for further strings/comments.
      line = line.slice(0, start) + ' ' + line.slice(closeIdx + 3);
    }

    cleaned.push(stripComment(line));
  }

  return cleaned;
}

function countChar(s: string, ch: string): number {
  let n = 0;
  for (const c of s) if (c === ch) n++;
  return n;
}

/** Split a `from X import <this>` name list into bare names, alias stripped. */
function parseNameList(text: string): string[] {
  let t = text.trim();
  if (t.startsWith('(')) t = t.slice(1);
  const closeParen = t.lastIndexOf(')');
  if (closeParen !== -1) t = t.slice(0, closeParen);
  return t
    .split(',')
    .map(entry => entry.replace(/\s+as\s+\w+\s*$/, '').trim())
    .filter(Boolean);
}

/**
 * Extract every import statement from Python source. Line-based, not a
 * parser: comments and triple-quoted strings are stripped first, then two
 * patterns (`from ... import ...` and plain `import ...`) are matched per
 * line, with the `from` form allowed to span multiple physical lines when
 * the name list is parenthesized.
 */
export function extractPythonImports(content: string): PythonImportSpec[] {
  const lines = cleanPythonLines(content);
  const specs: PythonImportSpec[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const fromMatch = FROM_IMPORT_RE.exec(line);
    if (fromMatch) {
      const dots = fromMatch[1];
      const modBase = fromMatch[2] ?? '';
      let listText = fromMatch[3];

      // `from x import (` may spill the name list across several lines —
      // the one case a Python import genuinely spans multiple physical
      // lines without a backslash continuation. Balance parens across
      // lines rather than assuming one statement = one line.
      let depth = countChar(listText, '(') - countChar(listText, ')');
      while (depth > 0 && i + 1 < lines.length) {
        i++;
        listText += ' ' + lines[i];
        depth += countChar(lines[i], '(') - countChar(lines[i], ')');
      }

      if (modBase !== '__future__') {
        const names = parseNameList(listText);
        if (names.length > 0) {
          specs.push({
            specifier: dots + modBase,
            relativeLevel: dots.length,
            modulePath: modBase,
            importedNames: names,
          });
        }
      }
      i++;
      continue;
    }

    const plainMatch = PLAIN_IMPORT_RE.exec(line);
    if (plainMatch) {
      for (const rawEntry of plainMatch[1].split(',')) {
        const modulePath = rawEntry.replace(/\s+as\s+\w+\s*$/, '').trim();
        if (!modulePath || modulePath === '__future__') continue;
        specs.push({
          specifier: modulePath,
          relativeLevel: 0,
          modulePath,
          importedNames: [],
        });
      }
    }
    i++;
  }

  return specs;
}

// ---------------------------------------------------------------------------
// Resolution — against knownFiles only, never the filesystem
// ---------------------------------------------------------------------------

function dirnamePosix(p: string): string {
  const idx = p.lastIndexOf('/');
  return idx === -1 ? '' : p.slice(0, idx);
}

/**
 * Build the ordered set of path-segment candidates for a spec, longest
 * (most specific) first. `from a.b import c` is ambiguous on its own — `c`
 * could be a submodule of `a.b`, or a symbol defined inside `a/b.py` — so
 * both are offered and the caller prefers whichever exists.
 */
function candidateSegmentSets(spec: PythonImportSpec): string[][] {
  const moduleSegs = spec.modulePath ? spec.modulePath.split('.').filter(Boolean) : [];
  const candidates: string[][] = [];
  for (const name of spec.importedNames) {
    if (!name) continue;
    candidates.push([...moduleSegs, name]);
  }
  if (moduleSegs.length > 0) candidates.push(moduleSegs);
  return candidates;
}

function tryCandidates(
  root: string,
  candidates: string[][],
  knownFiles: ReadonlySet<string>
): string | null {
  for (const segs of candidates) {
    if (segs.length === 0) continue;
    const joined = segs.join('/');
    const modulePath = root ? `${root}/${joined}.py` : `${joined}.py`;
    if (knownFiles.has(modulePath)) return modulePath;
    const packagePath = root ? `${root}/${joined}/__init__.py` : `${joined}/__init__.py`;
    if (knownFiles.has(packagePath)) return packagePath;
  }
  return null;
}

// Cached per knownFiles Set identity (one per scan), not per import — the
// caller reuses the same Set across every file in the scan, so this builds
// the ancestor-root candidate list once instead of O(files × imports).
const rootCandidateCache = new WeakMap<ReadonlySet<string>, string[]>();

function ancestorRoots(knownFiles: ReadonlySet<string>): string[] {
  const cached = rootCandidateCache.get(knownFiles);
  if (cached) return cached;

  const roots = new Set<string>();
  for (const file of knownFiles) {
    const parts = file.split('/');
    parts.pop(); // drop the filename itself
    let prefix = '';
    for (const part of parts) {
      prefix = prefix ? `${prefix}/${part}` : part;
      roots.add(prefix);
    }
  }
  // Shallowest first: a src/-style package root is almost always closer to
  // the repo root than a coincidentally-named nested directory.
  const ordered = [...roots].sort(
    (a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b)
  );
  rootCandidateCache.set(knownFiles, ordered);
  return ordered;
}

/**
 * Resolve one import spec to a repo-relative file path, or null when it
 * doesn't match anything the scan actually saw. Never touches the
 * filesystem — an unresolved target produces no edge (no ghost nodes),
 * mirroring the TS/JS resolver's contract exactly.
 */
export function resolvePythonImport(
  spec: PythonImportSpec,
  importerFile: string,
  knownFiles: ReadonlySet<string>
): string | null {
  const candidates = candidateSegmentSets(spec);
  if (candidates.length === 0) return null;

  if (spec.relativeLevel > 0) {
    // Base directory: the importer's own directory for a single dot, then
    // walk up one more level per extra leading dot.
    let baseDir = dirnamePosix(importerFile);
    for (let i = 0; i < spec.relativeLevel - 1; i++) {
      baseDir = dirnamePosix(baseDir);
    }
    return tryCandidates(baseDir, candidates, knownFiles);
  }

  // Absolute import: try from the repo root first (the common case), then
  // fall back to treating every directory the scan actually saw as a
  // possible package root. That's what resolves `pkg.mod` when the package
  // really lives at e.g. `Wiki/tools/scripts/pkg/mod.py`.
  const direct = tryCandidates('', candidates, knownFiles);
  if (direct) return direct;

  for (const root of ancestorRoots(knownFiles)) {
    const resolved = tryCandidates(root, candidates, knownFiles);
    if (resolved) return resolved;
  }
  return null;
}

/**
 * First dotted segment of an absolute import, for `uses-package` edges.
 * Relative imports and stdlib modules never point at a package — both
 * return null so the caller emits nothing rather than a wrong edge.
 */
export function pythonPackageHead(spec: PythonImportSpec): string | null {
  if (spec.relativeLevel > 0) return null;
  const head = spec.modulePath.split('.')[0];
  if (!head) return null;
  if (PYTHON_STDLIB_MODULES.has(head)) return null;
  return head;
}
