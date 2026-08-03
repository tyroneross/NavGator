/**
 * NavGator Portfolio Discovery
 *
 * Finds repo roots under a folder: children of `dir` carrying `.git` as
 * either a directory or a file (a file means a linked worktree — it counts).
 * Depth 1 by default (only direct children of `dir`); `--depth` caps at 3.
 * Symlinked entries are skipped entirely; `node_modules` is never descended.
 */
import type { DiscoveredRepo, RepoDiscoveryOptions } from './types.js';
export declare function discoverRepos(dir: string, opts?: RepoDiscoveryOptions): DiscoveredRepo[];
//# sourceMappingURL=discover.d.ts.map