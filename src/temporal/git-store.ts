/**
 * Git-backed temporal store for `.navgator/` snapshots.
 *
 * Architecture: a NESTED git repository at `<storage>/.git` — the parent
 * project's git is untouched, the parent project's `.gitignore` already
 * excludes `.navgator/architecture/`, so this nested `.git` is invisible
 * upstream. No orphan branches, no main-repo pollution.
 *
 * Author config: `navgator-bot <noreply@navgator.local>` — never reads
 * the user's global git identity.
 */

import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface CommitResult {
  ok: boolean;
  sha?: string;
  empty?: boolean;        // no changes since last scan → no commit made
  error?: string;
}

export interface SnapshotEntry {
  sha: string;
  short_sha: string;
  date: string;        // ISO 8601
  subject: string;
}

const COMMIT_AUTHOR = 'navgator-bot <noreply@navgator.local>';

function runGit(cwd: string, args: string[]): { ok: boolean; stdout: string; stderr: string; code: number } {
  // Strip every GIT_* env var the user may have set (GIT_DIR, GIT_WORK_TREE,
  // GIT_CONFIG_GLOBAL, GIT_INDEX_FILE, etc.) so the nested store really is
  // isolated from the user's git environment (Codex audit fix).
  const cleanEnv: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (!k.startsWith('GIT_')) cleanEnv[k] = v;
  }
  // Then set only what we want:
  cleanEnv.GIT_CONFIG_NOSYSTEM = '1';      // ignore /etc/gitconfig
  cleanEnv.GIT_CONFIG_GLOBAL = '/dev/null'; // ignore ~/.gitconfig (point to empty)
  cleanEnv.GIT_AUTHOR_NAME = 'navgator-bot';
  cleanEnv.GIT_AUTHOR_EMAIL = 'noreply@navgator.local';
  cleanEnv.GIT_COMMITTER_NAME = 'navgator-bot';
  cleanEnv.GIT_COMMITTER_EMAIL = 'noreply@navgator.local';

  const r = spawnSync('git', args, {
    cwd,
    stdio: 'pipe',
    env: cleanEnv,
  });
  return {
    ok: (r.status ?? -1) === 0,
    stdout: r.stdout?.toString() ?? '',
    stderr: r.stderr?.toString() ?? '',
    code: r.status ?? -1,
  };
}

/** Returns true if `<storeDir>/.git` exists (initialized). */
export function isInitialized(storeDir: string): boolean {
  return fs.existsSync(path.join(storeDir, '.git'));
}

/** Initialize the nested git store if not already present. Idempotent. */
export function ensureInitialized(storeDir: string): { ok: boolean; created: boolean; error?: string } {
  if (!fs.existsSync(storeDir)) {
    return { ok: false, created: false, error: `storeDir does not exist: ${storeDir}` };
  }
  if (isInitialized(storeDir)) {
    return { ok: true, created: false };
  }
  const init = runGit(storeDir, ['init', '--quiet', '--initial-branch=main']);
  if (!init.ok) {
    return { ok: false, created: false, error: `git init failed: ${init.stderr.trim()}` };
  }
  // Local repo identity (so commits work even if global config is stripped).
  runGit(storeDir, ['config', 'user.name', 'navgator-bot']);
  runGit(storeDir, ['config', 'user.email', 'noreply@navgator.local']);
  runGit(storeDir, ['config', 'commit.gpgsign', 'false']);
  return { ok: true, created: true };
}

/**
 * Stage everything in storeDir and commit. No-op (returns empty:true) when
 * there are no changes since the last commit.
 */
export function commitScan(storeDir: string, message: string): CommitResult {
  const init = ensureInitialized(storeDir);
  if (!init.ok) return { ok: false, error: init.error };

  const add = runGit(storeDir, ['add', '-A']);
  if (!add.ok) return { ok: false, error: `git add failed: ${add.stderr.trim()}` };

  // Detect whether anything is actually staged.
  const status = runGit(storeDir, ['status', '--porcelain']);
  if (status.ok && status.stdout.trim() === '') {
    // Either repo is empty + nothing to add, or no changes since last commit.
    const head = runGit(storeDir, ['rev-parse', 'HEAD']);
    if (head.ok) {
      return { ok: true, empty: true, sha: head.stdout.trim() };
    }
    // No HEAD yet (fresh init, but nothing to commit) — bail cleanly.
    return { ok: true, empty: true };
  }

  const commit = runGit(storeDir, ['commit', '-m', message, '--quiet', '--no-verify']);
  if (!commit.ok) {
    return { ok: false, error: `git commit failed: ${commit.stderr.trim() || commit.stdout.trim()}` };
  }
  const head = runGit(storeDir, ['rev-parse', 'HEAD']);
  return { ok: true, sha: head.ok ? head.stdout.trim() : undefined };
}

/** List recent snapshots, newest first. */
export function listSnapshots(storeDir: string, limit = 50): SnapshotEntry[] {
  if (!isInitialized(storeDir)) return [];
  const r = runGit(storeDir, [
    'log',
    '--pretty=format:%H%x09%h%x09%aI%x09%s',
    `-${Math.max(1, limit)}`,
  ]);
  if (!r.ok) return [];
  return r.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [sha, short_sha, date, ...subject] = line.split('\t');
      return { sha, short_sha, date, subject: subject.join('\t') };
    });
}

/**
 * Find the first commit that introduced a literal string (e.g. a stable_id
 * or component_id) into the store. Uses `git log -S` (pickaxe) which scans
 * the diff for the literal — excellent for "when did this component first
 * appear?" queries. Returns the OLDEST matching commit.
 */
export function findFirstSeen(storeDir: string, needle: string): SnapshotEntry | null {
  if (!isInitialized(storeDir)) return null;
  if (!needle || needle.includes('\n')) return null;
  const r = runGit(storeDir, [
    'log',
    '--reverse',
    '-S', needle,
    '--pretty=format:%H%x09%h%x09%aI%x09%s',
    '--all',
  ]);
  if (!r.ok) return null;
  const first = r.stdout.split('\n').map((l) => l.trim()).filter(Boolean)[0];
  if (!first) return null;
  const [sha, short_sha, date, ...subject] = first.split('\t');
  return { sha, short_sha, date, subject: subject.join('\t') };
}

/**
 * `git diff --stat <ref>..HEAD` — file-level summary of changes since a
 * reference (sha or tag). Returns the raw `--stat` output as a string,
 * suitable for piping to a markdown code block.
 */
export function diffSince(storeDir: string, ref: string): { ok: boolean; stat: string; error?: string } {
  if (!isInitialized(storeDir)) return { ok: false, stat: '', error: 'store not initialized' };
  const r = runGit(storeDir, ['diff', '--stat', `${ref}..HEAD`]);
  if (!r.ok) return { ok: false, stat: '', error: r.stderr.trim() };
  return { ok: true, stat: r.stdout };
}

/**
 * Read a file's contents at a historical sha — `git show <sha>:<path>`.
 * `relPath` is relative to storeDir.
 */
export function showFileAt(storeDir: string, sha: string, relPath: string): { ok: boolean; content?: string; error?: string } {
  if (!isInitialized(storeDir)) return { ok: false, error: 'store not initialized' };
  const r = runGit(storeDir, ['show', `${sha}:${relPath}`]);
  if (!r.ok) return { ok: false, error: r.stderr.trim() };
  return { ok: true, content: r.stdout };
}
