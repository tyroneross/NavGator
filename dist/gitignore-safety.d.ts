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
export declare function ensureSafeGitignore(projectRoot: string): Promise<GitignoreGuardResult>;
//# sourceMappingURL=gitignore-safety.d.ts.map