/**
 * NavGator Architecture Diff Engine
 * Computes structured diffs between architecture snapshots and manages timeline
 */
import { Snapshot, SnapshotComponent, SnapshotConnection, DiffResult, DiffSignificance, DiffTrigger, TimelineEntry, Timeline, NavGatorConfig } from './types.js';
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
 * Build a v2 snapshot directly from records the caller already holds in
 * memory (e.g. a scan's own `finalComponents` / `finalConnections`).
 *
 * This is the structural fix for the Phase 5 defect described in
 * `.build-loop/issues/scanner-full-scan-diff-reports-zero-after.md`:
 * `buildCurrentSnapshot` (below) re-reads storage, and on the full-scan path
 * that read can race the consolidated `components.full.jsonl` /
 * `connections.full.jsonl` rewrite — `clearStorage()` deletes those files
 * early, and they aren't rewritten until after the diff is computed, so the
 * storage-reading snapshot can see 0 components even though the scan
 * genuinely persisted hundreds. Building the "current" side of the diff from
 * the records the scan already holds and is *about* to persist makes
 * `components_after` structurally equal to what gets written — it cannot
 * disagree, because it IS the thing that gets written.
 */
export declare function buildSnapshotFromRecords(components: SnapshotSourceComponent[], connections: SnapshotSourceConnection[], reason?: string): Snapshot;
/**
 * Minimal shape `buildSnapshotFromRecords` needs from a component. A
 * structural subset of `ArchitectureComponent` (declared here rather than
 * imported to avoid the storage.js circular dependency that
 * `buildCurrentSnapshot` below works around with a dynamic import).
 */
export interface SnapshotSourceComponent {
    component_id: string;
    name: string;
    type: SnapshotComponent['type'];
    version?: string;
    status: SnapshotComponent['status'];
    role: {
        layer: SnapshotComponent['layer'];
        critical: boolean;
    };
}
/**
 * Minimal shape `buildSnapshotFromRecords` needs from a connection.
 */
export interface SnapshotSourceConnection {
    connection_id: string;
    from: {
        component_id: string;
    };
    to: {
        component_id: string;
    };
    connection_type: SnapshotConnection['type'];
    code_reference?: {
        file?: string;
    };
}
/**
 * Build a v2 snapshot from freshly-stored scan data (components + connections on disk).
 *
 * Storage-reading form, kept for callers that don't have the scan's in-memory
 * records on hand (CLI `navgator diff`/`arch-diff`, `git-aware/canonical.ts`).
 * The scanner's own Phase 5 diff does NOT use this — see
 * `buildSnapshotFromRecords` above for why.
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