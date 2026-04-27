/**
 * Python Package Scanner
 * Detects packages from requirements.txt, pyproject.toml, setup.py
 */
import { ScanResult } from '../../types.js';
/**
 * Scan for Python packages in a project
 */
export declare function scanPipPackages(projectRoot: string): Promise<ScanResult>;
/**
 * Check if pip/Python is used in this project
 */
export declare function detectPip(projectRoot: string): boolean;
//# sourceMappingURL=pip.d.ts.map