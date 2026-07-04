/**
 * Cargo Package Scanner
 * Detects Rust crates from Cargo.toml workspaces and package manifests.
 */
import { ScanResult } from '../../types.js';
/**
 * Scan for Rust crates in Cargo.toml manifests.
 */
export declare function scanCargoPackages(projectRoot: string): Promise<ScanResult>;
/**
 * Check if Cargo/Rust is used in this project.
 */
export declare function detectCargo(projectRoot: string): boolean;
//# sourceMappingURL=cargo.d.ts.map