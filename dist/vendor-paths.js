/**
 * Vendored-path recognition, shared by the deep-map component filter and the
 * architecture rules.
 *
 * Both surfaces need the same answer to "is this file somebody else's code?" —
 * deep-map so it does not spend a mapping agent describing a copied package,
 * and `transitively-dead` so it does not report a vendored tree as dead code
 * the author is expected to delete. Keeping one list means the two can never
 * drift into disagreeing about what counts as vendored.
 */
/**
 * Directory names that mean "not this project's source". Deliberately narrow:
 * a false entry here silently hides real code from every consumer. `dist`,
 * `build`, `out`, and `runtime` are NOT here — they are common hand-written
 * directory names.
 */
export const VENDOR_PATH_SEGMENTS = [
    'node_modules',
    'bower_components',
    'vendor',
    'third_party',
    'thirdparty',
    '__generated__',
    '.next',
    '.nuxt',
    '.venv',
    'site-packages',
    'Pods',
    'Carthage',
];
/** Directories that conventionally hold copies of other people's packages. */
export const VENDOR_CONTAINER_SEGMENTS = [
    'packages',
    'deps',
    'externals',
    'vendor',
    'node_modules',
    'third_party',
];
export const EXTERNAL_PACKAGE_TYPES = [
    'npm',
    'pip',
    'cargo',
    'spm',
    'go',
    'gem',
    'composer',
];
export function hasVendorSegment(filePath) {
    return filePath.split('/').some((seg) => VENDOR_PATH_SEGMENTS.includes(seg));
}
/**
 * True when the path sits directly inside a vendor container under a directory
 * named after a package the graph already knows as external — `web/runtime/
 * packages/react/index.js` when `react` is an npm component. The external-name
 * check is what keeps a first-party monorepo `packages/<workspace>/` out of it.
 */
export function underPackageContainer(filePath, externalNames) {
    const segs = filePath.split('/');
    for (let i = 1; i < segs.length; i++) {
        if (VENDOR_CONTAINER_SEGMENTS.includes(segs[i - 1]) && externalNames.has(segs[i])) {
            return true;
        }
    }
    return false;
}
//# sourceMappingURL=vendor-paths.js.map