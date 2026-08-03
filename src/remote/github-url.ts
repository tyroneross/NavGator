/**
 * GitHub URL parsing — strict ALLOWLIST, not a denylist.
 *
 * Accepts exactly three shapes:
 *   1. https://github.com/<owner>/<repo>(.git)?(/tree/<ref>)?
 *   2. git@github.com:<owner>/<repo>(.git)?
 *   3. <owner>/<repo>                       (bare shorthand)
 *
 * `owner` and `repo` must each match /^[A-Za-z0-9._-]+$/; `ref` may
 * additionally contain `/`. Anything not matching one of the three shapes
 * — including a non-github host, parent-directory traversal, a leading
 * dash (argument injection), the file:// scheme, and any bare local
 * filesystem path — returns null. A local-path clone would copy the
 * source repo's .git/hooks, so bare local paths are rejected outright
 * rather than merely discouraged.
 */

export interface ParsedGitHubUrl {
  owner: string;
  repo: string;
  ref?: string;
}

/** Owner/repo names: GitHub-safe identifier characters only. */
const NAME_RE = /^[A-Za-z0-9._-]+$/;
/** Ref may additionally contain `/` (e.g. `feature/foo`). */
const REF_RE = /^[A-Za-z0-9._/-]+$/;
const MAX_REF_LENGTH = 200;

/**
 * Control characters (including CR/LF, which would otherwise let a payload
 * smuggle a second git argument or an embedded command onto its own line)
 * are never valid in any accepted shape. Checked by character code rather
 * than a regex literal so no raw control byte needs to appear in this
 * source file.
 */
function hasControlChar(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

const HTTPS_RE = /^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/tree\/(.+))?\/?$/;
const SSH_RE = /^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?\/?$/;
const BARE_RE = /^([^/]+)\/([^/]+)$/;

export function parseGitHubUrl(input: unknown): ParsedGitHubUrl | null {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (hasControlChar(trimmed)) return null;

  const httpsMatch = trimmed.match(HTTPS_RE);
  if (httpsMatch) {
    return finalize(httpsMatch[1], httpsMatch[2], httpsMatch[3]);
  }

  const sshMatch = trimmed.match(SSH_RE);
  if (sshMatch) {
    return finalize(sshMatch[1], sshMatch[2], undefined);
  }

  const bareMatch = trimmed.match(BARE_RE);
  if (bareMatch) {
    return finalize(bareMatch[1], bareMatch[2], undefined);
  }

  return null;
}

function finalize(
  rawOwner: string,
  rawRepo: string,
  rawRef: string | undefined
): ParsedGitHubUrl | null {
  const owner = rawOwner;
  const repo = rawRepo;

  if (!owner || !repo) return null;
  // Argument-injection guard: a leading dash could be interpreted as a flag
  // by a downstream CLI consumer.
  if (owner.startsWith('-') || repo.startsWith('-')) return null;
  // Parent-directory traversal guard.
  if (owner === '.' || owner === '..' || repo === '.' || repo === '..') return null;
  if (!NAME_RE.test(owner) || !NAME_RE.test(repo)) return null;

  if (rawRef === undefined) {
    return { owner, repo };
  }

  const ref = validateRef(rawRef);
  if (ref === null) return null;

  return { owner, repo, ref };
}

/**
 * Validate a ref value (branch, tag, or commit-ish) against the same rules
 * `finalize` applies to a `/tree/<ref>` suffix parsed out of a URL — control
 * chars, a leading dash (argument injection), `..` traversal, an over-long
 * value, and the allowlist character set. Exported so callers accepting a
 * ref from a SEPARATE input (e.g. a CLI `--ref` flag, which never passes
 * through `parseGitHubUrl`/`finalize`) can apply the identical control
 * before that value reaches a subprocess argv (SEC-001).
 */
export function validateRef(rawRef: unknown): string | null {
  if (typeof rawRef !== 'string') return null;
  if (hasControlChar(rawRef)) return null;
  const ref = rawRef;
  if (!ref || ref.startsWith('-')) return null;
  if (ref.length > MAX_REF_LENGTH) return null;
  if (ref.includes('..')) return null;
  if (!REF_RE.test(ref)) return null;
  return ref;
}
