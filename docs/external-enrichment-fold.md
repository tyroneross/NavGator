# External Enrichment Fold — the live boundary layer

**Goal:** a persistent, dynamic, self-updating map of product architecture across
any type of app. This fold adds the **external integration boundary** to that
map and gives the map a **second self-update axis**.

It is the twin of the database-profile fold (research plugin). Both make a
*boundary* node live instead of opaque:

| Boundary | Already a node? | Enricher | Makes it… |
|---|---|---|---|
| `database` | ✅ (code-level model) | research `db-profile` | live schema, row counts, FKs, samples |
| `npm`/`service`/`llm`/`infra`/`spm`/… | ✅ (already detected) | **this fold** (api-registry brain) | canonical identity, latest version, release date, docs, freshness |

## Why this and not the scanner

NavGator's scanners **already detect** external nodes — in atomize: `service`,
`npm`, 5 `llm`, `infra`, 219 `config`, and `spm` (Swift). api-registry's own
`scan.ts` is npm/pypi-only and would be a *downgrade* in language coverage. The
gap is not detection — it's that those nodes carry no identity, version, or
freshness. So we fold api-registry's **enrichment brain** (`http.ts` fetchers +
`registry.db` + the 7-day staleness contract), not its scanner.

NavGator was already built for this and never wired it: `ComponentHealth`
declares `update_available` / `update_type`, and `agent-output.ts:115` already
*reports* "X has an update available" — but nothing populates it. This fold is
the missing populator.

## Two self-update axes

1. **Structural** (existing) — incremental scan on **file change**. Already live.
2. **Freshness** (new) — re-check upstream versions on a **7-day timer**, with
   **no file change required**. The map flags that the Stripe SDK is 3 versions
   behind because *the world* moved, not the repo. This is the half of
   "self-updating" NavGator lacked.

```
file change ─► scan() ─► enrichFromCache() [offline, sync]  ─┐
                                                             ├─► .navgator graph
7-day timer ─► selectStaleForRefresh() ─► external-resolver  │   (boundary nodes
               (agent, network, isolated) ─► registry.db ────┘    now versioned)
```

## Schema delta

New, net-new, zero-risk:
- `src/enrich/external-enrichment.types.ts` — `ExternalEnrichment`, `Freshness`,
  `EnrichmentRegistry`, `ENRICHABLE_TYPES`, `DEFAULT_FRESHNESS_WINDOW_MS`.
- `src/enrich/external-resolver.ts` — `enrichFromCache()` (structural axis),
  `selectStaleForRefresh()` (freshness selector), `computeFreshness()`
  (the one deterministic, unit-testable piece), `classifyBump()`.

Additive edits to `src/types.ts` (one optional field, fully backward-compatible):
- `import type { ExternalEnrichment }` from the new module.
- `external?: ExternalEnrichment;` on `ArchitectureComponent`.

Optional follow-up (not required for compile): merge `ExternalHealthExtension`
keys into `ComponentHealth`. The resolver already writes the existing
`update_available`/`update_type` fields, so update messaging lights up with no
further change. ✅ `tsc --noEmit` passes with 0 errors after the delta.

## Integration hook points

| Axis | File / location | Call |
|---|---|---|
| Structural | `src/scanner.ts` `scan()`, just before "Store final state" (~L1546) | `enrichFromCache(components, lookup, Date.now())` |
| Freshness (select) | `src/scanner.ts` `autoRefreshIfStale()` (~L2070) + SessionStart staleness hook | `selectStaleForRefresh(components, Date.now())` |
| Freshness (fetch) | `agents/external-resolver.md` (subprocess, network) | dispatched with the stale worklist |

`lookup` is injected (via `makeLookup(loadCache())`) so the engine stays
decoupled from the cache implementation. The cache is **self-contained inside
NavGator**: a dependency-free JSON file at `~/.navgator/enrichment-cache.json`
(`src/enrich/cache.ts`), shared across every repo on the machine (serves
"persistent … across any type of app"). No api-registry / external-plugin
dependency.

## Boundaries (what this fold does NOT do)

- **No secrets.** Identity + version + docs only. secrets-vault stays separate;
  its only architecture signal (which providers need creds) is already covered
  by NavGator's `config` nodes + api-registry's env-prefix map.
- **No agent-context scanning.** agent-astronomer maps the dev toolchain, not the
  product. Out of scope for the product-architecture map.
- **Engine stays offline + deterministic.** All network lives in the agent.

## Self-contained (vendored, no api-registry dependency)

The fetchers and cache are NavGator-owned, so the fold works on a clean install
with no other plugin present:

- `src/enrich/fetchers.ts` — dependency-free npm/pypi/github fetchers using the
  global `fetch` (Node ≥18). Conceptual equivalents of api-registry's
  `http.ts`, re-implemented here.
- `src/enrich/cache.ts` — JSON cache at `~/.navgator/enrichment-cache.json`
  (NavGator bundles no SQLite, so JSON keeps the fold zero-dependency).
- `src/enrich/external-resolver.ts` `refreshExternal()` — the network
  orchestrator the agent / a future `navgator refresh-external` command calls.

Verified end-to-end: `refreshExternal` resolved `openai` (npm) live, persisted
the cache, and `enrichFromCache` stamped the node `freshness: stale`,
`status: outdated`, `health.update_available` set — lighting up the existing
`agent-output.ts` update messaging. `tsc --noEmit`: 0 errors.
