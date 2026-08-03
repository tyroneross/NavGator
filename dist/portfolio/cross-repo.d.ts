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
import type { CrossRepoMap, CrossRepoRepoInput } from './types.js';
export declare function buildCrossRepoMap(repos: CrossRepoRepoInput[]): CrossRepoMap;
//# sourceMappingURL=cross-repo.d.ts.map