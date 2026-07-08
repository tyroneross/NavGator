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
export declare function scanRustCode(projectRoot: string, walkSet?: Set<string>): Promise<ScanResult & {
    projectMeta: Partial<ProjectMetadata>;
}>;
//# sourceMappingURL=code-scanner.d.ts.map