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
import type { ComponentType } from './types.js';
/**
 * Directory names that mean "not this project's source". Deliberately narrow:
 * a false entry here silently hides real code from every consumer. `dist`,
 * `build`, `out`, and `runtime` are NOT here — they are common hand-written
 * directory names.
 */
export declare const VENDOR_PATH_SEGMENTS: readonly string[];
/** Directories that conventionally hold copies of other people's packages. */
export declare const VENDOR_CONTAINER_SEGMENTS: readonly string[];
export declare const EXTERNAL_PACKAGE_TYPES: readonly ComponentType[];
export declare function hasVendorSegment(filePath: string): boolean;
/**
 * True when the path sits directly inside a vendor container under a directory
 * named after a package the graph already knows as external — `web/runtime/
 * packages/react/index.js` when `react` is an npm component. The external-name
 * check is what keeps a first-party monorepo `packages/<workspace>/` out of it.
 */
export declare function underPackageContainer(filePath: string, externalNames: Set<string>): boolean;
//# sourceMappingURL=vendor-paths.d.ts.map