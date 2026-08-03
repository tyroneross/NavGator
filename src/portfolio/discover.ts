/**
 * NavGator Portfolio Discovery
 *
 * Finds repo roots under a folder: children of `dir` carrying `.git` as
 * either a directory or a file (a file means a linked worktree — it counts).
 * Depth 1 by default (only direct children of `dir`); `--depth` caps at 3.
 * Symlinked entries are skipped entirely; `node_modules` is never descended.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { DiscoveredRepo, RepoDiscoveryOptions } from './types.js';

const DEFAULT_DEPTH = 1;
const MAX_DEPTH = 3;

export function discoverRepos(dir: string, opts: RepoDiscoveryOptions = {}): DiscoveredRepo[] {
  const requested = opts.depth ?? DEFAULT_DEPTH;
  const depth = Math.min(Math.max(1, Math.floor(requested)), MAX_DEPTH);

  const found: DiscoveredRepo[] = [];
  walk(dir, depth, found);
  found.sort((a, b) => a.path.localeCompare(b.path));
  return found;
}

function walk(dir: string, remainingDepth: number, out: DiscoveredRepo[]): void {
  let entries: string[];
  try {
    entries = fs.readdirSync(dir).sort();
  } catch {
    return;
  }

  for (const name of entries) {
    if (name === 'node_modules') continue;

    const childPath = path.join(dir, name);
    let lst: fs.Stats;
    try {
      lst = fs.lstatSync(childPath);
    } catch {
      continue;
    }

    // Skip symlinked entries entirely — never follow, never count.
    if (lst.isSymbolicLink()) continue;
    if (!lst.isDirectory()) continue;

    const gitInfo = statGit(childPath);
    if (gitInfo.present) {
      out.push({ path: childPath, name, worktree: gitInfo.isFile });
      // A discovered repo's own descendants are not separate portfolio
      // entries (mirrors scanner.ts's discoverStackRoots: found roots prune
      // their subtree from further search).
      continue;
    }

    if (remainingDepth > 1) {
      walk(childPath, remainingDepth - 1, out);
    }
  }
}

function statGit(repoCandidate: string): { present: boolean; isFile: boolean } {
  const gitPath = path.join(repoCandidate, '.git');
  let gitStat: fs.Stats;
  try {
    gitStat = fs.lstatSync(gitPath);
  } catch {
    return { present: false, isFile: false };
  }
  // A symlinked .git is neither a real worktree file nor a real git dir by
  // this contract's definition — skip it rather than guess at its target.
  if (gitStat.isSymbolicLink()) return { present: false, isFile: false };
  if (gitStat.isDirectory()) return { present: true, isFile: false };
  if (gitStat.isFile()) return { present: true, isFile: true };
  return { present: false, isFile: false };
}
