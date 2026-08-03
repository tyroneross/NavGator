/**
 * Git ref resolution for Living Architecture slice 3.
 *
 * All git calls use `execFile` with argv arrays (never a shell string) and a
 * 3000ms timeout, and degrade to `null`/`false` on any failure — including a
 * non-git directory — rather than throwing. Note: this is a deliberately
 * safer/stricter variant of the pattern than the current `src/git.ts:33`
 * (`execGit`), which actually shells out via `child_process.exec` with a
 * command string, not `execFile`/argv — see this chunk's return notes.
 */
import { execFile } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

const GIT_TIMEOUT_MS = 3000;
const MAX_SLUG_LENGTH = 100;
const HASH_LENGTH = 8;

/** Run `git <args>` in `root`; resolves stdout on success, `null` on any failure. */
function runGit(root: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      execFile('git', args, { cwd: root, timeout: GIT_TIMEOUT_MS }, (error, stdout) => {
        if (error) {
          resolve(null);
          return;
        }
        resolve(stdout);
      });
    } catch {
      resolve(null);
    }
  });
}

async function localBranchExists(root: string, branch: string): Promise<boolean> {
  const result = await runGit(root, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`]);
  return result !== null;
}

/**
 * Resolve the default branch: origin's symbolic HEAD, then
 * `init.defaultBranch`, then a local `main`, then a local `master`.
 * Returns `null` when none resolves (including a non-git directory).
 */
export async function getDefaultBranch(root: string): Promise<string | null> {
  const symbolic = await runGit(root, ['symbolic-ref', 'refs/remotes/origin/HEAD']);
  if (symbolic !== null) {
    const match = symbolic.trim().match(/^refs\/remotes\/origin\/(.+)$/);
    if (match && match[1]) return match[1];
  }

  const configured = await runGit(root, ['config', 'init.defaultBranch']);
  if (configured !== null && configured.trim()) return configured.trim();

  if (await localBranchExists(root, 'main')) return 'main';
  if (await localBranchExists(root, 'master')) return 'master';

  return null;
}

/** Current branch name via `git rev-parse --abbrev-ref HEAD`; `null` on failure. */
export async function getCurrentBranch(root: string): Promise<string | null> {
  const branch = await runGit(root, ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (branch === null) return null;
  const trimmed = branch.trim();
  return trimmed || null;
}

/**
 * Current ref for branch-delta storage: the branch name, or (detached HEAD)
 * the short commit sha. `null` on failure / non-git directory.
 */
export async function getCurrentRef(root: string): Promise<string | null> {
  const branch = await getCurrentBranch(root);
  if (branch && branch !== 'HEAD') return branch;

  const sha = await runGit(root, ['rev-parse', '--short', 'HEAD']);
  if (sha === null) return null;
  const trimmed = sha.trim();
  return trimmed || null;
}

/** True only when the current branch equals the resolved default branch. */
export async function isDefaultBranch(root: string): Promise<boolean> {
  const [current, defaultBranch] = await Promise.all([
    getCurrentBranch(root),
    getDefaultBranch(root),
  ]);
  if (!current || !defaultBranch) return false;
  return current === defaultBranch;
}

/**
 * True when `root` is a linked worktree — in a linked worktree `.git` is a
 * FILE (containing `gitdir: <path>`), not a directory. False for a normal
 * repo, a bare repo root, or any non-git directory. Never throws.
 */
export function isWorktree(root: string): boolean {
  try {
    const stat = fs.statSync(path.join(root, '.git'));
    return stat.isFile();
  } catch {
    return false;
  }
}

/**
 * Map a git ref to a filesystem-safe slug: `/` becomes `__`, every other
 * character outside `[A-Za-z0-9._-]` becomes `_`, the result is capped at
 * 100 characters, and an 8-character hash of the ORIGINAL ref is appended
 * whenever sanitization or truncation actually changed the string. A ref
 * that passes through unchanged carries no hash suffix — this is what stops
 * `feat/a` and `feat_a` colliding on one snapshot file without adding noise
 * to ordinary branch names.
 */
export function slugifyRef(ref: string): string {
  const replaced = ref
    .split('/')
    .join('__')
    .replace(/[^A-Za-z0-9._-]/g, '_');
  const truncated = replaced.slice(0, MAX_SLUG_LENGTH);

  if (truncated === ref) return truncated;

  const hash = crypto.createHash('sha256').update(ref, 'utf8').digest('hex').slice(0, HASH_LENGTH);
  return `${truncated}_${hash}`;
}
