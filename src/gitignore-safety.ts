/**
 * NavGator Gitignore Safety
 *
 * Auto-adds gitignore entries for NavGator's generated architecture output
 * that contains live-environment metadata. Specifically:
 *
 *   - .navgator/architecture/components/COMP_config_*.json
 *     These are per-env-var component files. NavGator's env scanner uses
 *     Node's URL class to strip usernames/passwords when parsing connection
 *     strings, so the files DO NOT contain credentials. However, they do
 *     contain parsed hostnames and ports (e.g. `db.project-ref.supabase.co`)
 *     which are identifying infrastructure info that users generally do not
 *     want in a public git history.
 *
 *   - .navgator/architecture/NAVSUMMARY.md
 *   - .navgator/architecture/NAVSUMMARY_FULL.md
 *     Summary files that inline the above hostnames.
 *
 * This runs at the end of every scan. Idempotent: if the entries are already
 * present (or a more-general rule like `.navgator/` is present), it's a no-op.
 *
 * Philosophy: NavGator's architecture data is regenerated from live env on
 * every scan, so losing it from git is zero-cost. The first run writes the
 * gitignore entries; subsequent runs notice they're there and skip.
 *
 * Opt-out: set NAVGATOR_SKIP_GITIGNORE_GUARD=1 in the environment, or delete
 * the managed block and NavGator will not re-add it (the marker comment is
 * load-bearing).
 */

import * as fs from 'fs';
import * as path from 'path';

const MARKER_START = '# >>> NavGator safety guard (auto-managed)';
const MARKER_END = '# <<< NavGator safety guard';

const GUARDED_PATTERNS = [
  '.navgator/architecture/components/COMP_config_*.json',
  '.navgator/architecture/NAVSUMMARY.md',
  '.navgator/architecture/NAVSUMMARY_FULL.md',
  // Legacy filenames from pre-rename NavGator versions — harmless if not written.
  '.navgator/architecture/SUMMARY.md',
  '.navgator/architecture/SUMMARY_FULL.md',
];

const BLOCK = [
  '',
  MARKER_START,
  '# These files are regenerated from .env on every NavGator scan and contain',
  '# parsed hostnames/endpoints from your live environment. Credentials are',
  '# stripped by NavGator, but hostnames/project refs still leak infra identity.',
  '# Safe to delete this block if you want the files tracked — NavGator will',
  '# not re-add it while the markers below are missing.',
  ...GUARDED_PATTERNS,
  MARKER_END,
  '',
].join('\n');

export interface GitignoreGuardResult {
  action: 'added' | 'already-present' | 'no-gitignore' | 'opt-out';
  gitignorePath: string;
}

/**
 * Ensure the project's .gitignore has NavGator-managed safety patterns.
 *
 * Runs silently unless a change is made. Returns a result object callers
 * can log if they want to surface the behavior.
 */
export async function ensureSafeGitignore(projectRoot: string): Promise<GitignoreGuardResult> {
  const gitignorePath = path.join(projectRoot, '.gitignore');

  // Opt-out via env var
  if (process.env.NAVGATOR_SKIP_GITIGNORE_GUARD === '1') {
    return { action: 'opt-out', gitignorePath };
  }

  // Nothing to do if .gitignore doesn't exist — don't create one just for this
  if (!fs.existsSync(gitignorePath)) {
    return { action: 'no-gitignore', gitignorePath };
  }

  let content: string;
  try {
    content = await fs.promises.readFile(gitignorePath, 'utf-8');
  } catch {
    return { action: 'no-gitignore', gitignorePath };
  }

  // Already has the managed block
  if (content.includes(MARKER_START)) {
    return { action: 'already-present', gitignorePath };
  }

  // User has a broader rule that covers the guarded patterns → no-op
  // (Don't add a duplicate block if `.navgator/` or equivalent is already ignored.)
  const broaderRules = [
    '.navgator/',
    '.navgator/architecture/',
    '.navgator/architecture/components/',
  ];
  const lines = content.split('\n').map((l) => l.trim());
  for (const broader of broaderRules) {
    if (lines.includes(broader)) {
      return { action: 'already-present', gitignorePath };
    }
  }

  // Append the managed block
  const needsTrailingNewline = content.length > 0 && !content.endsWith('\n');
  const newContent = content + (needsTrailingNewline ? '\n' : '') + BLOCK;
  await fs.promises.writeFile(gitignorePath, newContent, 'utf-8');

  return { action: 'added', gitignorePath };
}
