/**
 * NavGator Portfolio Scan
 *
 * Sweeps every repo discovered under a folder through the existing `scan()`
 * entrypoint. Each repo call gets its own lease (scan() acquires/releases it
 * internally — src/scanner.ts:581-583, :2227-2231) and its own registerProject
 * call (src/scanner.ts:2131) — this module never re-acquires a lease and
 * never calls registerProject itself.
 */
import type { PortfolioScanOptions, PortfolioScanResult } from './types.js';
/**
 * Scan every discovered repo under `dir`.
 *
 * Hard-refuses shared storage mode: in shared mode `getStoragePath` ignores
 * `projectRoot` entirely and resolves one path under $HOME
 * (src/config.ts:110-124), so every repo in the sweep would write to — and
 * silently overwrite — the same storage location. Refusing beats a scan
 * that appears to work.
 */
export declare function scanPortfolio(dir: string, opts?: PortfolioScanOptions): Promise<PortfolioScanResult>;
//# sourceMappingURL=scan.d.ts.map