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
  released_at?: string; // ISO-8601
  docs_url?: string;
  repo_url?: string;
}

const UA = { 'User-Agent': 'navgator-external-resolver' };
const TIMEOUT_MS = 8000;

async function getJson(url: string, headers: Record<string, string> = {}): Promise<unknown | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    const res = await fetch(url, { headers: { ...UA, ...headers }, signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return null;
    return (await res.json()) as unknown;
  } catch {
    return null; // network failure → caller marks node unresolved
  }
}

/** npm: latest dist-tag + publish time. */
export async function fetchNpmLatest(pkg: string): Promise<LatestVersion | null> {
  const data = (await getJson(`https://registry.npmjs.org/${encodeURIComponent(pkg)}`)) as
    | {
        'dist-tags'?: { latest?: string };
        time?: Record<string, string>;
        homepage?: string;
        repository?: { url?: string };
      }
    | null;
  if (!data?.['dist-tags']?.latest) return null;
  const version = data['dist-tags'].latest;
  return {
    version,
    released_at: data.time?.[version],
    docs_url: data.homepage,
    repo_url: data.repository?.url?.replace(/^git\+/, '').replace(/\.git$/, ''),
  };
}

/** PyPI: latest version + release date. */
export async function fetchPypiLatest(pkg: string): Promise<LatestVersion | null> {
  const data = (await getJson(`https://pypi.org/pypi/${encodeURIComponent(pkg)}/json`)) as
    | {
        info?: { version?: string; home_page?: string; project_urls?: Record<string, string> };
        releases?: Record<string, Array<{ upload_time_iso_8601?: string }>>;
      }
    | null;
  const version = data?.info?.version;
  if (!version) return null;
  const files = data?.releases?.[version];
  return {
    version,
    released_at: files?.[0]?.upload_time_iso_8601,
    docs_url:
      data?.info?.project_urls?.['Documentation'] ??
      data?.info?.project_urls?.['Homepage'] ??
      data?.info?.home_page,
    repo_url: data?.info?.project_urls?.['Source'] ?? data?.info?.project_urls?.['Repository'],
  };
}

/**
 * GitHub Releases: latest tag + publish date for `owner/repo`.
 * Used for spm/cargo/go nodes that expose versions via tags, not a registry.
 * Honors GITHUB_TOKEN when present to avoid the 60/hr unauthenticated limit.
 */
export async function fetchGitHubLatest(ownerRepo: string): Promise<LatestVersion | null> {
  const headers: Record<string, string> = process.env['GITHUB_TOKEN']
    ? { Authorization: `Bearer ${process.env['GITHUB_TOKEN']}` }
    : {};
  const data = (await getJson(
    `https://api.github.com/repos/${ownerRepo}/releases/latest`,
    headers,
  )) as { tag_name?: string; published_at?: string; html_url?: string } | null;
  if (!data?.tag_name) return null;
  return {
    version: data.tag_name.replace(/^v/, ''),
    released_at: data.published_at,
    docs_url: data.html_url,
    repo_url: `https://github.com/${ownerRepo}`,
  };
}

/** Dispatch by ecosystem. `ref` is a package name, or owner/repo for github. */
export async function fetchLatest(
  registry: 'npm' | 'pypi' | 'github',
  ref: string,
): Promise<LatestVersion | null> {
  switch (registry) {
    case 'npm':
      return fetchNpmLatest(ref);
    case 'pypi':
      return fetchPypiLatest(ref);
    case 'github':
      return fetchGitHubLatest(ref);
    default:
      return null;
  }
}
