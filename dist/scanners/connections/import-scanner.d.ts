/**
 * NavGator Import Scanner
 * Fast regex-based file-level import graph builder.
 * Extracts import/require/export-from statements and resolves to actual file paths.
 */
import { ScanResult } from '../../types.js';
/**
 * A minimal shape used to resolve bare imports to npm package components.
 * Callers pass { name, component_id } pairs — typically the npm-type components
 * produced by `scanNpmPackages`.
 */
export interface KnownPackage {
    name: string;
    component_id: string;
}
/**
 * Scan source files and build file-level import connections.
 * Accepts the already-discovered source file list from the main scanner
 * to avoid redundant glob and ensure consistent file coverage.
 *
 * When `knownPackages` is provided, bare imports (e.g. `import X from "react"`)
 * are emitted as `uses-package` edges from the source file component to the
 * matching npm package component. Bare specifiers with no matching known
 * package are skipped silently (no ghost nodes).
 */
export declare function scanImports(projectRoot: string, sourceFiles?: string[], knownPackages?: KnownPackage[]): Promise<ScanResult>;
//# sourceMappingURL=import-scanner.d.ts.map