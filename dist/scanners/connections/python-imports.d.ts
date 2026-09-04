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
export declare const PYTHON_STDLIB_MODULES: ReadonlySet<string>;
/**
 * Extract every import statement from Python source. Line-based, not a
 * parser: comments and triple-quoted strings are stripped first, then two
 * patterns (`from ... import ...` and plain `import ...`) are matched per
 * line, with the `from` form allowed to span multiple physical lines when
 * the name list is parenthesized.
 */
export declare function extractPythonImports(content: string): PythonImportSpec[];
/**
 * Resolve one import spec to a repo-relative file path, or null when it
 * doesn't match anything the scan actually saw. Never touches the
 * filesystem — an unresolved target produces no edge (no ghost nodes),
 * mirroring the TS/JS resolver's contract exactly.
 */
export declare function resolvePythonImport(spec: PythonImportSpec, importerFile: string, knownFiles: ReadonlySet<string>): string | null;
/**
 * First dotted segment of an absolute import, for `uses-package` edges.
 * Relative imports and stdlib modules never point at a package — both
 * return null so the caller emits nothing rather than a wrong edge.
 */
export declare function pythonPackageHead(spec: PythonImportSpec): string | null;
//# sourceMappingURL=python-imports.d.ts.map