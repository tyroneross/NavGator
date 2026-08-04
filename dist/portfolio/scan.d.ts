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
/** A registry entry, narrowed to only what the remote-origin check reads. */
export interface RemoteFilterable {
    path: string;
    origin?: {
        kind?: string;
    };
}
/** Result of `excludeRemoteOriginProjects` — kept projects plus the skip count. */
export interface RemoteExclusionResult<T extends RemoteFilterable> {
    /** Projects safe to fan out over. */
    local: T[];
    /** How many registered projects were excluded as remote clones. */
    skippedRemote: number;
}
/**
 * Drop projects whose content came from a `scan-remote` clone, and report how
 * many were dropped.
 *
 * The `dir` branch of both portfolio entrypoints refuses the remote-scan cache
 * root, but that guard does nothing on the no-`dir` fan-out: `scan-remote`
 * REGISTERS the clone, so a remote repo's attacker-authored component names,
 * descriptions, and prompt strings would flow into the cross-repo map — an
 * agent-reachable surface (`navgator portfolio --agent`, the MCP `portfolio`
 * tool) — with no marking at all.
 *
 * Excludes by PATH as well as by flag, deliberately. The `origin` marker alone
 * fails open: scanRemote calls scan() first, and scan() registers the project
 * via registerProject with no origin field (src/scanner.ts) — origin is patched
 * in afterwards by recordRemoteOrigin, whose body swallows every error. Any
 * interruption in that window, a dashboard-initiated add, or a plain
 * `navgator scan` run inside a clone directory all leave a remote clone
 * registered UNMARKED. Measured: such an entry was included in this map. The
 * cache root is the durable signal, and the `dir` branch already treats it as
 * one. Do not "simplify" this to the flag check alone.
 *
 * Callers get the count back rather than a pre-formatted string because
 * silently dropping registered projects is its own trust problem — every
 * surface must show the skip. `formatRemoteExclusionNote` supplies the shared
 * wording.
 */
export declare function excludeRemoteOriginProjects<T extends RemoteFilterable>(projects: readonly T[]): RemoteExclusionResult<T>;
/**
 * The one wording for "we dropped N projects and here's why", shared by every
 * portfolio surface. Returns null when nothing was skipped so callers can omit
 * the field/line entirely rather than print an empty note.
 */
export declare function formatRemoteExclusionNote(skippedRemote: number): string | null;
/**
 * Scan every discovered repo under `dir`.
 *
 * Hard-refuses shared storage mode via `assertLocalStorageMode` — see that
 * function's doc comment for why.
 */
export declare function scanPortfolio(dir: string, opts?: PortfolioScanOptions): Promise<PortfolioScanResult>;
//# sourceMappingURL=scan.d.ts.map