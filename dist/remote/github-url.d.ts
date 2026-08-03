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
export declare function parseGitHubUrl(input: unknown): ParsedGitHubUrl | null;
//# sourceMappingURL=github-url.d.ts.map