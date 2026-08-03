/**
 * NavGator Cross-Repo Map
 *
 * Builds a shared-dependency + service-call + status view across repos
 * already loaded via loadAllComponents/loadAllConnections. Pure function of
 * its inputs — no scanning, no I/O — so it's independently testable with
 * fixture data and reusable by both the scanning path (`navgator portfolio
 * <dir>`) and the status-only path (`navgator portfolio` with no dir, over
 * already-registered projects).
 */

import type { ArchitectureComponent } from '../types.js';
import { identityKey } from '../component-identity.js';
import type {
  CrossRepoMap,
  CrossRepoRepoInput,
  CrossRepoServiceEdge,
  PortfolioStatus,
  SharedDependencyEntry,
} from './types.js';

const STALE_MS = 24 * 60 * 60 * 1000; // src/projects.ts:170's rule

export function buildCrossRepoMap(repos: CrossRepoRepoInput[]): CrossRepoMap {
  return {
    sharedDependencies: findSharedDependencies(repos),
    // TAG:INFERRED — see CrossRepoServiceEdge doc comment. Never a verified call graph.
    serviceCalls: findCrossRepoServiceCalls(repos),
    status: buildStatus(repos),
  };
}

// =============================================================================
// SHARED DEPENDENCIES
// =============================================================================

/** stable_id when present (best cross-scan join key); base-name+type otherwise. */
function dependencyKey(c: ArchitectureComponent): string {
  return c.stable_id ? `stable:${c.stable_id}` : `base:${identityKey(c)}`;
}

function findSharedDependencies(repos: CrossRepoRepoInput[]): SharedDependencyEntry[] {
  const byKey = new Map<
    string,
    { name: string; type: string; repos: { repo: string; version?: string }[] }
  >();

  for (const r of repos) {
    for (const c of r.components) {
      if (c.role.layer !== 'external') continue;
      const key = dependencyKey(c);
      let entry = byKey.get(key);
      if (!entry) {
        entry = { name: c.name, type: c.type, repos: [] };
        byKey.set(key, entry);
      }
      // A single repo's alias-merged components could still list the same
      // logical dependency more than once; count each repo once per key.
      if (!entry.repos.some((e) => e.repo === r.repo)) {
        entry.repos.push({ repo: r.repo, version: c.version });
      }
    }
  }

  const out: SharedDependencyEntry[] = [];
  for (const [key, entry] of byKey) {
    if (entry.repos.length < 2) continue;
    const versions = new Set(entry.repos.map((e) => e.version ?? ''));
    out.push({
      key,
      name: entry.name,
      type: entry.type,
      repos: entry.repos,
      versionSkew: versions.size > 1,
    });
  }

  return out.sort((a, b) => a.key.localeCompare(b.key));
}

// =============================================================================
// CROSS-REPO SERVICE CALLS (heuristic)
// =============================================================================

/**
 * For each service-call/runtime-binding connection in repo A, resolve its
 * target component (within repo A's own component list) and use THAT
 * component's own `runtime` identity — what repo A believes it's calling —
 * as the search key against every OTHER repo's components' `runtime`
 * identities — what that repo declares itself to be. A match on
 * `service_name`, or on `endpoint.host` + `endpoint.port`, produces an edge.
 *
 * This is inference over independently-scanned data, not a resolved call
 * graph — every edge carries `heuristic: true`, a `confidence`, and a
 * `basis`, and every render path must label it as such.
 */
function findCrossRepoServiceCalls(repos: CrossRepoRepoInput[]): CrossRepoServiceEdge[] {
  const edges: CrossRepoServiceEdge[] = [];
  const CONNECTION_TYPES = new Set(['service-call', 'runtime-binding']);

  for (const repoA of repos) {
    const componentsById = new Map(repoA.components.map((c) => [c.component_id, c]));

    for (const conn of repoA.connections) {
      if (!CONNECTION_TYPES.has(conn.connection_type)) continue;
      const targetComp = componentsById.get(conn.to.component_id);
      if (!targetComp) continue;

      const targetRuntime = targetComp.runtime;
      const targetName = targetRuntime?.service_name ?? targetComp.name;
      const targetHost = targetRuntime?.endpoint?.host;
      const targetPort = targetRuntime?.endpoint?.port;

      for (const repoB of repos) {
        if (repoB.repo === repoA.repo) continue;

        for (const candidate of repoB.components) {
          const rt = candidate.runtime;
          if (!rt) continue;

          if (
            rt.endpoint?.host &&
            targetHost &&
            rt.endpoint.host.toLowerCase() === targetHost.toLowerCase() &&
            rt.endpoint.port !== undefined &&
            targetPort !== undefined &&
            rt.endpoint.port === targetPort
          ) {
            edges.push({
              fromRepo: repoA.repo,
              fromComponent: conn.from.component_id,
              toRepo: repoB.repo,
              toComponent: candidate.component_id,
              connectionType: conn.connection_type,
              confidence: 0.8,
              basis: 'host-match',
              heuristic: true,
            });
            continue;
          }

          if (
            rt.service_name &&
            targetName &&
            rt.service_name.toLowerCase() === targetName.toLowerCase()
          ) {
            edges.push({
              fromRepo: repoA.repo,
              fromComponent: conn.from.component_id,
              toRepo: repoB.repo,
              toComponent: candidate.component_id,
              connectionType: conn.connection_type,
              confidence: 0.6,
              basis: 'service-name-match',
              heuristic: true,
            });
          }
        }
      }
    }
  }

  return edges.sort(
    (a, b) =>
      a.fromRepo.localeCompare(b.fromRepo) ||
      a.fromComponent.localeCompare(b.fromComponent) ||
      a.toRepo.localeCompare(b.toRepo) ||
      a.toComponent.localeCompare(b.toComponent)
  );
}

// =============================================================================
// PORTFOLIO STATUS
// =============================================================================

function buildStatus(repos: CrossRepoRepoInput[]): PortfolioStatus {
  const now = Date.now();
  const staleRepos: string[] = [];
  const failedRepos: string[] = [];
  const busyRepos: string[] = [];
  let totalComponents = 0;
  let totalConnections = 0;

  for (const r of repos) {
    totalComponents += r.components.length;
    totalConnections += r.connections.length;
    if (r.lastScan && now - r.lastScan > STALE_MS) staleRepos.push(r.repo);
    if (r.scanStatus === 'failed') failedRepos.push(r.repo);
    if (r.scanStatus === 'busy') busyRepos.push(r.repo);
  }

  return {
    repoCount: repos.length,
    totalComponents,
    totalConnections,
    staleRepos: staleRepos.sort(),
    failedRepos: failedRepos.sort(),
    busyRepos: busyRepos.sort(),
  };
}
