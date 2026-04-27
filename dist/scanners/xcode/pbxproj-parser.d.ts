/**
 * Xcode .pbxproj Parser
 * Parses ASCII plist format used by Xcode project files
 */
import { ArchitectureComponent, ArchitectureConnection } from '../../types.js';
export interface XcodeTarget {
    name: string;
    type: 'app' | 'extension' | 'test' | 'framework' | 'widget' | 'other';
    bundleId?: string;
    productName?: string;
    sourceFiles: string[];
    frameworks: string[];
    deploymentTargets: Record<string, string>;
}
export interface XcodeProjectData {
    targets: XcodeTarget[];
    buildConfigurations: string[];
    hasSwiftPackages: boolean;
}
/**
 * Parse an Xcode .pbxproj file
 */
export declare function parseXcodeProject(pbxprojPath: string): XcodeProjectData;
/**
 * Map an Xcode target to a NavGator component
 */
export declare function mapTargetToComponent(target: XcodeTarget, timestamp: number): ArchitectureComponent;
/**
 * Map source file membership to connections
 */
export declare function mapSourceMembership(target: XcodeTarget, targetCompId: string, timestamp: number): ArchitectureConnection[];
//# sourceMappingURL=pbxproj-parser.d.ts.map