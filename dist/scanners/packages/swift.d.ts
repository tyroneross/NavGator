/**
 * Swift Package Scanner
 * Detects packages from Package.swift, Podfile, and framework imports in .swift files
 */
import { ScanResult } from '../../types.js';
/**
 * Check if this is a Swift/Xcode project
 */
export declare function detectSpm(projectRoot: string): boolean;
/**
 * Scan for Swift/iOS/Mac packages
 */
export declare function scanSpmPackages(projectRoot: string): Promise<ScanResult>;
/**
 * Find the Xcode project file in the project root
 * Returns path to project.pbxproj if found, null otherwise
 */
export declare function findXcodeProject(projectRoot: string): string | null;
//# sourceMappingURL=swift.d.ts.map