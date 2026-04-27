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
//# sourceMappingURL=code-scanner.d.ts.map