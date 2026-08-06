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
import { EXTERNAL_PACKAGE_TYPES, hasVendorSegment, underPackageContainer, } from '../vendor-paths.js';
// The vendor vocabulary is shared with `rules.ts` so the two surfaces cannot
// drift into disagreeing about what counts as somebody else's code. Re-exported
// here because this module was its original home.
export { VENDOR_PATH_SEGMENTS, VENDOR_CONTAINER_SEGMENTS, EXTERNAL_PACKAGE_TYPES, } from '../vendor-paths.js';
/** Every file path a component claims. */
export function componentPaths(component) {
    return component.source?.config_files ?? [];
}
/** Keeps a rejected pattern out of a wall of error text without hiding it entirely. */
function truncateForError(pattern) {
    return pattern.length > 80 ? `${pattern.slice(0, 80)}…` : pattern;
}
/** Hard caps on pattern shape — see `globToRegExp` for why. */
const GLOB_MAX_PATTERN_LENGTH = 400;
const GLOB_MAX_DOUBLE_STAR_SEGMENTS = 4;
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
export function globToRegExp(pattern) {
    if (pattern.length > GLOB_MAX_PATTERN_LENGTH) {
        throw new Error(`--exclude pattern is ${pattern.length} chars, over the ${GLOB_MAX_PATTERN_LENGTH}-char cap: ${JSON.stringify(truncateForError(pattern))}`);
    }
    const doubleStarCount = (pattern.match(/\*\*/g) ?? []).length;
    if (doubleStarCount > GLOB_MAX_DOUBLE_STAR_SEGMENTS) {
        throw new Error(`--exclude pattern has ${doubleStarCount} '**' segments, over the ${GLOB_MAX_DOUBLE_STAR_SEGMENTS}-segment cap: ${JSON.stringify(truncateForError(pattern))}`);
    }
    let out = '';
    for (let i = 0; i < pattern.length; i++) {
        const ch = pattern[i];
        if (ch === '*') {
            if (pattern[i + 1] === '*') {
                i++;
                if (pattern[i + 1] === '/') {
                    // `**/` means "zero or more whole directories". Emitting a bare `.*`
                    // and swallowing the slash loses the boundary, so `**/test` compiled
                    // to `^.*test$` and matched `mytest` — a silent false exclusion.
                    out += '(?:.*/)?';
                    i++;
                }
                else {
                    out += '.*';
                }
            }
            else {
                out += '[^/]*';
            }
        }
        else if (ch === '?') {
            out += '[^/]';
        }
        else {
            out += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
        }
    }
    return new RegExp(`^${out}$`);
}
/**
 * Select the internal, project-authored components worth mapping.
 *
 * `suspect_vendored` is reported rather than excluded on purpose: a monorepo's
 * own `packages/<name>` directory is a legitimate hit, so the call is the
 * user's. The count appearing in the manifest is what makes it a decision
 * instead of an accident.
 */
export function selectMappableComponents(components, options = {}) {
    const patterns = options.exclude ?? [];
    const matchers = patterns.map(globToRegExp);
    const externalNames = new Set(components
        .filter((c) => EXTERNAL_PACKAGE_TYPES.includes(c.type))
        .map((c) => c.name));
    const kept = [];
    const suspect = [];
    let excludedVendor = 0;
    let excludedGlob = 0;
    for (const component of components) {
        if (component.type !== 'component')
            continue;
        const paths = componentPaths(component);
        if (matchers.length > 0 && paths.some((p) => matchers.some((m) => m.test(p)))) {
            excludedGlob++;
            continue;
        }
        if (!options.includeVendored && paths.some(hasVendorSegment)) {
            excludedVendor++;
            continue;
        }
        if (paths.some((p) => underPackageContainer(p, externalNames))) {
            suspect.push(component.component_id);
        }
        kept.push(component);
    }
    return {
        kept,
        excluded_vendor: excludedVendor,
        excluded_glob: excludedGlob,
        suspect_vendored: suspect,
        patterns,
    };
}
//# sourceMappingURL=filter.js.map