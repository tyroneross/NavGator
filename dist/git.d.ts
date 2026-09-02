/**
 * NavGator Git Utilities
 * Reads branch and commit info for opt-in branch tracking
 */
import { GitInfo } from './types.js';
/**
 * Get current git branch and commit info.
 * Returns null if not a git repo or git is unavailable.
 * Never throws — all failures return null.
 *
 * ONE shell-free spawn, deliberately. This used to be two `exec()` calls in a
 * `Promise.all`, and `exec` routes through `/bin/sh` — four processes per
 * call. `computeStamp` (src/freshness/stamp.ts) calls this, and a single
 * `drain()` computes two stamps, so the freshness path was paying twelve
 * process spawns for two facts. Spawn cost is what scales under machine load:
 * measured 13 ms idle against 25-36 ms under full-suite load, which is how the
 * drainer tests reached the default 5-second vitest budget and failed
 * intermittently while passing in isolation.
 *
 * `git rev-parse HEAD --abbrev-ref HEAD` emits the full sha on line 1 and the
 * branch on line 2 — rev-parse applies `--abbrev-ref` only to the args that
 * follow it. A non-repo exits 128, which lands in the error branch and returns
 * null, matching the previous behavior.
 */
export declare function getGitInfo(projectRoot: string): Promise<GitInfo | null>;
//# sourceMappingURL=git.d.ts.map