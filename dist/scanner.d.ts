/**
 * NavGator Main Scanner
 * Orchestrates all component and connection scanners
 */
import { ArchitectureComponent, ArchitectureConnection, ScanResult, ScanWarning, FileChangeResult, GitInfo } from './types.js';
import { FieldUsageReport } from './scanners/infrastructure/field-usage-analyzer.js';
import { TypeSpecReport } from './scanners/infrastructure/typespec-validator.js';
import { PromptScanResult } from './scanners/prompts/index.js';
import { TimelineEntry, ArchitectureIndex } from './types.js';
/**
 * Mode the scanner runs in.
 * - 'auto': default. Inspect index + file changes; pick full or incremental.
 * - 'full': clearStorage + scan all files (forced).
 * - 'incremental': scan only walk-set (changedFiles ∪ reverseDeps).
 *   If no prior state exists, falls back to 'full'.
 */
export type ScanMode = 'auto' | 'full' | 'incremental';
export interface ScanOptions {
    quick?: boolean;
    connections?: boolean;
    verbose?: boolean;
    clearFirst?: boolean;
    incremental?: boolean;
    mode?: ScanMode;
    useAST?: boolean;
    prompts?: boolean;
    trackBranch?: boolean;
    fieldUsage?: boolean;
    typeSpec?: boolean;
    commit?: boolean;
    scip?: boolean;
    /**
     * Internal-only (Run 1.7 — Problem A). When the integrity check on an
     * incremental scan fails, the outer scan releases its lock and recursively
     * re-enters with `mode: 'full', clearFirst: true, _promotedFromIncremental: true`.
     * The inner scan honors this flag by labeling its timeline entry and stats
     * `scan_type: 'incremental→full'` (instead of plain 'full') so downstream
     * tooling — and the Run 1.6 #3 evidence-preservation contract — sees the
     * promotion. NEVER set this flag from outside scanner.ts.
     */
    _promotedFromIncremental?: boolean;
    /** Run 2 — D4: skip the SQC audit pass entirely. */
    noAudit?: boolean;
    /** Run 2 — D4: override the audit's plan-selection auto-pick. */
    auditPlan?: 'AQL' | 'SPRT' | 'Cochran' | 'aql' | 'sprt' | 'cochran';
    /** Run 2 — D4: signal that NavGator is being invoked from an MCP session
     *  (vs. CLI). Enables the LLM-judge MISSED_EDGE verifier. */
    isMcpMode?: boolean;
}
export interface ScanModeDecision {
    mode: 'full' | 'incremental';
    reason: 'flag-full' | 'flag-incremental' | 'no-prior-state' | 'schema-mismatch' | 'manifest-changed' | 'new-files' | 'stale-full' | 'incremental-cap' | 'no-changes' | 'fast-path' | 'audit-drift-breach';
}
/**
 * Decide whether to run a full or incremental scan based on the requested
 * mode, the prior index state, and the file changes since last scan.
 *
 * Pure function — no I/O. All inputs precomputed by the caller.
 *
 * Policy (for mode='auto'):
 * 1. No prior index → full / no-prior-state
 * 2. schema_version mismatch (and not 1.0.0 → 1.1.0 soft-upgrade) → full / schema-mismatch
 * 3. Any FULL_SCAN_TRIGGER_FILES in changedFiles → full / manifest-changed
 * 4. now − last_full_scan > 7 days → full / stale-full
 * 5. incrementals_since_full ≥ 20 → full / incremental-cap
 * 6. No file changes at all → noop case (caller handles); we still return
 *    'incremental' here for the no-op flow.
 * 7. Else → incremental / fast-path
 */
export declare function selectScanMode(fileChanges: FileChangeResult | undefined, index: ArchitectureIndex | null, options: {
    mode?: ScanMode;
    clearFirst?: boolean;
    incremental?: boolean;
}, now?: number): ScanModeDecision;
/**
 * Run a full architecture scan
 */
export declare function scan(projectRoot?: string, options?: ScanOptions): Promise<{
    components: ArchitectureComponent[];
    connections: ArchitectureConnection[];
    warnings: ScanWarning[];
    fileChanges?: FileChangeResult;
    promptScan?: PromptScanResult;
    fieldUsageReport?: FieldUsageReport;
    typeSpecReport?: TypeSpecReport;
    timelineEntry?: TimelineEntry;
    gitInfo?: GitInfo;
    stats: {
        scan_duration_ms: number;
        components_found: number;
        connections_found: number;
        warnings_count: number;
        files_scanned: number;
        files_changed: number;
        prompts_found?: number;
    };
}>;
/**
 * Quick scan - only packages, no code analysis
 */
export declare function quickScan(projectRoot?: string): Promise<ScanResult>;
/**
 * Scan only for AI prompts (detailed)
 */
export declare function scanPromptsOnly(projectRoot?: string, options?: {
    verbose?: boolean;
}): Promise<PromptScanResult>;
export { formatPromptsOutput, formatPromptDetail } from './scanners/prompts/index.js';
export type { PromptScanResult, DetectedPrompt } from './scanners/prompts/index.js';
export { traceLLMCalls } from './scanners/connections/llm-call-tracer.js';
export type { TracedLLMCall, LLMTraceResult } from './scanners/connections/llm-call-tracer.js';
/**
 * Get scan status/summary without running a full scan
 */
export declare function getScanStatus(projectRoot?: string): Promise<{
    initialized: boolean;
    last_scan: number | null;
    needs_rescan: boolean;
    component_count: number;
    connection_count: number;
}>;
//# sourceMappingURL=scanner.d.ts.map