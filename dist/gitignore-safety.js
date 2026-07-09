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
import * as crypto from 'crypto';
import { execFileSync } from 'child_process';
const MARKER_START = '# >>> NavGator safety guard (auto-managed)';
const MARKER_END = '# <<< NavGator safety guard';
const GUARDED_PATTERNS = [
    '.navgator/architecture/components/COMP_config_*.json',
    // R6 consolidated full-shape JSONL files carry the same env-hostname data as
    // the per-entity COMP_config_*.json files (they inline every component the
    // scanner produced, including env-parsed hostnames). Guard them so the
    // previous COMP_config_* rule isn't rendered inert when per-entity files are
    // off (the R6 default).
    '.navgator/architecture/components.full.jsonl',
    '.navgator/architecture/connections.full.jsonl',
    '.navgator/architecture/NAVSUMMARY.md',
    '.navgator/architecture/NAVSUMMARY_FULL.md',
    // Legacy filenames from pre-rename NavGator versions — harmless if not written.
    '.navgator/architecture/SUMMARY.md',
    '.navgator/architecture/SUMMARY_FULL.md',
    // Freshness and writer-coordination state is always local and may contain
    // project-relative paths. Ignore both durable files and crash leftovers.
    '.navgator/dirty.json',
    '.navgator/dirty.d/',
    '.navgator/dirty.lock*',
    '.navgator/scan.lock*',
    '.navgator/architecture/freshness.json.tmp*',
];
const MANAGED_BLOCK = [
    MARKER_START,
    '# These files are regenerated from .env on every NavGator scan and contain',
    '# parsed hostnames/endpoints from your live environment. Credentials are',
    '# stripped by NavGator, but hostnames/project refs still leak infra identity.',
    '# Safe to delete this block if you want the files tracked — NavGator will',
    '# not re-add it while the markers below are missing.',
    ...GUARDED_PATTERNS,
    MARKER_END,
].join('\n');
const BLOCK = `\n${MANAGED_BLOCK}\n`;
function ignoreTarget(projectRoot) {
    const projectGitignore = path.join(projectRoot, '.gitignore');
    if (fs.existsSync(projectGitignore)) {
        if (!fs.lstatSync(projectGitignore).isSymbolicLink())
            return projectGitignore;
    }
    try {
        const resolved = execFileSync('git', ['-C', projectRoot, 'rev-parse', '--path-format=absolute', '--git-path', 'info/exclude'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
        if (!resolved)
            return null;
        if (fs.existsSync(resolved) && fs.lstatSync(resolved).isSymbolicLink())
            return null;
        return resolved;
    }
    catch {
        return null;
    }
}
async function writeIgnoreFile(target, content) {
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    const candidate = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.${crypto.randomUUID()}.tmp`);
    try {
        await fs.promises.writeFile(candidate, content, { encoding: 'utf8', flag: 'wx' });
        await fs.promises.rename(candidate, target);
    }
    finally {
        await fs.promises.rm(candidate, { force: true });
    }
}
/**
 * Ensure the project's .gitignore has NavGator-managed safety patterns.
 *
 * Runs silently unless a change is made. Returns a result object callers
 * can log if they want to surface the behavior.
 */
export async function ensureSafeGitignore(projectRoot) {
    const projectGitignore = path.join(projectRoot, '.gitignore');
    const gitignorePath = ignoreTarget(projectRoot);
    // Opt-out via env var
    if (process.env.NAVGATOR_SKIP_GITIGNORE_GUARD === '1') {
        return { action: 'opt-out', gitignorePath: gitignorePath ?? projectGitignore };
    }
    // Outside a Git worktree, do not create a project file solely for the guard.
    if (!gitignorePath) {
        return { action: 'no-gitignore', gitignorePath: projectGitignore };
    }
    let content = '';
    try {
        content = await fs.promises.readFile(gitignorePath, 'utf-8');
    }
    catch (error) {
        if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) {
            return { action: 'no-gitignore', gitignorePath };
        }
    }
    // Upgrade an older managed block in place when new runtime files are added.
    const markerStart = content.indexOf(MARKER_START);
    if (markerStart >= 0) {
        const markerEnd = content.indexOf(MARKER_END, markerStart);
        if (markerEnd < 0)
            return { action: 'no-gitignore', gitignorePath };
        const blockEnd = markerEnd + MARKER_END.length;
        const currentBlock = content.slice(markerStart, blockEnd);
        if (currentBlock === MANAGED_BLOCK) {
            return { action: 'already-present', gitignorePath };
        }
        const updated = `${content.slice(0, markerStart)}${MANAGED_BLOCK}${content.slice(blockEnd)}`;
        await writeIgnoreFile(gitignorePath, updated);
        return { action: 'updated', gitignorePath };
    }
    // User has a broader rule that covers the guarded patterns → no-op
    // (Don't add a duplicate block if `.navgator/` or equivalent is already ignored.)
    const broaderRules = ['.navgator/'];
    const lines = content.split('\n').map((l) => l.trim());
    for (const broader of broaderRules) {
        if (lines.includes(broader)) {
            return { action: 'already-present', gitignorePath };
        }
    }
    // Append the managed block
    const needsTrailingNewline = content.length > 0 && !content.endsWith('\n');
    const newContent = content + (needsTrailingNewline ? '\n' : '') + BLOCK;
    await writeIgnoreFile(gitignorePath, newContent);
    return { action: 'added', gitignorePath };
}
//# sourceMappingURL=gitignore-safety.js.map