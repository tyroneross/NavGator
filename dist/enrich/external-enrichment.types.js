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
/** Default 7-day freshness window, matching api-registry's contract. */
export const DEFAULT_FRESHNESS_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
/** Component types that are external boundary nodes eligible for enrichment. */
export const ENRICHABLE_TYPES = [
    'npm',
    'pip',
    'spm',
    'cargo',
    'go',
    'gem',
    'composer',
    'service',
    'llm',
    'infra',
];
//# sourceMappingURL=external-enrichment.types.js.map