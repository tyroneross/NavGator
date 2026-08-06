/**
 * Which components are worth an LLM pass.
 *
 * Restricting to `type === 'component'` is not enough. Measured on NavGator
 * itself: 437 of 507 components are internal by that test, but 72 of those 437
 * are vendored third-party JavaScript checked into `web/runtime/` by a build
 * script — an entire 46-node Louvain community is the npm `semver` package.
 * Left in, ~16% of the tier-1 budget would pay an agent to describe code the
 * project did not write.
 *
 * There is no path heuristic that catches that case generally. The unambiguous
 * vendor directory names (`node_modules`, `vendor`, `Pods`, …) do not appear in
 * `web/runtime/packages/semver`, and a list broad enough to catch it would
 * wrongly exclude hand-written `src/runtime/` in some other repo. So this module
 * does three separate things instead of pretending one rule suffices:
 *
 *   1. Excludes the unambiguous vendor directories by default.
 *   2. Accepts explicit `--exclude` globs (also persistable in NavGator config),
 *      which is how a project excludes its own generated tree.
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
 * enough to reason about — no dependency, no catastrophic backtracking, since
 * the only quantifiers emitted are `[^/]*` and `.*`.
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