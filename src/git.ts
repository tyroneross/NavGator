/**
 * NavGator Git Utilities
 * Reads branch and commit info for opt-in branch tracking
 */

import { exec } from 'child_process';
import { GitInfo } from './types.js';

/**
 * Get current git branch and commit info.
 * Returns null if not a git repo or git is unavailable.
 * Never throws — all failures return null.
 */
export async function getGitInfo(projectRoot: string): Promise<GitInfo | null> {
  try {
    const [branch, commitFull] = await Promise.all([
      execGit('git rev-parse --abbrev-ref HEAD', projectRoot),
      execGit('git rev-parse HEAD', projectRoot),
    ]);

    if (!branch || !commitFull) return null;

    return {
      branch: branch.trim(),
      commit: commitFull.trim().slice(0, 7),
      commitFull: commitFull.trim(),
    };
  } catch {
    return null;
  }
}

function execGit(command: string, cwd: string): Promise<string | null> {
  return new Promise((resolve) => {
    const child = exec(command, { cwd, timeout: 3000 }, (error, stdout) => {
      if (error) {
        resolve(null);
        return;
      }
      resolve(stdout);
    });

    // Safety: kill on timeout (exec timeout should handle this, but belt-and-suspenders)
    child.on('error', () => resolve(null));
  });
}
