/**
 * Rust Code Scanner
 * Builds the navigable architecture of a Rust crate from .rs source:
 * - Modules (`mod foo;`, `pub mod foo { .. }`) → module components
 * - Types (`struct`, `enum`, `trait`) → type components
 * - Trait impls (`impl Trait for Type`) → conforms-to connections
 * - `use` paths → imports (internal crate/self/super) or uses-package (external crate)
 * - LLM API calls (reqwest/HTTP to known providers) → service-call connections
 *
 * Regex/line-based (no rustc) — mirrors the Swift code-scanner contract so the
 * output merges into the same component/connection graph.
 */
import { ScanResult, ProjectMetadata } from '../../types.js';
/**
 * A Cargo dependency node from the package pass (Phase 1), so crate usage in
 * source can be resolved onto the node the manifest produced instead of
 * minting a second, config-less node for the same crate.
 */
export interface RustKnownPackage {
    component_id: string;
    /** The name code uses: the dependency key (`crate_name`), which may differ from the package name. */
    crateName: string;
    /** Repo-relative path of the Cargo.toml that declared it. */
    manifest: string;
}
export declare function scanRustCode(projectRoot: string, walkSet?: Set<string>, knownPackages?: RustKnownPackage[]): Promise<ScanResult & {
    projectMeta: Partial<ProjectMetadata>;
}>;
/**
 * Blank out comments and string/char literals, keeping every newline so line
 * numbers survive. Path heads inside a doc comment or a log string are not
 * usages.
 */
export declare function stripRustNonCode(src: string): string;
/**
 * Expand one `use` tree body (`a::{b, c::{d, e}}`, `x as y`, `a::*`) into
 * its leaf paths. Aliases and globs keep the path up to the alias/glob.
 */
export declare function expandUseTree(body: string): string[];
//# sourceMappingURL=code-scanner.d.ts.map