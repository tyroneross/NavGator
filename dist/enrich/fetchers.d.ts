/**
 * Vendored, dependency-free upstream version fetchers for NavGator.
 *
 * Self-contained: uses the global `fetch` (Node ≥18) — no axios, no api-registry
 * import. These are the ONLY network calls in the enrichment fold, and they run
 * exclusively on the freshness path (refreshExternal / the external-resolver
 * agent), never inside scan(). The engine stays offline and deterministic.
 *
 * Equivalent to api-registry/src/http.ts's fetchers, re-implemented here so
 * NavGator carries no cross-plugin dependency.
 */
export interface LatestVersion {
    version?: string;
    released_at?: string;
    docs_url?: string;
    repo_url?: string;
}
/** npm: latest dist-tag + publish time. */
export declare function fetchNpmLatest(pkg: string): Promise<LatestVersion | null>;
/** PyPI: latest version + release date. */
export declare function fetchPypiLatest(pkg: string): Promise<LatestVersion | null>;
/**
 * GitHub Releases: latest tag + publish date for `owner/repo`.
 * Used for spm/cargo/go nodes that expose versions via tags, not a registry.
 * Honors GITHUB_TOKEN when present to avoid the 60/hr unauthenticated limit.
 */
export declare function fetchGitHubLatest(ownerRepo: string): Promise<LatestVersion | null>;
/** Dispatch by ecosystem. `ref` is a package name, or owner/repo for github. */
export declare function fetchLatest(registry: 'npm' | 'pypi' | 'github', ref: string): Promise<LatestVersion | null>;
//# sourceMappingURL=fetchers.d.ts.map