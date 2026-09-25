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
    /**
     * Source files compiled by the target, relative to the directory that holds
     * the `.xcodeproj` (resolved through the group hierarchy, so a file in a
     * group with `path = ../Shared/X` is `../Shared/X/File.swift`).
     */
    sourceFiles: string[];
    /**
     * Folders the target compiles through an Xcode 16 synchronized group
     * (`fileSystemSynchronizedGroups`): every source file under `path` is a
     * member except the `exclude` entries (paths relative to the folder). Same
     * base directory as `sourceFiles`.
     */
    syncedFolders: Array<{
        path: string;
        exclude: string[];
    }>;
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
 * Map source file membership to connections. `target.sourceFiles` must be
 * repo-relative paths of files that exist.
 */
export declare function mapSourceMembership(target: XcodeTarget, targetCompId: string, timestamp: number): ArchitectureConnection[];
//# sourceMappingURL=pbxproj-parser.d.ts.map