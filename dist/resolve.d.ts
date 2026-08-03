/**
 * NavGator Component Resolution
 * Resolves component queries (names, file paths, IDs) to ArchitectureComponent objects
 */
import type { ArchitectureComponent } from './types.js';
/**
 * Resolve a query string to an architecture component.
 *
 * Resolution order:
 * 1. Exact component ID match
 * 2. Exact component name match (case-insensitive)
 * 3. File path match via fileMap → component ID → component
 * 4. Partial name match (substring, case-insensitive)
 * 4b. Base-name alias match (e.g. "Railway" / "Railway Config" / "Railway (infra)"
 *     all collapse to the same identity) — fires only when step 4 found nothing,
 *     preferring the candidate with the most connections.
 * 5. File path substring match (normalized, no leading ./)
 */
export declare function resolveComponent(query: string, components: ArchitectureComponent[], fileMap?: Record<string, string>): ArchitectureComponent | null;
/**
 * Find candidate suggestions when resolution fails.
 * Returns up to 5 closest matches for "Did you mean?" hints.
 */
export declare function findCandidates(query: string, components: ArchitectureComponent[], maxResults?: number): string[];
//# sourceMappingURL=resolve.d.ts.map