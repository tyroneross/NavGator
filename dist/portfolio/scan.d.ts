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
 * Refuse shared storage mode for any multi-repo portfolio operation.
 *
 * In shared mode `getStoragePath` ignores `projectRoot` entirely and
 * resolves one path under $HOME (src/config.ts:114-118), so every repo
 * touched in a portfolio sweep would read/write the SAME storage location.
 * For a scan that means silent overwrite of the previous repo's
 * architecture data; for a no-scan status read (see
 * src/cli/commands/portfolio.ts) it means every registered project loads
 * identical component/connection data, and `buildCrossRepoMap` fabricates
 * cross-repo sharing and service-call edges that don't exist
 * (src/portfolio/cross-repo.ts). Refusing beats either failure mode
 * appearing to work.
 *
 * Exported so every portfolio entrypoint that fans out across registered
 * projects — the CLI's no-dir status path and the MCP `portfolio` tool —
 * can call the same guard instead of re-deriving the shared-mode check.
 */
export declare function assertLocalStorageMode(config: {
    storageMode: string;
}): void;
/**
 * Scan every discovered repo under `dir`.
 *
 * Hard-refuses shared storage mode via `assertLocalStorageMode` — see that
 * function's doc comment for why.
 */
export declare function scanPortfolio(dir: string, opts?: PortfolioScanOptions): Promise<PortfolioScanResult>;
//# sourceMappingURL=scan.d.ts.map