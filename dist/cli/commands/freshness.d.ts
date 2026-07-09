import { Command } from 'commander';
import { type FreshnessStamp } from '../../freshness/stamp.js';
/** Testable core: append paths to the dirty ledger. */
export declare function runMarkDirty(paths: string[], root: string): Promise<void>;
/** Testable core: run a drain with the real scanner. */
export declare function runDrain(root: string, minIntervalMs?: number): Promise<import("../../freshness/drainer.js").DrainResult>;
/** Testable core: drain repeatedly until the ledger is empty (trailing-edge). */
export declare function runDrainUntilClean(root: string, minIntervalMs?: number): Promise<import("../../freshness/drainer.js").DrainResult[]>;
/** Testable core: return the current stamp (computing a transient one if none). */
export declare function runFreshness(root: string): Promise<FreshnessStamp>;
/**
 * Testable core: populate the enrichment cache by resolving boundary nodes
 * (npm/pip/spm/...) upstream, then return the drift report. This is the
 * network leg of the freshness axis — the offline scan only STAMPS from cache,
 * so this is what makes external enrichment actually resolve. Run it from
 * session-start, a cron, or the external-resolver agent (pinned to haiku).
 */
export declare function runRefreshExternal(root: string, force?: boolean): Promise<import("../../enrich/external-resolver.js").RefreshReport>;
export declare function registerFreshnessCommands(program: Command): void;
//# sourceMappingURL=freshness.d.ts.map