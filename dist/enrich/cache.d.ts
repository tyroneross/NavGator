/**
 * Self-contained enrichment cache for NavGator.
 *
 * Lives entirely inside NavGator — NO dependency on api-registry's registry.db
 * or any external plugin. Backed by a dependency-free JSON file in NavGator's
 * own shared home (`~/.navgator/enrichment-cache.json`), so resolved versions
 * are reused across every repo on the machine (serves "persistent … across any
 * type of app") and a scan never re-fetches what another scan already learned.
 *
 * The structural enrich pass (enrichFromCache) reads this synchronously and
 * offline. Only the freshness path (refreshExternal / the external-resolver
 * agent) writes to it, after hitting the network.
 */
import type { ArchitectureComponent } from '../types.js';
import type { EnrichableType } from './external-enrichment.types.js';
import type { RegistryRecord } from './external-resolver.js';
/** Cache file format (versioned for forward migration). */
export interface EnrichmentCacheFile {
    version: 1;
    /** Keyed by normalized lookup key (see cacheKey). */
    records: Record<string, RegistryRecord>;
}
/** NavGator's own cache location — independent of project storage mode. */
export declare function enrichmentCachePath(): string;
/** Map a component type to the ecosystem its versions resolve from. */
export declare function ecosystemFor(type: string): RegistryRecord['registry'];
/** Deterministic cache key: ecosystem-scoped, lowercased package/service name. */
export declare function cacheKey(type: string, name: string): string;
/** Load the cache (sync, offline). Returns an empty cache if absent/corrupt. */
export declare function loadCache(): EnrichmentCacheFile;
/** Persist the cache atomically-ish (write temp + rename). */
export declare function saveCache(cache: EnrichmentCacheFile): void;
/** Upsert a resolved record by ecosystem+name. */
export declare function upsertRecord(cache: EnrichmentCacheFile, type: EnrichableType, name: string, rec: RegistryRecord): void;
/**
 * Build the offline `lookup` the resolver needs, closed over a loaded cache.
 * Matches a component to its cached record by ecosystem+name, with a fallback
 * to canonical-service match for name-only nodes (service/llm/infra).
 */
export declare function makeLookup(cache: EnrichmentCacheFile): (c: ArchitectureComponent) => RegistryRecord | null;
//# sourceMappingURL=cache.d.ts.map