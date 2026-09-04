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
/** Bump when the shape of `docs/architecture/index.json` changes. */
export declare const ARCHITECTURE_INDEX_SCHEMA_VERSION = 1;
/** Repo-relative output paths. Committed; stable by contract. */
export declare const ARCHITECTURE_MD_PATH = "ARCHITECTURE.md";
export declare const ARCHITECTURE_INDEX_PATH = "docs/architecture/index.json";
/** Curated input: human-written module responsibilities and boundary rules. */
export declare const ARCHITECTURE_MODULES_PATH = "docs/architecture/modules.json";
/**
 * Extension to language. The single definition site for this map — do not
 * duplicate it. `src/scanner.ts` imports `LANGUAGE_BY_EXTENSION` and
 * `languageOf` from here rather than keeping its own copy (it used to; see
 * git history around the `SCAN_COVERAGE_LANGUAGE_BY_EXTENSION` removal).
 * Counting a language here does not mean it is ANALYZED — see
 * `ANALYZED_LANGUAGES` below, and `scanner.ts`'s
 * `SCAN_COVERAGE_ANALYZED_LANGUAGES`, which is intentionally a *different*
 * set (see the comment on that constant for why).
 */
export declare const LANGUAGE_BY_EXTENSION: Record<string, string>;
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
    depends_on: Array<{
        module: string;
        edges: number;
    }>;
    dependents: Array<{
        module: string;
        edges: number;
    }>;
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
    violations: Array<{
        from_file: string;
        to_file: string;
        to_module: string;
    }>;
}
export interface ArchitectureIndex {
    schema_version: number;
    generator: string;
    coverage: CoverageReport;
    modules: ModuleEntry[];
    module_edges: Array<{
        from: string;
        to: string;
        edges: number;
    }>;
    hotspots: Array<{
        file: string;
        module: string;
        dependents: number;
    }>;
    boundaries: BoundaryEntry[];
    files: Record<string, FileEntry>;
}
export interface BuildResult {
    index: ArchitectureIndex;
    markdown: string;
}
/**
 * JSON.stringify with keys sorted at every level. `JSON.stringify` preserves
 * insertion order, which would let an unrelated refactor of this file reorder
 * the committed artifact and produce a diff with no semantic content.
 */
export declare function stableStringify(value: unknown): string;
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
export declare function discoverSourceFiles(root: string): Promise<string[]>;
export declare function languageOf(file: string): string | null;
/**
 * Auto-derive a module id when no curated module claims the file: the first
 * two path segments for nested files, the first for one-level-deep files,
 * `.` for repo-root files. One rule, no heuristics, so a reader can reproduce
 * the mapping without reading this code.
 */
export declare function autoModuleId(file: string): string;
export declare function loadCuratedModules(root: string): CuratedModulesFile;
export declare function buildArchitectureIndex(root: string): Promise<BuildResult>;
export declare function renderArchitectureMarkdown(index: ArchitectureIndex): string;
export interface WriteResult {
    changed: string[];
    index: ArchitectureIndex;
}
/** Generate and write both artifacts. Returns the repo-relative paths changed. */
export declare function writeArchitectureIndex(root: string): Promise<WriteResult>;
//# sourceMappingURL=architecture-index.d.ts.map