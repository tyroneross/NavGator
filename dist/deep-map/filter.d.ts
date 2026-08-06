/**
 * Which components are worth an LLM pass.
 *
 * Restricting to `type === 'component'` is not enough. Measured on NavGator
 * itself at one point in time (the `.navgator/` store is gitignored and moves
 * with the repo, so treat the figures as illustrative): most components are
 * internal by that test, but roughly 70 of them are vendored third-party
 * JavaScript checked into `web/runtime/` by a build script — an entire Louvain
 * community of ~46 nodes is the npm `semver` package. Left in, about a sixth of
 * the tier-1 budget would pay an agent to describe code the project did not
 * write.
 *
 * There is no path heuristic that catches that case generally. The unambiguous
 * vendor directory names (`node_modules`, `vendor`, `Pods`, …) do not appear in
 * `web/runtime/packages/semver`, and a list broad enough to catch it would
 * wrongly exclude hand-written `src/runtime/` in some other repo. So this module
 * does three separate things instead of pretending one rule suffices:
 *
 *   1. Excludes the unambiguous vendor directories by default.
 *   2. Accepts explicit `--exclude` globs (the CLI flag is the only source —
 *      there is no persisted config key for this today), which is how a
 *      project excludes its own generated tree.
 *   3. Flags what it could not decide: a component sitting under a container
 *      directory whose child name matches a scanned external package is marked
 *      `suspect_vendored` and counted in the manifest, so paying to describe
 *      `semver` is visible rather than silent.
 */
import type { ArchitectureComponent } from '../types.js';
/**
 * Directory names that mean "not authored here" in every ecosystem we scan.
 * Deliberately conservative: each entry would be surprising as a hand-written
 * source directory. `dist`, `build`, `out`, and `runtime` are NOT here — they
 * are common hand-written directory names and excluding them by default would
 * silently drop real code.
 */
export declare const VENDOR_PATH_SEGMENTS: readonly string[];
export interface ComponentFilterOptions {
    /** Extra glob patterns to exclude, e.g. `web/runtime/**`. */
    exclude?: string[];
    /** Skip the built-in vendor-directory exclusion. */
    includeVendored?: boolean;
}
export interface ComponentFilterResult {
    kept: ArchitectureComponent[];
    /** Excluded because a path segment is an unambiguous vendor directory. */
    excluded_vendor: number;
    /** Excluded by a caller-supplied glob. */
    excluded_glob: number;
    /** Kept, but sitting under a container dir named for a scanned package. */
    suspect_vendored: string[];
    patterns: string[];
}
/** Every file path a component claims. */
export declare function componentPaths(component: ArchitectureComponent): string[];
/**
 * Minimal glob: `*` matches within a path segment, `**` matches across
 * segments, `?` matches one character. Enough for exclusion patterns and small
 * enough to reason about — no dependency.
 *
 * Each `**` compiles to a `.*` quantifier. A single one is cheap, but several
 * `**` segments separated by literals compose into polynomial-time
 * backtracking on a crafted input (classic ReDoS shape: `.*a.*a.*a.*a`
 * against a string with no `a`). Patterns are caller-supplied (`--exclude`),
 * so the cap is enforced here rather than trusted to the caller: a pattern
 * over `GLOB_MAX_PATTERN_LENGTH` chars or with more than
 * `GLOB_MAX_DOUBLE_STAR_SEGMENTS` `**` segments throws before compiling,
 * surfacing as a CLI usage error instead of a hang.
 */
export declare function globToRegExp(pattern: string): RegExp;
/**
 * Select the internal, project-authored components worth mapping.
 *
 * `suspect_vendored` is reported rather than excluded on purpose: a monorepo's
 * own `packages/<name>` directory is a legitimate hit, so the call is the
 * user's. The count appearing in the manifest is what makes it a decision
 * instead of an accident.
 */
export declare function selectMappableComponents(components: ArchitectureComponent[], options?: ComponentFilterOptions): ComponentFilterResult;
//# sourceMappingURL=filter.d.ts.map