/**
 * NavGator Architecture Index — the committed, version-controlled answer to
 * "what is this codebase and what breaks if I change file X".
 *
 * WHY THIS EXISTS
 * ---------------
 * NavGator's own scan output lives under `.navgator/architecture/`, which is
 * gitignored: it carries wall-clock timestamps, per-run ids, and env-derived
 * hostnames, so it is a per-clone CACHE, not a shared artifact. The
 * consequence is that a fresh clone — or a mid-tier subagent dispatched with
 * no prior context — finds nothing at all until somebody remembers to run a
 * scan. This module produces the missing half: a small, deterministic
 * PROJECTION of the same scan data that is safe to commit, cheap to review,
 * and readable by a Sonnet/Terra-tier agent without loading a 10K-node graph.
 *
 * It is a derived view, not a second source of truth. Every fact here comes
 * from the same `scanImports` pass the rest of NavGator uses.
 *
 * DETERMINISM CONTRACT (enforced by src/__tests__/architecture-index.test.ts)
 * --------------------------------------------------------------------------
 * Two runs over an unchanged tree MUST produce byte-identical output. That
 * means: no timestamps, no absolute paths, no run ids, no machine-specific
 * values, no iteration order that depends on the filesystem. Every collection
 * is explicitly sorted and every JSON object is serialized with sorted keys.
 * A generated artifact that churns on every run is worse than none, because
 * reviewers learn to skip it in review.
 *
 * HONESTY CONTRACT
 * ----------------
 * A scan that measured nothing must not read as a healthy architecture.
 * `coverage.status` is `none` when no internal edge was found at all and
 * `partial` when a language is present in the tree but produced no edges
 * (NavGator's TS/JS import scanner emits no internal edges for Swift, Rust,
 * Python, ... — so "no edges" there means "not measured", never "not
 * coupled"). Both states are stated at the top of ARCHITECTURE.md.
 */

import * as fs from 'fs';
import * as path from 'path';
import { scanImports } from './scanners/connections/import-scanner.js';

/** Bump when the shape of `docs/architecture/index.json` changes. */
export const ARCHITECTURE_INDEX_SCHEMA_VERSION = 1;

/** Repo-relative output paths. Committed; stable by contract. */
export const ARCHITECTURE_MD_PATH = 'ARCHITECTURE.md';
export const ARCHITECTURE_INDEX_PATH = 'docs/architecture/index.json';
/** Curated input: human-written module responsibilities and boundary rules. */
export const ARCHITECTURE_MODULES_PATH = 'docs/architecture/modules.json';

/** Directories that are build output, vendored code, or agent-tool state. */
const IGNORED_GLOBS = [
  '**/node_modules/**',
  '**/.git/**',
  '**/dist/**',
  '**/build/**',
  '**/.next/**',
  '**/coverage/**',
  '**/fixtures/**',
  'web/runtime/**',
  '.navgator/**',
  '.build-loop/**',
  '.rally/**',
  '.codex/**',
  '.bookmark/**',
  '.procedural/**',
  '.claude-code-debugger/**',
  '**/__pycache__/**',
];

/**
 * Extension to language. Only TypeScript and JavaScript are ANALYZED (the
 * import scanner is a TS/JS scanner); everything else is counted so the
 * coverage section can name what it could not see.
 */
const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  '.ts': 'TypeScript',
  '.tsx': 'TypeScript',
  '.mts': 'TypeScript',
  '.cts': 'TypeScript',
  '.js': 'JavaScript',
  '.jsx': 'JavaScript',
  '.mjs': 'JavaScript',
  '.cjs': 'JavaScript',
  '.py': 'Python',
  '.swift': 'Swift',
  '.rs': 'Rust',
  '.go': 'Go',
  '.rb': 'Ruby',
  '.java': 'Java',
  '.kt': 'Kotlin',
  '.cs': 'C#',
  '.php': 'PHP',
  '.c': 'C',
  '.h': 'C',
  '.cc': 'C++',
  '.cpp': 'C++',
  '.hpp': 'C++',
  '.sh': 'Shell',
  '.bash': 'Shell',
  '.sql': 'SQL',
};

const ANALYZED_LANGUAGES = new Set(['TypeScript', 'JavaScript']);

// ---------------------------------------------------------------------------
// Public shapes
// ---------------------------------------------------------------------------

export interface CuratedModule {
  /** Stable id. Conventionally equal to `path`. */
  id: string;
  /** Repo-relative directory prefix. Longest prefix wins when files overlap. */
  path: string;
  /** One sentence: what is this module responsible for? */
  responsibility: string;
}

export interface CuratedBoundary {
  id: string;
  /** Module id the rule constrains. */
  from: string;
  /** Module ids `from` must not depend on. */
  must_not_depend_on: string[];
  /** Why the boundary exists — the part a reader cannot re-derive. */
  why: string;
}

export interface CuratedModulesFile {
  modules?: CuratedModule[];
  boundaries?: CuratedBoundary[];
}

export interface LanguageCoverage {
  language: string;
  files: number;
  analyzed: boolean;
  internal_edges: number;
}

export interface CoverageReport {
  /** `full` = every present language was analyzed and produced edges. */
  status: 'full' | 'partial' | 'none';
  analyzed_files: number;
  internal_edges: number;
  languages: LanguageCoverage[];
  /** Plain-language statements of what this index could NOT see. */
  blind_spots: string[];
}

export interface ModuleEntry {
  id: string;
  path: string;
  /** Null when nobody has curated this module in modules.json yet. */
  responsibility: string | null;
  curated: boolean;
  files: number;
  /** Highest-fan-in files in the module — where to start reading. */
  key_files: string[];
  depends_on: Array<{ module: string; edges: number }>;
  dependents: Array<{ module: string; edges: number }>;
}

export interface FileEntry {
  module: string;
  imports: string[];
  imported_by: string[];
  type_only_imports: string[];
}

export interface BoundaryEntry {
  id: string;
  from: string;
  must_not_depend_on: string[];
  why: string;
  status: 'held' | 'violated';
  violations: Array<{ from_file: string; to_file: string; to_module: string }>;
}

export interface ArchitectureIndex {
  schema_version: number;
  generator: string;
  coverage: CoverageReport;
  modules: ModuleEntry[];
  module_edges: Array<{ from: string; to: string; edges: number }>;
  hotspots: Array<{ file: string; module: string; dependents: number }>;
  boundaries: BoundaryEntry[];
  files: Record<string, FileEntry>;
}

export interface BuildResult {
  index: ArchitectureIndex;
  markdown: string;
}

// ---------------------------------------------------------------------------
// Deterministic serialization
// ---------------------------------------------------------------------------

/**
 * JSON.stringify with keys sorted at every level. `JSON.stringify` preserves
 * insertion order, which would let an unrelated refactor of this file reorder
 * the committed artifact and produce a diff with no semantic content.
 */
export function stableStringify(value: unknown): string {
  const normalize = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(normalize);
    if (input && typeof input === 'object') {
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(input as Record<string, unknown>).sort()) {
        out[key] = normalize((input as Record<string, unknown>)[key]);
      }
      return out;
    }
    return input;
  };
  return `${JSON.stringify(normalize(value), null, 2)}\n`;
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}

/**
 * All source files under `root`, sorted. Sorting is what makes runs stable.
 *
 * TRACKED FILES ONLY. This index is COMMITTED, so it must describe the
 * repository, not the machine that generated it. `IGNORED_GLOBS` below is a
 * hand-maintained list and drifts from `.gitignore` by construction — it did:
 * `web/server.cjs` is generated by `build:standalone`, excluded by
 * `.gitignore`, and absent from that list, so it was indexed. Every CI run then
 * failed on a clean checkout reading a file that exists only where the index
 * was built.
 *
 * `git ls-files` is the authoritative answer to "what is in this repo", so it
 * is asked rather than approximated. Falls back to the glob when git cannot
 * answer (no repo, no git binary), because the generator must still work on an
 * extracted tarball — and says so, since a silent fallback would hide exactly
 * the drift this exists to remove.
 */
export async function discoverSourceFiles(root: string): Promise<string[]> {
  const { glob } = await import('glob');
  const extensions = Object.keys(LANGUAGE_BY_EXTENSION).map(e => e.slice(1)).sort();
  const found = await glob(`**/*.{${extensions.join(',')}}`, {
    cwd: root,
    ignore: IGNORED_GLOBS,
    nodir: true,
    dot: false,
  });
  const globbed = [...new Set(found.map(toPosix))].sort();

  let tracked: Set<string> | null = null;
  try {
    const { execFileSync } = await import('node:child_process');
    const out = execFileSync('git', ['-C', root, 'ls-files', '-z'], {
      encoding: 'utf-8',
      maxBuffer: 64 * 1024 * 1024,
    });
    const names = out.split('\0').filter(Boolean).map(toPosix);
    if (names.length > 0) tracked = new Set(names);
  } catch {
    tracked = null;
  }

  if (tracked === null) {
    process.stderr.write(
      'arch-index: git could not list tracked files; falling back to filesystem glob. ' +
        'The index may include files absent from a clean checkout.\n',
    );
    return globbed;
  }
  return globbed.filter(f => tracked.has(f));
}

function languageOf(file: string): string | null {
  return LANGUAGE_BY_EXTENSION[path.extname(file).toLowerCase()] ?? null;
}

// ---------------------------------------------------------------------------
// Module assignment
// ---------------------------------------------------------------------------

/**
 * Auto-derive a module id when no curated module claims the file: the first
 * two path segments for nested files, the first for one-level-deep files,
 * `.` for repo-root files. One rule, no heuristics, so a reader can reproduce
 * the mapping without reading this code.
 */
export function autoModuleId(file: string): string {
  const segments = file.split('/');
  if (segments.length === 1) return '.';
  if (segments.length === 2) return segments[0];
  return `${segments[0]}/${segments[1]}`;
}

function assignModule(file: string, curated: CuratedModule[]): { id: string; curated: boolean } {
  let best: CuratedModule | null = null;
  for (const mod of curated) {
    // `.` is the repo root: it claims top-level files only, never the whole
    // tree, so declaring it cannot swallow every other module.
    if (mod.path === '.') {
      if (!file.includes('/') && !best) best = mod;
      continue;
    }
    const prefix = mod.path.endsWith('/') ? mod.path : `${mod.path}/`;
    const matches = file === mod.path || file.startsWith(prefix);
    if (!matches) continue;
    if (!best || mod.path.length > best.path.length) best = mod;
  }
  if (best) return { id: best.id, curated: true };
  return { id: autoModuleId(file), curated: false };
}

export function loadCuratedModules(root: string): CuratedModulesFile {
  const file = path.join(root, ARCHITECTURE_MODULES_PATH);
  if (!fs.existsSync(file)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as CuratedModulesFile;
    return {
      modules: Array.isArray(parsed.modules) ? parsed.modules : [],
      boundaries: Array.isArray(parsed.boundaries) ? parsed.boundaries : [],
    };
  } catch {
    // A malformed curation file degrades to "uncurated" rather than failing
    // the build — the generated facts are still worth having.
    return {};
  }
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

/** How many highest-fan-in files to name per module, and repo-wide. */
const KEY_FILES_PER_MODULE = 3;
const HOTSPOT_LIMIT = 20;

export async function buildArchitectureIndex(root: string): Promise<BuildResult> {
  const allFiles = await discoverSourceFiles(root);
  const curatedFile = loadCuratedModules(root);
  const curatedModules = [...(curatedFile.modules ?? [])].sort((a, b) => a.path.localeCompare(b.path));
  const curatedBoundaries = [...(curatedFile.boundaries ?? [])].sort((a, b) => a.id.localeCompare(b.id));

  const analyzedFiles = allFiles.filter(f => {
    const lang = languageOf(f);
    return lang !== null && ANALYZED_LANGUAGES.has(lang) && !f.endsWith('.d.ts');
  });

  const scan = await scanImports(root, analyzedFiles);

  // Only internal file-to-file import edges. `uses-package` edges point at npm
  // packages, which is a dependency question, not an internal-structure one.
  const analyzedSet = new Set(analyzedFiles);
  const importsOf = new Map<string, Set<string>>();
  const typeOnlyOf = new Map<string, Set<string>>();
  const importedBy = new Map<string, Set<string>>();
  for (const file of analyzedFiles) {
    importsOf.set(file, new Set());
    typeOnlyOf.set(file, new Set());
    importedBy.set(file, new Set());
  }

  for (const conn of scan.connections) {
    if (conn.connection_type !== 'imports') continue;
    const from = conn.from.location?.file ? toPosix(conn.from.location.file) : null;
    const to = conn.to.location?.file ? toPosix(conn.to.location.file) : null;
    if (!from || !to || from === to) continue;
    if (!analyzedSet.has(from) || !analyzedSet.has(to)) continue;
    importsOf.get(from)!.add(to);
    importedBy.get(to)!.add(from);
    if (conn.runtime_relevance === 'type-only') typeOnlyOf.get(from)!.add(to);
  }

  // Count deduplicated edges, not raw connection records: two import
  // statements for the same target are one dependency.
  let internalEdges = 0;
  for (const file of analyzedFiles) internalEdges += importsOf.get(file)!.size;

  // --- coverage -----------------------------------------------------------
  const filesByLanguage = new Map<string, string[]>();
  for (const file of allFiles) {
    const lang = languageOf(file);
    if (!lang) continue;
    if (!filesByLanguage.has(lang)) filesByLanguage.set(lang, []);
    filesByLanguage.get(lang)!.push(file);
  }

  const languages: LanguageCoverage[] = [...filesByLanguage.entries()]
    .map(([language, files]) => {
      const analyzed = ANALYZED_LANGUAGES.has(language);
      const edges = analyzed
        ? files.reduce((sum, f) => sum + (importsOf.get(f)?.size ?? 0), 0)
        : 0;
      return { language, files: files.length, analyzed, internal_edges: edges };
    })
    .sort((a, b) => a.language.localeCompare(b.language));

  const blindSpots: string[] = [];
  let unmeasured = false;
  for (const lang of languages) {
    if (!lang.analyzed) {
      unmeasured = true;
      blindSpots.push(
        `${lang.files} ${lang.language} file(s) are present but NOT analyzed. NavGator's ` +
        `import scanner is TypeScript/JavaScript only, so zero ${lang.language} edges here ` +
        `means "not measured", never "not coupled".`
      );
    } else if (lang.files > 0 && lang.internal_edges === 0) {
      unmeasured = true;
      blindSpots.push(
        `${lang.files} ${lang.language} file(s) were analyzed but produced zero internal ` +
        `edges. Either those files genuinely import nothing local, or the scanner missed ` +
        `them — this index cannot tell the two apart, so do not read the absence as low coupling.`
      );
    }
  }
  blindSpots.push(
    'Only static import/require/re-export edges are indexed. Runtime wiring — dependency ' +
    'injection, string-keyed registries, HTTP calls, queue topics — is not.'
  );
  blindSpots.push(
    'Edges come from matching import syntax in raw file text, not from a compiler, so a ' +
    'specifier inside a comment or a string literal counts as an edge. The error runs in ' +
    'the safe direction — blast radius over-reports dependents rather than hiding them — ' +
    'but a listed dependent may be a commented-out import or a test fixture string.'
  );
  blindSpots.sort();

  const status: CoverageReport['status'] =
    internalEdges === 0 ? 'none' : unmeasured ? 'partial' : 'full';

  const coverage: CoverageReport = {
    status,
    analyzed_files: analyzedFiles.length,
    internal_edges: internalEdges,
    languages,
    blind_spots: blindSpots,
  };

  // --- module assignment --------------------------------------------------
  const moduleOfFile = new Map<string, string>();
  for (const file of analyzedFiles) {
    moduleOfFile.set(file, assignModule(file, curatedModules).id);
  }

  const curatedIds = new Set(curatedModules.map(m => m.id));
  const responsibilityOf = new Map<string, string>();
  const pathOf = new Map<string, string>();
  for (const mod of curatedModules) {
    responsibilityOf.set(mod.id, mod.responsibility);
    pathOf.set(mod.id, mod.path);
  }

  // A curated module with zero matching files still belongs in the table —
  // its emptiness is the signal that curation has drifted from the tree.
  const moduleIds = [...new Set([
    ...moduleOfFile.values(),
    ...curatedModules.map(m => m.id),
  ])].sort();

  const filesInModule = new Map<string, string[]>();
  for (const id of moduleIds) filesInModule.set(id, []);
  for (const file of analyzedFiles) filesInModule.get(moduleOfFile.get(file)!)!.push(file);

  // --- module edges -------------------------------------------------------
  const moduleEdgeCount = new Map<string, number>();
  const boundaryEvidence = new Map<string, Array<{ from_file: string; to_file: string }>>();
  for (const file of analyzedFiles) {
    const fromModule = moduleOfFile.get(file)!;
    for (const target of [...importsOf.get(file)!].sort()) {
      const toModule = moduleOfFile.get(target)!;
      if (fromModule === toModule) continue;
      const key = `${fromModule} ${toModule}`;
      moduleEdgeCount.set(key, (moduleEdgeCount.get(key) ?? 0) + 1);
      if (!boundaryEvidence.has(key)) boundaryEvidence.set(key, []);
      boundaryEvidence.get(key)!.push({ from_file: file, to_file: target });
    }
  }

  const moduleEdges = [...moduleEdgeCount.entries()]
    .map(([key, edges]) => {
      const [from, to] = key.split(' ');
      return { from, to, edges };
    })
    .sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));

  const modules: ModuleEntry[] = moduleIds.map(id => {
    const files = filesInModule.get(id)!.slice().sort();
    const keyFiles = files
      .slice()
      .sort((a, b) => (importedBy.get(b)!.size - importedBy.get(a)!.size) || a.localeCompare(b))
      .filter(f => importedBy.get(f)!.size > 0)
      .slice(0, KEY_FILES_PER_MODULE);
    return {
      id,
      path: pathOf.get(id) ?? id,
      responsibility: responsibilityOf.get(id) ?? null,
      curated: curatedIds.has(id),
      files: files.length,
      key_files: keyFiles,
      depends_on: moduleEdges
        .filter(e => e.from === id)
        .map(e => ({ module: e.to, edges: e.edges }))
        .sort((a, b) => b.edges - a.edges || a.module.localeCompare(b.module)),
      dependents: moduleEdges
        .filter(e => e.to === id)
        .map(e => ({ module: e.from, edges: e.edges }))
        .sort((a, b) => b.edges - a.edges || a.module.localeCompare(b.module)),
    };
  });

  // --- hotspots -----------------------------------------------------------
  const hotspots = analyzedFiles
    .map(file => ({
      file,
      module: moduleOfFile.get(file)!,
      dependents: importedBy.get(file)!.size,
    }))
    .filter(h => h.dependents > 0)
    .sort((a, b) => b.dependents - a.dependents || a.file.localeCompare(b.file))
    .slice(0, HOTSPOT_LIMIT);

  // --- boundaries ---------------------------------------------------------
  const boundaries: BoundaryEntry[] = curatedBoundaries.map(rule => {
    const forbidden = [...rule.must_not_depend_on].sort();
    const violations: BoundaryEntry['violations'] = [];
    for (const target of forbidden) {
      const evidence = boundaryEvidence.get(`${rule.from} ${target}`) ?? [];
      for (const pair of evidence) {
        violations.push({ from_file: pair.from_file, to_file: pair.to_file, to_module: target });
      }
    }
    violations.sort((a, b) => a.from_file.localeCompare(b.from_file) || a.to_file.localeCompare(b.to_file));
    return {
      id: rule.id,
      from: rule.from,
      must_not_depend_on: forbidden,
      why: rule.why,
      status: violations.length > 0 ? 'violated' : 'held',
      violations,
    };
  });

  // --- file index ---------------------------------------------------------
  const files: Record<string, FileEntry> = {};
  for (const file of analyzedFiles) {
    files[file] = {
      module: moduleOfFile.get(file)!,
      imports: [...importsOf.get(file)!].sort(),
      imported_by: [...importedBy.get(file)!].sort(),
      type_only_imports: [...typeOnlyOf.get(file)!].sort(),
    };
  }

  const index: ArchitectureIndex = {
    schema_version: ARCHITECTURE_INDEX_SCHEMA_VERSION,
    generator: 'navgator arch-index',
    coverage,
    modules,
    module_edges: moduleEdges,
    hotspots,
    boundaries,
    files,
  };

  return { index, markdown: renderArchitectureMarkdown(index) };
}

// ---------------------------------------------------------------------------
// Markdown rendering — the entry point a mid-tier agent actually reads
// ---------------------------------------------------------------------------

const STATUS_LINE: Record<CoverageReport['status'], string> = {
  full: '**Coverage: FULL** — every language present in this tree was analyzed and produced edges.',
  partial: '**Coverage: PARTIAL** — part of this tree was not analyzed. Read the blind spots below before treating any absence of edges as evidence.',
  none: '**Coverage: NONE** — the scan produced no internal edges at all. Do NOT read this as a decoupled codebase; read it as an unmeasured one.',
};

export function renderArchitectureMarkdown(index: ArchitectureIndex): string {
  const lines: string[] = [];
  const push = (s = '') => lines.push(s);

  push('# Architecture');
  push();
  push('<!-- GENERATED FILE - do not hand-edit. -->');
  push('<!-- Regenerate: `npm run architecture` (or `navgator arch-index --write`). -->');
  push('<!-- Curated input (responsibilities, boundaries): docs/architecture/modules.json -->');
  push('<!-- Machine-readable index: docs/architecture/index.json -->');
  push();
  push('**Start here if you are new to this repo.** This file answers four questions without');
  push('running a scan: what the major components are, what depends on what, what a change to a');
  push('given file can break, and which boundaries must not be crossed.');
  push();
  push('| Question | Where to look |');
  push('|---|---|');
  push('| What are the major components, and what is each responsible for? | [Modules](#modules) |');
  push('| What depends on what? | [Module dependencies](#module-dependencies) |');
  push('| If I change file X, what else is affected? | [Blast radius](#blast-radius), then the per-file lookup in `docs/architecture/index.json` |');
  push('| Which boundaries must I not cross? | [Boundaries](#boundaries) |');
  push();

  // --- coverage -----------------------------------------------------------
  push('## Coverage and blind spots');
  push();
  push(STATUS_LINE[index.coverage.status]);
  push();
  push(`${index.coverage.analyzed_files} files analyzed, ${index.coverage.internal_edges} internal import edges.`);
  push();
  push('| Language | Files | Analyzed | Internal edges |');
  push('|---|---:|---|---:|');
  for (const lang of index.coverage.languages) {
    push(`| ${lang.language} | ${lang.files} | ${lang.analyzed ? 'yes' : '**no**'} | ${lang.analyzed ? String(lang.internal_edges) : 'n/a'} |`);
  }
  push();
  push('What this index cannot see:');
  push();
  for (const spot of index.coverage.blind_spots) push(`- ${spot}`);
  push();

  // --- modules ------------------------------------------------------------
  push('## Modules');
  push();
  push('A module is a curated directory from `docs/architecture/modules.json`, or — where nobody');
  push('has curated one — the file\'s first two path segments. Uncurated rows are marked; give');
  push('them a responsibility in `docs/architecture/modules.json`.');
  push();
  push('| Module | Files | Responsibility | Start reading at |');
  push('|---|---:|---|---|');
  for (const mod of index.modules) {
    const responsibility = mod.responsibility ?? '_uncurated - add it to docs/architecture/modules.json_';
    const keys = mod.key_files.length > 0 ? mod.key_files.map(f => `\`${f}\``).join('<br>') : '-';
    push(`| \`${mod.id}\` | ${mod.files} | ${responsibility} | ${keys} |`);
  }
  push();

  // --- module dependencies -----------------------------------------------
  push('## Module dependencies');
  push();
  push('Read as "the module on the left imports from the modules on the right"; the number is how');
  push('many file-level import edges cross that pair.');
  push();
  for (const mod of index.modules) {
    if (mod.depends_on.length === 0) continue;
    const deps = mod.depends_on.map(d => `\`${d.module}\` (${d.edges})`).join(', ');
    push(`- \`${mod.id}\` imports ${deps}`);
  }
  const leaves = index.modules.filter(m => m.depends_on.length === 0 && m.files > 0);
  if (leaves.length > 0) {
    push();
    push(`Leaf modules (they import nothing internal): ${leaves.map(m => `\`${m.id}\``).join(', ')}`);
  }
  push();

  // --- blast radius -------------------------------------------------------
  push('## Blast radius');
  push();
  push('Highest-fan-in files. Changing one of these can affect every file listed as its dependent.');
  push();
  push('| File | Module | Direct dependents |');
  push('|---|---|---:|');
  for (const hot of index.hotspots) {
    push(`| \`${hot.file}\` | \`${hot.module}\` | ${hot.dependents} |`);
  }
  push();
  push('For any file, not just these, look it up in `docs/architecture/index.json`:');
  push();
  push('```bash');
  push('# What does src/storage.ts import, and who imports it?');
  push('jq \'.files["src/storage.ts"]\' docs/architecture/index.json');
  push('');
  push('# Direct dependents only (the first ring of blast radius)');
  push('jq -r \'.files["src/storage.ts"].imported_by[]\' docs/architecture/index.json');
  push('```');
  push();
  push('For the transitive ring, or for edges this static index does not carry, run the live tool:');
  push('`navgator impact <component>` and `navgator trace <component>`.');
  push();

  // --- boundaries ---------------------------------------------------------
  push('## Boundaries');
  push();
  if (index.boundaries.length === 0) {
    push('No boundary rules are declared yet. Add them under `boundaries` in');
    push('`docs/architecture/modules.json`; each one is re-checked on every regeneration and');
    push('enforced in CI.');
  } else {
    push('| Rule | Constraint | Status | Why |');
    push('|---|---|---|---|');
    for (const rule of index.boundaries) {
      const constraint = `\`${rule.from}\` must not depend on ${rule.must_not_depend_on.map(m => `\`${m}\``).join(', ')}`;
      const status = rule.status === 'held' ? 'held' : `**VIOLATED (${rule.violations.length})**`;
      push(`| ${rule.id} | ${constraint} | ${status} | ${rule.why} |`);
    }
    const violated = index.boundaries.filter(r => r.status === 'violated');
    if (violated.length > 0) {
      push();
      push('Violations:');
      push();
      for (const rule of violated) {
        for (const v of rule.violations) {
          push(`- \`${rule.id}\`: \`${v.from_file}\` imports \`${v.to_file}\` (module \`${v.to_module}\`)`);
        }
      }
    }
  }
  push();
  push('---');
  push();
  push(`Generated by \`${index.generator}\`, schema v${index.schema_version}. Carries no timestamp by`);
  push('design: the artifact is byte-stable across runs, so its diff only ever shows real');
  push('architecture change. CI regenerates it and fails if the committed copy differs.');
  push();

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

export interface WriteResult {
  changed: string[];
  index: ArchitectureIndex;
}

/** Generate and write both artifacts. Returns the repo-relative paths changed. */
export async function writeArchitectureIndex(root: string): Promise<WriteResult> {
  const { index, markdown } = await buildArchitectureIndex(root);
  const changed: string[] = [];

  const targets: Array<[string, string]> = [
    [ARCHITECTURE_MD_PATH, markdown],
    [ARCHITECTURE_INDEX_PATH, stableStringify(index)],
  ];

  for (const [relative, content] of targets) {
    const absolute = path.join(root, relative);
    const existing = fs.existsSync(absolute) ? fs.readFileSync(absolute, 'utf-8') : null;
    if (existing === content) continue;
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, content, 'utf-8');
    changed.push(relative);
  }

  return { changed, index };
}
