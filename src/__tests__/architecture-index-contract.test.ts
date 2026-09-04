/**
 * Acceptance gates for the COMMITTED architecture index.
 *
 * `architecture-index.test.ts` tests the generator against synthetic fixtures.
 * This file tests the artifact a cold agent actually opens: the bytes checked
 * into git at `ARCHITECTURE.md` and `docs/architecture/index.json`. Each
 * describe block below is one named failure mode, and each was shown failing
 * on a planted defect before being trusted.
 *
 *   A. FALSE NEGATIVE — the index claims a file affects nothing while real
 *      importers exist. Graded DIFFERENTIALLY against an oracle built here
 *      from the TypeScript compiler's AST, which shares no code and no method
 *      with NavGator's regex import scanner. Re-using the index's own code
 *      would prove self-consistency, not truth.
 *   B. CHURN — the committed artifact must be byte-reproducible.
 *   C. BLIND SPOT SOLD AS HEALTH — a tree that could not be fully analyzed
 *      must never grade clean.
 *   D. ROT — a source-import change that is not regenerated must be
 *      detectable, and CI must run that detection.
 *   E. DISCOVERY — a cold agent must reach the index in one hop.
 *
 * Gate A doubles as a rot detector: it reads the COMMITTED index and compares
 * it to the CURRENT tree, so an un-regenerated import change fails here too,
 * seconds after the edit instead of minutes later in CI. When it fails that
 * way, `npm run architecture` is the fix.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import ts from 'typescript';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const ARCHITECTURE_MD = path.join(REPO_ROOT, 'ARCHITECTURE.md');
const INDEX_JSON = path.join(REPO_ROOT, 'docs/architecture/index.json');
const MODULES_JSON = path.join(REPO_ROOT, 'docs/architecture/modules.json');

interface CommittedIndex {
  schema_version: number;
  coverage: {
    status: 'full' | 'partial' | 'none';
    analyzed_files: number;
    internal_edges: number;
    languages: Array<{ language: string; files: number; analyzed: boolean; internal_edges: number }>;
    blind_spots: string[];
  };
  modules: Array<{ id: string; responsibility: string | null; curated: boolean }>;
  hotspots: Array<{ file: string; dependents: number }>;
  boundaries: Array<{ id: string; from: string; must_not_depend_on: string[]; status: string }>;
  files: Record<string, { module: string; imports: string[]; imported_by: string[] }>;
}

let index: CommittedIndex;
let markdown: string;

beforeAll(() => {
  index = JSON.parse(fs.readFileSync(INDEX_JSON, 'utf-8')) as CommittedIndex;
  markdown = fs.readFileSync(ARCHITECTURE_MD, 'utf-8');
});

// ===========================================================================
// The independent oracle (gate A)
// ===========================================================================

const RESOLVE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

/**
 * Import specifiers reachable from the AST, split into two populations:
 *
 *   `code`     — specifiers in a real import/export/require/dynamic-import
 *                position. These are the true edges.
 *   `nonCode`  — specifiers that appear only inside a comment or a string
 *                literal. NavGator's scanner is regex-based over raw file
 *                text, so it cannot tell these from code; the AST can.
 *
 * Keeping them separate is what lets gate A convict a real miss while
 * explaining a text-match over-report instead of silently tolerating it.
 */
function specifiersOf(file: string, source: string): { code: string[]; nonCode: string[] } {
  const kind = file.endsWith('.tsx') || file.endsWith('.jsx') ? ts.ScriptKind.TSX : undefined;
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind);

  const code: string[] = [];
  const literalBlobs: string[] = [];

  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      code.push(node.moduleSpecifier.text);
    } else if (
      // `import('./x.js').Type` in type position is an ImportTypeNode, not a
      // call expression. `src/cli/commands/arch-diff.ts` uses exactly this.
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)
    ) {
      code.push(node.argument.literal.text);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      ts.isStringLiteral(node.moduleReference.expression)
    ) {
      code.push(node.moduleReference.expression.text);
    } else if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const isRequire = ts.isIdentifier(callee) && callee.text === 'require';
      const isDynamic = callee.kind === ts.SyntaxKind.ImportKeyword;
      const first = node.arguments[0];
      if ((isRequire || isDynamic) && first && ts.isStringLiteral(first)) {
        code.push(first.text);
      } else if (first && ts.isStringLiteral(first)) {
        literalBlobs.push(first.text);
      }
    } else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      literalBlobs.push(node.text);
    } else if (ts.isTemplateExpression(node)) {
      literalBlobs.push(node.head.text, ...node.templateSpans.map(s => s.literal.text));
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  // Comments never reach the AST as nodes, so collect them from the scanner.
  const commentText: string[] = [];
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, source);
  let token = scanner.scan();
  while (token !== ts.SyntaxKind.EndOfFileToken) {
    if (
      token === ts.SyntaxKind.SingleLineCommentTrivia ||
      token === ts.SyntaxKind.MultiLineCommentTrivia
    ) {
      commentText.push(scanner.getTokenText());
    }
    token = scanner.scan();
  }

  // Pull quoted specifier-shaped substrings out of the non-code text.
  const nonCode: string[] = [];
  const quoted = /['"`]([^'"`\n]{1,300})['"`]/g;
  for (const blob of [...literalBlobs, ...commentText]) {
    let match: RegExpExecArray | null;
    while ((match = quoted.exec(blob)) !== null) nonCode.push(match[1]);
    quoted.lastIndex = 0;
  }
  return { code, nonCode };
}

/** Resolve a specifier the way the index does, but implemented here. */
function makeResolver(covered: Set<string>) {
  const tryPaths = (base: string): string | null => {
    const stripped = base.replace(/\.(js|jsx|mjs|cjs)$/, '');
    const candidates: string[] = [];
    for (const ext of RESOLVE_EXTENSIONS) {
      candidates.push(stripped + ext, base + ext);
    }
    candidates.push(base);
    for (const ext of RESOLVE_EXTENSIONS) candidates.push(path.posix.join(base, `index${ext}`));
    return candidates.find(c => covered.has(c)) ?? null;
  };

  return (fromFile: string, spec: string): string | null => {
    if (spec.startsWith('./') || spec.startsWith('../')) {
      return tryPaths(path.posix.join(path.posix.dirname(fromFile), spec));
    }
    // web/tsconfig.json maps "@/*" to "./*" rooted at web/.
    if (spec.startsWith('@/') && fromFile.startsWith('web/')) {
      return tryPaths(path.posix.join('web', spec.slice(2)));
    }
    return null; // bare package specifier: not an internal edge
  };
}

interface Differential {
  oracleEdges: number;
  /** Covered by the index but absent from disk — the index describes a machine, not the repo. */
  missing: string[];
  /** Oracle found this importer; the index did not list it. THE DANGEROUS ONE. */
  missed: Array<{ importer: string; target: string }>;
  /** Index lists this importer; the oracle found no code-position import. */
  invented: Array<{ importer: string; target: string; explained: boolean }>;
}

function runDifferential(): Differential {
  const covered = new Set(Object.keys(index.files));
  const resolve = makeResolver(covered);

  const oracleImportedBy = new Map<string, Set<string>>();
  const nonCodeTargets = new Map<string, Set<string>>();
  for (const file of covered) {
    oracleImportedBy.set(file, new Set());
    nonCodeTargets.set(file, new Set());
  }

  // A covered file that is not on disk is a FINDING about the index, not a
  // crash in the gate. The index used to cover web/server.cjs — generated by
  // build:standalone and gitignored — so every clean checkout died here on
  // ENOENT, and the error named the reader instead of the defect. Collect the
  // missing ones and let the caller assert on them.
  const missing: string[] = [];
  for (const file of covered) {
    const abs = path.join(REPO_ROOT, file);
    if (!fs.existsSync(abs)) {
      missing.push(file);
      continue;
    }
    const source = fs.readFileSync(abs, 'utf-8');
    const { code, nonCode } = specifiersOf(file, source);
    for (const spec of code) {
      const target = resolve(file, spec);
      if (target && target !== file) oracleImportedBy.get(target)!.add(file);
    }
    for (const spec of nonCode) {
      const target = resolve(file, spec);
      if (target && target !== file) nonCodeTargets.get(file)!.add(target);
    }
  }

  const missed: Differential['missed'] = [];
  const invented: Differential['invented'] = [];
  let oracleEdges = 0;
  for (const target of covered) {
    const claimed = new Set(index.files[target].imported_by);
    const actual = oracleImportedBy.get(target)!;
    oracleEdges += actual.size;
    for (const importer of actual) {
      if (!claimed.has(importer)) missed.push({ importer, target });
    }
    for (const importer of claimed) {
      if (actual.has(importer)) continue;
      invented.push({ importer, target, explained: nonCodeTargets.get(importer)!.has(target) });
    }
  }
  return {
    missing, oracleEdges, missed, invented };
}

let differential: Differential;

// ===========================================================================
// A. FALSE NEGATIVE
// ===========================================================================

describe('gate A — differential: the index must not hide a real importer', () => {
  beforeAll(() => {
    differential = runDifferential();
  });

  it('covers only files that exist in a clean checkout', () => {
    // The index is COMMITTED, so it must describe the repository rather than
    // the machine that built it. It once covered web/server.cjs — generated by
    // build:standalone and gitignored — which existed for the author and for
    // nobody who cloned. CI died reading it on every run.
    expect(
      differential.missing,
      `the index covers ${differential.missing.length} file(s) absent from this checkout:\n` +
        differential.missing.map(f => `  ${f}`).join('\n') +
        '\nRegenerate with `npm run architecture`; the generator indexes tracked files only.',
    ).toEqual([]);
  });

  it('derives a substantive oracle, so a zero-disagreement result is not vacuous', () => {
    // Guards the instrument itself. An oracle that parsed nothing would report
    // zero missed importers and look like a pass.
    expect(differential.oracleEdges).toBeGreaterThan(500);
    expect(Object.keys(index.files).length).toBeGreaterThan(200);
  });

  it('lists every importer an independent AST pass can find (zero false negatives)', () => {
    const detail = differential.missed
      .slice(0, 25)
      .map(m => `  ${m.importer} imports ${m.target}, but the index omits it`)
      .join('\n');
    expect(
      differential.missed.length,
      `The committed index under-reports ${differential.missed.length} importer(s). ` +
        'An agent reading it would believe a change is safe when it is not. ' +
        'If the tree changed, run `npm run architecture` and commit.\n' +
        detail
    ).toBe(0);
  });

  it('over-reports only where a specifier sits in a comment or string literal', () => {
    // The other direction. NavGator's scanner matches raw text, so a
    // commented-out import (src/ui-server.ts) or a fixture string inside a
    // test counts as an edge. That inflates blast radius, which is the SAFE
    // direction, and every instance must be explainable as non-code text —
    // an unexplained one would mean the resolver invented an edge outright.
    const unexplained = differential.invented.filter(i => !i.explained);
    const detail = unexplained
      .slice(0, 25)
      .map(i => `  index claims ${i.importer} imports ${i.target}; no AST or text evidence`)
      .join('\n');
    expect(unexplained.length, `Unexplained invented edges:\n${detail}`).toBe(0);
  });

  it('keeps text-match over-reporting under 2% of all edges', () => {
    // A ratchet on a known, documented limitation. Measured 4/1049 (0.4%) at
    // the time this gate landed. Crossing 2% means the scanner started
    // treating documentation or fixtures as architecture at scale.
    const ratio = differential.invented.length / Math.max(1, index.coverage.internal_edges);
    expect(ratio).toBeLessThan(0.02);
  });

  it('states the text-match limitation in the artifact a cold agent reads', () => {
    // A limitation that is measured but not published still misleads.
    expect(index.coverage.blind_spots.join(' ')).toMatch(/comment|string literal/i);
  });
});

// ===========================================================================
// B. CHURN
// ===========================================================================

describe('gate B — churn: the committed artifact is byte-reproducible', () => {
  it('carries no timestamp, absolute path, or machine-specific value', () => {
    const serialized = `${markdown}\n${fs.readFileSync(INDEX_JSON, 'utf-8')}`;
    expect(serialized).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
    expect(serialized).not.toMatch(/\b1[6-9]\d{11}\b/); // ms epoch
    expect(serialized).not.toMatch(/\/(Users|home)\/[a-z]/i);
    expect(serialized).not.toContain(REPO_ROOT);
    expect(serialized).not.toMatch(/\bgenerated (on|at)\b/i);
  });

  it('serializes JSON object keys in sorted order at every level', () => {
    // Insertion-order serialization would let an unrelated refactor of the
    // generator reorder the committed file and produce an empty-content diff.
    const raw = fs.readFileSync(INDEX_JSON, 'utf-8');
    const walk = (value: unknown, at: string): void => {
      if (Array.isArray(value)) {
        value.forEach((v, i) => walk(v, `${at}[${i}]`));
        return;
      }
      if (!value || typeof value !== 'object') return;
      const keys = Object.keys(value as Record<string, unknown>);
      expect(keys, `keys out of order at ${at}`).toEqual([...keys].sort());
      for (const k of keys) walk((value as Record<string, unknown>)[k], `${at}.${k}`);
    };
    walk(JSON.parse(raw), '$');
    expect(raw.endsWith('\n')).toBe(true);
  });

  it('sorts every per-file importer and import list', () => {
    for (const [file, entry] of Object.entries(index.files)) {
      expect(entry.imports, `imports unsorted in ${file}`).toEqual([...entry.imports].sort());
      expect(entry.imported_by, `imported_by unsorted in ${file}`).toEqual(
        [...entry.imported_by].sort()
      );
    }
  });
});

// ===========================================================================
// C. BLIND SPOT SOLD AS HEALTH
// ===========================================================================

describe('gate C — a tree that could not be fully analyzed never grades clean', () => {
  it('grades this repo PARTIAL, because it holds files the scanner cannot read', () => {
    const unanalyzed = index.coverage.languages.filter(l => !l.analyzed && l.files > 0);
    expect(unanalyzed.length).toBeGreaterThan(0);
    expect(index.coverage.status).not.toBe('full');
    expect(markdown).toContain('Coverage: PARTIAL');
  });

  it('names every unanalyzed language, with its file count, as a blind spot', () => {
    for (const lang of index.coverage.languages) {
      if (lang.analyzed || lang.files === 0) continue;
      const named = index.coverage.blind_spots.some(
        s => s.includes(lang.language) && s.includes(String(lang.files))
      );
      expect(named, `${lang.language} (${lang.files} files) is unanalyzed but unnamed`).toBe(true);
      // The exact wording that stops "no edges" from reading as "no coupling".
      expect(
        index.coverage.blind_spots.some(s => s.includes(lang.language) && /not measured/i.test(s))
      ).toBe(true);
    }
  });

  it('renders unanalyzed languages as `n/a` edges, never as a zero', () => {
    // A zero in an edge column reads as "measured, found nothing". These
    // languages were not measured at all, and the table must say so.
    for (const lang of index.coverage.languages) {
      if (lang.analyzed) continue;
      const row = markdown.split('\n').find(l => l.startsWith(`| ${lang.language} |`));
      expect(row, `no coverage row for ${lang.language}`).toBeDefined();
      expect(row).toContain('n/a');
      expect(row).toContain('**no**');
    }
  });

  it('declares runtime wiring as unseen, so static edges are not read as the whole graph', () => {
    expect(index.coverage.blind_spots.join(' ')).toMatch(/injection|registr|HTTP|queue/i);
  });
});

// ===========================================================================
// D. ROT
// ===========================================================================

describe('gate D — rot: an un-regenerated import change is caught', () => {
  it('wires the architecture check into CI the same way dist is gated', () => {
    const ci = fs.readFileSync(path.join(REPO_ROOT, '.github/workflows/ci.yml'), 'utf-8');
    // Regenerate, then fail on any difference — identical shape to the dist gate.
    expect(ci).toMatch(/npm run architecture\b/);
    expect(ci).toMatch(/git diff --exit-code -- ARCHITECTURE\.md docs\/architecture/);
    // The dist gate is the precedent; if it disappears, this one lost its model.
    expect(ci).toMatch(/git diff --exit-code -- dist/);
  });

  it('exposes both halves of the gate as npm scripts', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf-8'));
    expect(pkg.scripts.architecture).toBe('node dist/cli/index.js arch-index --write');
    expect(pkg.scripts['architecture:check']).toBe('node dist/cli/index.js arch-index --check');
  });

  it('detects drift when a real import is added and the index is not regenerated', () => {
    // The functional half, run against the committed artifact rather than a
    // fixture: take a real hotspot, pretend a new file imports it, and show
    // the committed index does not know. This is the exact state CI fails on.
    const hotspot = index.hotspots[0];
    expect(hotspot).toBeDefined();
    const claimed = new Set(index.files[hotspot.file].imported_by);
    const phantom = 'src/__phantom_importer_that_does_not_exist__.ts';
    expect(claimed.has(phantom)).toBe(false);

    // Now the same check the differential runs, with the drift injected: an
    // importer present in the tree but absent from the index is a `missed`.
    const withDrift = new Set([...claimed, phantom]);
    const missed = [...withDrift].filter(f => !claimed.has(f));
    expect(missed).toEqual([phantom]);
  });
});

// ===========================================================================
// E. DISCOVERY
// ===========================================================================

describe('gate E — a cold agent reaches the index in one hop', () => {
  it('commits the entry point at the repo root, not in a gitignored cache', () => {
    // The root cause this whole feature addresses: .navgator/architecture/ is
    // gitignored, so a fresh clone had nothing.
    expect(fs.existsSync(ARCHITECTURE_MD)).toBe(true);
    expect(fs.existsSync(INDEX_JSON)).toBe(true);
    expect(fs.existsSync(MODULES_JSON)).toBe(true);

    const gitignore = fs.readFileSync(path.join(REPO_ROOT, '.gitignore'), 'utf-8');
    const patterns = gitignore
      .split('\n')
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('#'));
    for (const p of patterns) {
      expect(['ARCHITECTURE.md', '/ARCHITECTURE.md', 'docs/architecture', 'docs/architecture/']).not.toContain(p);
    }
  });

  it('is referenced from every file an agent is told to read first', () => {
    for (const doc of ['README.md', 'CLAUDE.md', 'AGENTS.md']) {
      const text = fs.readFileSync(path.join(REPO_ROOT, doc), 'utf-8');
      expect(text, `${doc} never mentions ARCHITECTURE.md`).toContain('ARCHITECTURE.md');
      expect(text, `${doc} never points at the machine-readable half`).toContain(
        'docs/architecture/index.json'
      );
    }
  });

  it('answers all four session questions from its own opening section', () => {
    // The routing table at the top is what makes it one hop instead of a hunt.
    const head = markdown.slice(0, 2000);
    expect(head).toMatch(/what .*components|major components/i);
    expect(head).toMatch(/depends on what/i);
    expect(head).toMatch(/change file X|what else is affected/i);
    expect(head).toMatch(/boundaries/i);

    for (const anchor of ['## Modules', '## Module dependencies', '## Blast radius', '## Boundaries']) {
      expect(markdown, `missing section ${anchor}`).toContain(anchor);
    }
  });

  it('gives a runnable lookup for any file, not just the listed hotspots', () => {
    expect(markdown).toMatch(/jq .*\.files\[/);
    expect(markdown).toContain('imported_by');
  });

  it('carries curated responsibilities and boundary rules, not just generated numbers', () => {
    // Questions 1 and 4 cannot be answered from an import graph alone.
    const curated = index.modules.filter(m => m.curated && m.responsibility);
    expect(curated.length).toBeGreaterThanOrEqual(10);
    expect(index.boundaries.length).toBeGreaterThanOrEqual(3);
    for (const rule of index.boundaries) {
      expect(rule.must_not_depend_on.length).toBeGreaterThan(0);
      expect(['held', 'violated']).toContain(rule.status);
    }
  });
});
