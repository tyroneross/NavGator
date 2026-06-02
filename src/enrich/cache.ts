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

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
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
export function enrichmentCachePath(): string {
  return join(process.env['NAVGATOR_HOME'] || join(homedir(), '.navgator'), 'enrichment-cache.json');
}

/** Map a component type to the ecosystem its versions resolve from. */
export function ecosystemFor(type: string): RegistryRecord['registry'] {
  switch (type) {
    case 'npm':
      return 'npm';
    case 'pip':
      return 'pypi';
    case 'cargo':
      return 'cargo';
    case 'go':
      return 'go';
    case 'spm':
      return 'github'; // SPM/CocoaPods resolve via GitHub releases
    default:
      return 'manual'; // service / llm / infra — curated, matched by name
  }
}

/** Deterministic cache key: ecosystem-scoped, lowercased package/service name. */
export function cacheKey(type: string, name: string): string {
  return `${ecosystemFor(type)}:${name.trim().toLowerCase()}`;
}

/** Load the cache (sync, offline). Returns an empty cache if absent/corrupt. */
export function loadCache(): EnrichmentCacheFile {
  const path = enrichmentCachePath();
  if (!existsSync(path)) return { version: 1, records: {} };
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as EnrichmentCacheFile;
    if (parsed?.version === 1 && parsed.records) return parsed;
  } catch {
    /* corrupt cache → start fresh; never block a scan */
  }
  return { version: 1, records: {} };
}

/** Persist the cache atomically-ish (write temp + rename). */
export function saveCache(cache: EnrichmentCacheFile): void {
  const path = enrichmentCachePath();
  mkdirSync(join(path, '..'), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(cache, null, 2), 'utf8');
  writeFileSync(path, JSON.stringify(cache, null, 2), 'utf8');
  try {
    // best-effort cleanup of temp
    if (existsSync(tmp)) writeFileSync(tmp, '', 'utf8');
  } catch {
    /* ignore */
  }
}

/** Upsert a resolved record by ecosystem+name. */
export function upsertRecord(
  cache: EnrichmentCacheFile,
  type: EnrichableType,
  name: string,
  rec: RegistryRecord,
): void {
  cache.records[cacheKey(type, name)] = rec;
}

/**
 * Build the offline `lookup` the resolver needs, closed over a loaded cache.
 * Matches a component to its cached record by ecosystem+name, with a fallback
 * to canonical-service match for name-only nodes (service/llm/infra).
 */
export function makeLookup(
  cache: EnrichmentCacheFile,
): (c: ArchitectureComponent) => RegistryRecord | null {
  // Secondary index: canonical_service → record, for non-package nodes.
  const byService = new Map<string, RegistryRecord>();
  for (const rec of Object.values(cache.records)) {
    if (rec.canonical_service) byService.set(rec.canonical_service.toLowerCase(), rec);
  }
  return (c: ArchitectureComponent): RegistryRecord | null => {
    const direct = cache.records[cacheKey(c.type, c.name)];
    if (direct) return direct;
    const svc = byService.get(c.name.trim().toLowerCase());
    return svc ?? null;
  };
}
