/**
 * Loader for `~/.navgator/config.json` — home-scoped configuration.
 *
 * `src/config.ts` already exists, but it is project/storage scoped: it
 * answers "where does THIS project's architecture data live?" and is loaded
 * fresh per project via env vars (`NAVGATOR_MODE`, `NAVGATOR_PATH`, etc.).
 * This module answers a different question — "what does the USER want,
 * machine-wide, for the one thing every project shares: `~/.navgator/`?" —
 * which is why it is a separate module rather than an addition to
 * `config.ts`. Today the only home-scoped feature is gator-memory
 * (`src/memory/store.ts`), but the shape leaves room for more.
 *
 * This module never WRITES the file. Reading is the only supported path; a
 * later chunk documents the shape for a user to hand-author. That is a
 * deliberate asymmetry with `src/config.ts`, which has no file at all today —
 * `home-config.ts` has a file, but this module is not the thing that
 * produces it.
 *
 * Fail-open, mirroring every other config loader in this codebase
 * (`journalEnabled()` in `registry-journal.ts`, `getConfig()` in
 * `config.ts`): an absent file is the primary case and produces all
 * defaults; a malformed file ALSO produces all defaults, silently, rather
 * than throwing and taking down whatever called in to check
 * `memory.enabled`. A broken config file must never break a scan.
 *
 * Precedence is env > file > default, applied in that order in
 * `loadHomeConfig()`. An unknown key in the file is ignored rather than
 * rejected — `deepMerge` only ever merges keys that exist in
 * `DEFAULT_HOME_CONFIG`'s shape, and only when the override's type matches
 * the default's type, so a typo'd or forward-compatible key in a hand-edited
 * config degrades to "ignored" rather than "config is now broken".
 */
export interface NavGatorHomeConfig {
    version: number;
    memory: {
        enabled: boolean;
        maxMilestonesPerProject: number;
        maxEventBytes: number;
        mirror: {
            enabled: boolean;
            target: string;
        };
    };
}
/**
 * Resolved PER CALL, never a module-level const — same reasoning as
 * `memoryDir()` in `src/memory/store.ts`: a test that redirects `$HOME`
 * before calling in must actually redirect this path too.
 */
export declare function homeConfigPath(): string;
/**
 * Load `~/.navgator/config.json`, merged over defaults, with env overrides
 * applied last. Cached after the first call; use `resetHomeConfigCache()`
 * (test seam, mirrors `resetConfig()` in `src/config.ts:391-393`) to force a
 * re-read.
 */
export declare function loadHomeConfig(): NavGatorHomeConfig;
/** Test seam: forget the cached config so the next `loadHomeConfig()` re-reads. */
export declare function resetHomeConfigCache(): void;
//# sourceMappingURL=home-config.d.ts.map