/**
 * scanRemote(url, opts) — parse a GitHub URL, ensure a shallow clone in the
 * cache, run the existing scan pipeline against the clone, and record the
 * remote origin against the project registry entry.
 *
 * `scan()` already owns its own lease and already calls `registerProject()`
 * internally (src/scanner.ts) — this module does neither.
 */

import { parseGitHubUrl, type ParsedGitHubUrl } from './github-url.js';
import { ensureClone, type EnsureCloneOptions } from './clone.js';
import { scan } from '../scanner.js';
import * as projectsModule from '../projects.js';

type ScanOutcome = Awaited<ReturnType<typeof scan>>;

export interface ScanRemoteOptions {
  /** Explicit ref override — otherwise the ref parsed from the URL (e.g. `/tree/<ref>`) is used. */
  ref?: string;
  refresh?: boolean;
  cacheRoot?: string;
  timeoutMs?: number;
  execFileImpl?: EnsureCloneOptions['execFileImpl'];
}

export type ScanRemoteResult =
  | { status: 'invalid_url'; url: string }
  | { status: 'busy'; retryable: true; message: string; clonePath: string }
  | {
      status: 'completed' | 'noop';
      clonePath: string;
      cloned: boolean;
      parsed: ParsedGitHubUrl;
      scan: ScanOutcome;
    };

/**
 * Read-modify-write helper for the project registry's origin metadata.
 *
 * Sibling chunk C6 is adding `updateProjectMeta(root, patch)` to
 * `src/projects.ts` in the same parallel batch as this chunk. It may not
 * exist yet at any given moment during that batch, so this is looked up
 * dynamically (not statically imported/typed) and is a no-op — never a
 * throw — when absent. Once C6 lands, this starts working with no further
 * change needed here.
 */
async function recordRemoteOrigin(
  cloneDir: string,
  url: string,
  cachePath: string
): Promise<void> {
  const mod = projectsModule as unknown as {
    updateProjectMeta?: (root: string, patch: Record<string, unknown>) => Promise<void>;
  };
  if (typeof mod.updateProjectMeta !== 'function') return;
  try {
    await mod.updateProjectMeta(cloneDir, {
      origin: { kind: 'remote', url, cachePath },
    });
  } catch {
    // Non-critical — mirrors registerProject's own swallow-and-continue policy.
  }
}

/**
 * Parse a GitHub URL, ensure the clone exists (or is refreshed), run the
 * scan, and record the remote origin. Never throws on a malformed URL —
 * returns a typed `invalid_url` result instead.
 */
export async function scanRemote(
  url: string,
  opts: ScanRemoteOptions = {}
): Promise<ScanRemoteResult> {
  const parsed = parseGitHubUrl(url);
  if (!parsed) {
    return { status: 'invalid_url', url };
  }

  const ref = opts.ref ?? parsed.ref;
  const cloneResult = await ensureClone(
    { owner: parsed.owner, repo: parsed.repo, ref },
    {
      cacheRoot: opts.cacheRoot,
      refresh: opts.refresh,
      timeoutMs: opts.timeoutMs,
      execFileImpl: opts.execFileImpl,
    }
  );

  const outcome = await scan(cloneResult.dir, { mode: 'auto' });

  if (outcome.status === 'busy') {
    return {
      status: 'busy',
      retryable: true,
      message: outcome.message,
      clonePath: cloneResult.dir,
    };
  }

  await recordRemoteOrigin(cloneResult.dir, url, cloneResult.dir);

  return {
    status: outcome.status,
    clonePath: cloneResult.dir,
    cloned: cloneResult.cloned,
    parsed,
    scan: outcome,
  };
}
