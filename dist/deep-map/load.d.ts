/**
 * Tier-0 input loader.
 *
 * Everything deep-map reasons about comes from artifacts the scanner already
 * wrote. This module is the single place that reads them, so the scoring and
 * partitioning code stays pure functions over in-memory data and can be tested
 * without touching disk.
 *
 * A missing artifact is not an error here: `metrics.json` is absent on small
 * graphs by design, and `file_map.json` may lag a partial scan. Callers get
 * nulls and empty maps and decide what that means.
 */
import type { MetricsReport } from '../metrics/pagerank-louvain.js';
import type { ArchitectureComponent, ArchitectureConnection, NavGatorConfig } from '../types.js';
import type { RuleViolation } from '../rules.js';
import type { DeepMapProvenance } from './types.js';
export interface Tier0Data {
    components: ArchitectureComponent[];
    connections: ArchitectureConnection[];
    metrics: MetricsReport | null;
    fileMap: Record<string, string>;
    violations: RuleViolation[];
    /** True when there is no scan on disk at all — callers map this to NO_DATA. */
    empty: boolean;
}
export declare function loadTier0(config?: NavGatorConfig, projectRoot?: string): Promise<Tier0Data>;
/**
 * Invert `file_map.json` into component_id -> file paths, sorted so packet
 * contents stay byte-stable across runs.
 */
export declare function buildComponentFileIndex(fileMap: Record<string, string>): Map<string, string[]>;
/**
 * Where the scanned project came from. A repo fetched by `scan-remote` was
 * authored by someone else, so its component names and file paths are untrusted
 * strings that will be embedded in packet prompts — the packet builder carries a
 * warning when this says so.
 *
 * Fails closed, not open: any error reading the registry returns `origin:
 * 'unknown', untrusted: true` rather than silently reporting `local`. A
 * registry read failure is exactly the kind of ambiguity the untrusted-source
 * warning exists to surface, not suppress.
 */
export declare function resolveProvenance(projectPath: string): Promise<DeepMapProvenance>;
//# sourceMappingURL=load.d.ts.map