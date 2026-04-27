/**
 * NPM Package Scanner
 * Detects packages from package.json, yarn.lock, pnpm-lock.yaml
 */
import { ScanResult } from '../../types.js';
/**
 * Scan for npm packages in a project (including monorepo workspaces)
 */
export declare function scanNpmPackages(projectRoot: string): Promise<ScanResult>;
/**
 * Check if npm is used in this project
 */
export declare function detectNpm(projectRoot: string): boolean;
/**
 * Get the package manager type
 */
export declare function detectPackageManager(projectRoot: string): 'npm' | 'yarn' | 'pnpm' | null;
//# sourceMappingURL=npm.d.ts.map