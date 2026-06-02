/**
 * External enrichment schema — the "live boundary" layer for NavGator.
 *
 * NavGator's scanners already DETECT external boundary nodes (`service`, `npm`,
 * `spm`, `llm`, `infra`, `config`). What they don't do is RESOLVE them: a bare
 * `npm:openai` node has no canonical identity, current/latest version, release
 * date, authoritative docs, or freshness signal.
 *
 * This module defines the enrichment block that the external-resolver populates
 * onto those nodes. It is the integration-layer twin of the database-profile
 * fold (research plugin), which enriches `database` nodes with live schema/rows.
 * Both folds answer the same question for opposite boundaries: "is this node a
 * monitored, versioned, dated fact, or just a name?"
 *
 * Design rules:
 *  - Enrichment is ADDITIVE and OPTIONAL. A component with no `external` block
 *    behaves exactly as before. Removing this module degrades gracefully.
 *  - Two update axes (see external-resolver.ts):
 *      1. structural  — runs inside scan(), offline, from the registry cache.
 *      2. freshness   — runs on the 7-day contract, online, file-change-free.
 *  - No secrets ever land here. Enrichment is identity + version + docs only.
 */
/** Which package/release ecosystem a version was resolved against. */
export type EnrichmentRegistry = 'npm' | 'pypi' | 'github' | 'cargo' | 'go' | 'manual';
/**
 * Freshness of NavGator's KNOWLEDGE of this node — distinct from
 * ComponentStatus, which describes the dependency itself.
 *  - current  : last checked within the freshness window (default 7d).
 *  - drifting  : window elapsed; a re-check is due but not yet run.
 *  - stale     : re-checked and a newer version exists (mirrors status:'outdated').
 *  - unresolved: detected but never successfully resolved (offline / unknown service).
 */
export type Freshness = 'current' | 'drifting' | 'stale' | 'unresolved';
/**
 * The enrichment block hung off ArchitectureComponent.external.
 * Populated by the external-resolver; consumed by `schema`, `summary`,
 * `review`, and agent-output update-available messaging.
 */
export interface ExternalEnrichment {
    /**
     * Canonical service identity from the api-registry registry (e.g. the npm
     * nodes `@anthropic-ai/sdk` and `openai` both resolve to llm-provider
     * services). Null when the node could not be matched to a known service.
     */
    canonical_service?: string;
    /** Ecosystem the version facts below were resolved from. */
    registry: EnrichmentRegistry;
    /** Package identifiers per ecosystem, e.g. { npm: "openai", pypi: "openai" }. */
    package_ids: Partial<Record<EnrichmentRegistry, string>>;
    /** Latest version available upstream at last check (e.g. "4.52.0"). */
    latest_version?: string;
    /** ISO-8601 release date of latest_version, when the registry exposes it. */
    latest_released_at?: string;
    /** Context7 library id for doc routing, when known (e.g. "/openai/openai-node"). */
    context7_id?: string;
    /** Authoritative docs URL — overrides the scanner's guessed documentation_url. */
    docs_url?: string;
    /** Freshness of this enrichment (see Freshness). */
    freshness: Freshness;
    /** Epoch ms of the last successful upstream check. 0 = never checked. */
    last_checked: number;
    /**
     * Freshness window in ms used for this node (default 7d). Per-node override
     * lets volatile providers (LLM SDKs) re-check more often than stable infra.
     */
    freshness_window_ms: number;
    /** True when this service is in the user's ~/.api-registry/owned.json scope. */
    author_owned?: boolean;
    /** Where the resolution came from, for auditability. */
    resolved_via: 'cache' | 'network';
}
/**
 * Additive extension to the existing ComponentHealth block. The resolver writes
 * these alongside the fields NavGator already declares (update_available,
 * update_type) so existing agent-output messaging lights up for free.
 *
 * Merge these keys into the ComponentHealth interface in types.ts (see
 * docs/external-enrichment-fold.md §"Schema delta").
 */
export interface ExternalHealthExtension {
    /** Version NavGator believes is installed (echo of component.version). */
    installed_version?: string;
    /** Registry the health check ran against. */
    health_source?: EnrichmentRegistry;
}
/** Default 7-day freshness window, matching api-registry's contract. */
export declare const DEFAULT_FRESHNESS_WINDOW_MS: number;
/** Component types that are external boundary nodes eligible for enrichment. */
export declare const ENRICHABLE_TYPES: readonly ["npm", "pip", "spm", "cargo", "go", "gem", "composer", "service", "llm", "infra"];
export type EnrichableType = (typeof ENRICHABLE_TYPES)[number];
//# sourceMappingURL=external-enrichment.types.d.ts.map