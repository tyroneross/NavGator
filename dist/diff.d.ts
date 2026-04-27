/**
 * NavGator Architecture Diff Engine
 * Computes structured diffs between architecture snapshots and manages timeline
 */
import { Snapshot, DiffResult, DiffSignificance, DiffTrigger, TimelineEntry, Timeline, NavGatorConfig } from './types.js';
/**
 * Compute a structured diff between two snapshots.
 * Returns added/removed/modified components and added/removed connections.
 */
export declare function computeArchitectureDiff(previous: Snapshot | null, current: Snapshot): DiffResult;
/**
 * Classify the significance of a diff.
 * Major: database/infra layer changes, >20% components changed, new layer introduced
 * Minor: new packages, connection changes, major semver bumps
 * Patch: everything else (version patches, status changes)
 */
export declare function classifySignificance(diff: DiffResult): {
    significance: DiffSignificance;
    triggers: DiffTrigger[];
};
/**
 * Load the timeline from disk
 */
export declare function loadTimeline(config?: NavGatorConfig, projectRoot?: string): Promise<Timeline>;
/**
 * Append a timeline entry and prune to history limit
 */
export declare function saveTimelineEntry(entry: TimelineEntry, config?: NavGatorConfig, projectRoot?: string): Promise<void>;
/**
 * Load the most recent snapshot from the snapshots directory
 */
export declare function loadLatestSnapshot(config?: NavGatorConfig, projectRoot?: string): Promise<Snapshot | null>;
/**
 * Build a v2 snapshot from freshly-stored scan data (components + connections on disk)
 */
export declare function buildCurrentSnapshot(config?: NavGatorConfig, projectRoot?: string): Promise<Snapshot>;
/**
 * Generate a timeline entry ID
 */
export declare function generateTimelineId(): string;
/**
 * Format timeline for CLI display
 */
export declare function formatTimeline(timeline: Timeline, options?: {
    limit?: number;
    significance?: DiffSignificance;
    json?: boolean;
}): string;
/**
 * Format a single diff entry for detailed CLI display
 */
export declare function formatDiffSummary(entry: TimelineEntry, json?: boolean): string;
/**
 * Format a diff result as markdown for NAVSUMMARY.md
 */
export declare function formatDiffForSummary(entry: TimelineEntry): string[];
//# sourceMappingURL=diff.d.ts.map