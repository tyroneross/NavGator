/**
 * External resolver — the populator that turns NavGator's opaque boundary nodes
 * into live, versioned, dated, doc-linked facts.
 *
 * It has TWO entry points, one per self-update axis:
 *
 *   1. enrichFromCache()   — STRUCTURAL axis. Pure-local, offline, fast.
 *      Hook: src/scanner.ts, in scan(), just before "Store final state"
 *      (~line 1546). Runs every scan over the final deduped component set,
 *      stamping cached identity/version/docs. Never touches the network, so it
 *      never slows a scan.
 *
 *   2. refreshFreshness()  — FRESHNESS axis. Network, time-triggered.
 *      Hook: src/scanner.ts autoRefreshIfStale() (~line 2070), plus the
 *      SessionStart staleness sweep. Re-checks upstream versions for nodes whose
 *      freshness window has elapsed — EVEN WHEN NO FILE CHANGED. This is the
 *      axis that makes the map "self-updating on the world changing," not just
 *      on the repo changing. Delegate the actual fetch to the external-resolver
 *      AGENT (agents/external-resolver.md) so network work runs isolated.
 *
 * Everything here is SELF-CONTAINED inside NavGator: the cache is NavGator's own
 * JSON store (src/enrich/cache.ts → ~/.navgator/enrichment-cache.json) and the
 * fetchers are vendored (src/enrich/fetchers.ts). No api-registry / external
 * plugin dependency. See docs/external-enrichment-fold.md.
 */
import type { ArchitectureComponent } from '../types.js';
import { type ExternalEnrichment, type Freshness } from './external-enrichment.types.js';
import { type EnrichmentCacheFile } from './cache.js';
/** A cache row from the api-registry registry, keyed by canonical service. */
export interface RegistryRecord {
    canonical_service: string;
    registry: ExternalEnrichment['registry'];
    package_ids: ExternalEnrichment['package_ids'];
    latest_version?: string;
    latest_released_at?: string;
    context7_id?: string;
    docs_url?: string;
    last_checked: number;
    author_owned?: boolean;
}
/** Narrow a component to an enrichable boundary node. */
export declare function isEnrichable(c: ArchitectureComponent): boolean;
/**
 * Deterministic freshness from timestamps + version comparison. No network.
 * Exported so it can be unit-tested in isolation (the one piece of real logic).
 */
export declare function computeFreshness(now: number, enrichment: Pick<ExternalEnrichment, 'last_checked' | 'freshness_window_ms' | 'latest_version'>, installedVersion?: string): Freshness;
/**
 * STRUCTURAL axis. Stamp every enrichable node from the registry cache.
 * Mutates components in place; returns the count enriched. Offline + sync-fast.
 *
 * @param lookup  resolve a component to a cached registry record (or null).
 *                Injected so this module never imports the SQLite layer directly.
 */
export declare function enrichFromCache(components: ArchitectureComponent[], lookup: (c: ArchitectureComponent) => RegistryRecord | null, now: number): number;
/**
 * FRESHNESS axis. Returns the nodes whose enrichment is overdue and need an
 * upstream re-check. The orchestrator hands this list to the external-resolver
 * AGENT, which fetches latest versions and writes back into the registry cache;
 * the next enrichFromCache() pass then re-stamps the graph. Kept as a SELECTOR
 * (no network here) so the engine stays deterministic and offline-safe.
 */
export declare function selectStaleForRefresh(components: ArchitectureComponent[], now: number): ArchitectureComponent[];
/** Report from a freshness refresh pass. */
export interface RefreshReport {
    checked: number;
    resolved: number;
    unresolved: number;
    cache_updated: number;
    drift: Array<{
        name: string;
        type: string;
        installed?: string;
        latest?: string;
        bump: 'patch' | 'minor' | 'major';
    }>;
}
/**
 * FRESHNESS axis (network). Self-contained: vendored fetchers + NavGator's own
 * JSON cache. Resolves overdue/unresolved boundary nodes upstream, upserts the
 * cache, and persists it. Returns a drift report. Called by the external-
 * resolver agent or a `navgator refresh-external` command — NOT by scan().
 *
 * For spm/cargo/go nodes the upstream ref is owner/repo (from repository_url);
 * pass a resolver to derive it, else those nodes stay unresolved.
 */
export declare function refreshExternal(components: ArchitectureComponent[], cache: EnrichmentCacheFile, now: number, opts?: {
    force?: boolean;
    githubRefOf?: (c: ArchitectureComponent) => string | null;
}): Promise<RefreshReport>;
/** Best-effort owner/repo from a repository URL. */
export declare function deriveOwnerRepo(repoUrl?: string): string | null;
/** semver-ish bump classification; falls back to 'minor' when unparseable. */
export declare function classifyBump(from: string | undefined, to: string): 'patch' | 'minor' | 'major';
//# sourceMappingURL=external-resolver.d.ts.map