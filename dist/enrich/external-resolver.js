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
import { DEFAULT_FRESHNESS_WINDOW_MS, ENRICHABLE_TYPES, } from './external-enrichment.types.js';
import { ecosystemFor, upsertRecord, saveCache, } from './cache.js';
import { fetchLatest } from './fetchers.js';
/** Narrow a component to an enrichable boundary node. */
export function isEnrichable(c) {
    return ENRICHABLE_TYPES.includes(c.type);
}
/**
 * Deterministic freshness from timestamps + version comparison. No network.
 * Exported so it can be unit-tested in isolation (the one piece of real logic).
 */
export function computeFreshness(now, enrichment, installedVersion) {
    if (!enrichment.last_checked)
        return 'unresolved';
    const elapsed = now - enrichment.last_checked;
    const overdue = elapsed > enrichment.freshness_window_ms;
    const newerExists = !!installedVersion &&
        !!enrichment.latest_version &&
        installedVersion !== enrichment.latest_version;
    if (newerExists)
        return 'stale';
    return overdue ? 'drifting' : 'current';
}
/**
 * STRUCTURAL axis. Stamp every enrichable node from the registry cache.
 * Mutates components in place; returns the count enriched. Offline + sync-fast.
 *
 * @param lookup  resolve a component to a cached registry record (or null).
 *                Injected so this module never imports the SQLite layer directly.
 */
export function enrichFromCache(components, lookup, now) {
    let enriched = 0;
    for (const c of components) {
        if (!isEnrichable(c))
            continue;
        const rec = lookup(c);
        if (!rec) {
            // Detected but unknown to the registry — mark unresolved so the freshness
            // sweep / agent knows to attempt a network resolve later.
            c.external = unresolvedEnrichment(c.type);
            continue;
        }
        const enrichment = {
            canonical_service: rec.canonical_service,
            registry: rec.registry,
            package_ids: rec.package_ids,
            latest_version: rec.latest_version,
            latest_released_at: rec.latest_released_at,
            context7_id: rec.context7_id,
            docs_url: rec.docs_url,
            last_checked: rec.last_checked,
            freshness_window_ms: DEFAULT_FRESHNESS_WINDOW_MS,
            author_owned: rec.author_owned,
            resolved_via: 'cache',
            freshness: 'unresolved', // set below
        };
        enrichment.freshness = computeFreshness(now, enrichment, c.version);
        c.external = enrichment;
        // Light up the health fields NavGator ALREADY consumes in agent-output.ts.
        if (enrichment.freshness === 'stale' && rec.latest_version) {
            c.status = c.status === 'active' ? 'outdated' : c.status;
            c.health = {
                ...(c.health ?? { last_audit: now }),
                last_audit: now,
                update_available: rec.latest_version,
                update_type: classifyBump(c.version, rec.latest_version),
            };
        }
        if (rec.docs_url)
            c.documentation_url = rec.docs_url;
        enriched++;
    }
    return enriched;
}
/**
 * FRESHNESS axis. Returns the nodes whose enrichment is overdue and need an
 * upstream re-check. The orchestrator hands this list to the external-resolver
 * AGENT, which fetches latest versions and writes back into the registry cache;
 * the next enrichFromCache() pass then re-stamps the graph. Kept as a SELECTOR
 * (no network here) so the engine stays deterministic and offline-safe.
 */
export function selectStaleForRefresh(components, now) {
    return components.filter((c) => {
        if (!isEnrichable(c) || !c.external)
            return isEnrichable(c); // never-resolved → refresh
        const f = computeFreshness(now, c.external, c.version);
        return f === 'drifting' || f === 'unresolved';
    });
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
export async function refreshExternal(components, cache, now, opts = {}) {
    const report = {
        checked: 0,
        resolved: 0,
        unresolved: 0,
        cache_updated: 0,
        drift: [],
    };
    const targets = opts.force
        ? components.filter(isEnrichable)
        : selectStaleForRefresh(components, now);
    for (const c of targets) {
        report.checked++;
        const eco = ecosystemFor(c.type);
        let ref = c.name;
        let registry = null;
        if (eco === 'npm')
            registry = 'npm';
        else if (eco === 'pypi')
            registry = 'pypi';
        else if (eco === 'github') {
            registry = 'github';
            ref = opts.githubRefOf?.(c) ?? deriveOwnerRepo(c.repository_url);
        }
        else {
            // service/llm/infra/manual — no auto-source; leave to curated cache.
            report.unresolved++;
            continue;
        }
        if (!registry || !ref) {
            report.unresolved++;
            continue;
        }
        const latest = await fetchLatest(registry, ref);
        if (!latest?.version) {
            report.unresolved++;
            continue;
        }
        report.resolved++;
        upsertRecord(cache, c.type, c.name, {
            canonical_service: c.name,
            registry: eco,
            package_ids: { [eco]: c.name },
            latest_version: latest.version,
            latest_released_at: latest.released_at,
            docs_url: latest.docs_url,
            last_checked: now,
        });
        report.cache_updated++;
        if (c.version && c.version !== latest.version) {
            report.drift.push({
                name: c.name,
                type: c.type,
                installed: c.version,
                latest: latest.version,
                bump: classifyBump(c.version, latest.version),
            });
        }
    }
    if (report.cache_updated > 0)
        saveCache(cache);
    return report;
}
/** Best-effort owner/repo from a repository URL. */
export function deriveOwnerRepo(repoUrl) {
    if (!repoUrl)
        return null;
    const m = repoUrl.match(/github\.com[/:]([^/]+\/[^/.]+)/i);
    return m ? m[1] : null;
}
function unresolvedEnrichment(_type) {
    return {
        registry: 'manual',
        package_ids: {},
        freshness: 'unresolved',
        last_checked: 0,
        freshness_window_ms: DEFAULT_FRESHNESS_WINDOW_MS,
        resolved_via: 'cache',
    };
}
/** semver-ish bump classification; falls back to 'minor' when unparseable. */
export function classifyBump(from, to) {
    const a = parseSemver(from);
    const b = parseSemver(to);
    if (!a || !b)
        return 'minor';
    if (b[0] > a[0])
        return 'major';
    if (b[1] > a[1])
        return 'minor';
    return 'patch';
}
function parseSemver(v) {
    if (!v)
        return null;
    const m = v.replace(/^[^\d]*/, '').match(/^(\d+)\.(\d+)\.(\d+)/);
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}
//# sourceMappingURL=external-resolver.js.map