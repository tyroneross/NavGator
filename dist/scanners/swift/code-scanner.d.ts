/**
 * Swift Code Scanner
 * Detects runtime connections in .swift files:
 * - String-keyed deps (UserDefaults, @AppStorage, NotificationCenter, asset names)
 * - Protocol conformance
 * - State observation (@Published, @Observable, @EnvironmentObject)
 * - URLSession calls to LLM APIs
 * - Entitlement requirements from framework usage
 */
import { ScanResult, ProjectMetadata } from '../../types.js';
export declare function scanSwiftCode(projectRoot: string, walkSet?: Set<string>): Promise<ScanResult & {
    projectMeta: Partial<ProjectMetadata>;
}>;
/**
 * Parse the local target graph out of a Package.swift manifest.
 *
 * The manifest is Swift source, not data, so this is a bounded textual parse:
 * find each target declaration, take its argument list by balancing
 * parentheses (skipping string literals and comments), then read the
 * `dependencies:` array inside it. Handles the four dependency spellings SPM
 * accepts: a bare "Name" string, .target(name:), .byName(name:), and
 * .product(name:package:).
 */
export declare function parseSwiftPackageTargets(pkgContent: string): {
    name: string;
    type: string;
    dependencies: string[];
}[];
//# sourceMappingURL=code-scanner.d.ts.map