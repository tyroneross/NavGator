/**
 * NavGator Git Utilities
 * Reads branch and commit info for opt-in branch tracking
 */
import { GitInfo } from './types.js';
/**
 * Get current git branch and commit info.
 * Returns null if not a git repo or git is unavailable.
 * Never throws — all failures return null.
 */
export declare function getGitInfo(projectRoot: string): Promise<GitInfo | null>;
//# sourceMappingURL=git.d.ts.map