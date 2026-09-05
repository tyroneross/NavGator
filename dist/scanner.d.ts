/**
 * NavGator Main Scanner
 * Orchestrates all component and connection scanners
 */
/**
 * Remove files ignored by the owning Git repository. `.gitignore` is the
 * broadest source-grounded signal that a generated tree is not project source
 * (for example the packaged `web/runtime/` dashboard). Tracked files are never
 * removed by `git check-ignore`, even when a later pattern would match them.
 * Non-Git directories and unavailable Git binaries fail open to the explicit
 * NavGator ignore list above.
 */
export declare function excludeGitIgnoredFiles(root: string, files: string[]): string[];
import { ArchitectureComponent, ArchitectureConnection, FileChangeResult, ArchitectureScanOutcome } from './types.js';
import { FieldUsageReport } from './scanners/infrastructure/field-usage-analyzer.js';
import { TypeSpecReport } from './scanners/infrastructure/typespec-validator.js';
import { PromptScanResult } from './scanners/prompts/index.js';
import { type ScanLease } from './scan-lock.js';
import { TimelineEntry, ArchitectureIndex } from './types.js';
/**
 * Canonical form for a repo-relative file path used as a `FILE:` endpoint or
 * a component's config_files entry (Run 4 fix2 #4): forward slashes, no
 * leading `./`, no duplicated separators. `FILE:./src/a.ts`, `FILE:src//a.ts`
 * and a component claiming `src/a.ts` must all meet on the same key.
 */
export declare function normalizeEndpointPath(p: string): string;
/**
 * (C) Resolve FILE: prefixed connection endpoints to real component IDs so
 * trace can follow imports from route files instead of dead-ending.
 *
 * (C2) Synthesize a file-node for every FILE: endpoint that survived (C).
 * A surviving FILE: ref names a real source file that no scanner claimed as
 * a component — Swift and Rust files, and TypeScript files the import
 * scanner never walked (scripts/, _archive/, tests/). Storing such an edge
 * leaves it dangling: `runIntegrityCheck` (storage.ts) exempts FILE: ids
 * unconditionally, so the graph reports "ok" while trace dead-ends and the
 * audit counts the edge as hallucinated. One file-node per file, created
 * once, reused by every endpoint naming that file; only for paths that exist
 * on disk (a component built on a phantom path would fail integrity check
 * rule (2) and promote every later incremental scan to full).
 *
 * Mutates `components` (pushes file-nodes) and the endpoint ids in
 * `connections`. Paths are normalized on both sides (fix2 #4).
 */
export declare function resolveFileEndpoints(components: ArchitectureComponent[], connections: ArchitectureConnection[], root: string): void;
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
     * incremental scan fails, the outer scan recursively re-enters while reusing
     * its lease with `mode: 'full', clearFirst: true, _promotedFromIncremental: true`.
     * The inner scan honors this flag by labeling its timeline entry and stats
     * `scan_type: 'incremental→full'` (instead of plain 'full') so downstream
     * tooling — and the Run 1.6 #3 evidence-preservation contract — sees the
     * promotion. NEVER set this flag from outside scanner.ts.
     */
    _promotedFromIncremental?: boolean;
    /** Internal-only: recursive incremental-to-full promotion reuses the same
     * owner-safe lease. NEVER set this outside scanner.ts. */
    _scanLease?: ScanLease;
    /** Internal-only freshness callback. Runs after persistence and before this
     * scan releases its canonical lease. */
    _beforeLeaseRelease?: () => Promise<void>;
    /** Internal-only freshness lifecycle callbacks. */
    _onLeaseAcquired?: () => Promise<void>;
    _onLeaseFailureBeforeRelease?: () => Promise<void>;
    /** Internal-only dirty-ledger paths that must be included in this walk. */
    _forcedChangedFiles?: string[];
    /** Internal-only setup lifecycle marker persisted with the canonical index. */
    _setupPhase?: 'fast' | 'deep';
    /** Test seam for a mutation after scanner reads but before hash persistence. */
    _beforeHashSave?: () => Promise<void>;
    /** Run 2 — D4: skip the SQC audit pass entirely. */
    noAudit?: boolean;
    /** Run 2 — D4: override the audit's plan-selection auto-pick. */
    auditPlan?: 'AQL' | 'SPRT' | 'Cochran' | 'aql' | 'sprt' | 'cochran';
    /** Run 2 — D4: signal that NavGator is being invoked from an MCP session
     *  (vs. CLI). Enables the LLM-judge MISSED_EDGE verifier. */
    isMcpMode?: boolean;
    /** Multi-stack auto-discovery: when the project root carries no stack
     *  manifest (no package.json/pyproject.toml/etc), search nested wrapper
     *  directories and scan each manifest-bearing subdirectory. Defaults to ON. Pass
     *  `singleStack: true` to force the legacy behavior — scan only the
     *  given root regardless of subdirs. */
    singleStack?: boolean;
    /** R6 footprint fix: when true, write per-component and per-connection JSON
     *  files alongside the consolidated graph. Default false (off). Overrides
     *  config.perEntityFiles / NAVGATOR_PER_ENTITY_FILES when set. */
    perEntityFiles?: boolean;
    /** Opt-in Markdown/content graph scanning. Also enabled by NAVGATOR_CONTENT=1. */
    content?: boolean;
}
/**
 * Search nested wrapper directories under `root`, return roots to scan. Behavior:
 *
 *  - If `root` has a stack manifest, include it as `{ origin: '.' }`.
 *  - Discover manifests up to five directory levels below the scan root. Any
 *    matching directory is included and nested stack descendants are pruned.
 *  - When more than one nested stack is found, all of them are scanned and
 *    components get an `origin_root` metadata tag so consumers can group.
 *
 * Uses the same `.navgatorignore` and Git-ignore boundary as source discovery.
 */
export declare function discoverStackRoots(root: string, verbose: boolean): Array<{
    path: string;
    origin: string;
}>;
export interface ScanModeDecision {
    mode: 'full' | 'incremental';
    reason: 'flag-full' | 'flag-incremental' | 'no-prior-state' | 'schema-mismatch' | 'stable-id-scheme-mismatch' | 'manifest-changed' | 'new-files' | 'stale-full' | 'incremental-cap' | 'no-changes' | 'fast-path' | 'audit-drift-breach';
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
 * Languages a registered scanner actually consumes, keyed to the same
 * strings `LANGUAGE_BY_EXTENSION` (imported from `architecture-index.ts`)
 * produces. A language absent from this set is still counted (files,
 * components-that-happen-to-resolve) for coverage purposes, but its
 * `internal_edges` is always reported as 0 — no scanner ever looked at it, so
 * "zero" there means "not measured", never "not coupled".
 *
 * Deliberately WIDER than `architecture-index.ts`'s `ANALYZED_LANGUAGES`:
 * the full `scan` command additionally runs the Swift and Rust code
 * scanners (`scanSwiftCode` / `scanRustCode`, see imports above), which
 * `arch-index` never invokes — it builds its graph from `scanImports` alone.
 * Do not merge the two sets; doing so would make one of the two commands
 * claim coverage it does not have.
 *
 * Adding a new language scanner means adding its language string here too.
 * Nothing else in this file infers the analyzed set from scanner presence —
 * a future scanner author must add the entry explicitly or their new
 * language will silently keep reading as an unanalyzed blind spot.
 */
export declare const SCAN_COVERAGE_ANALYZED_LANGUAGES: Set<string>;
/**
 * Run a full architecture scan
 */
/**
 * Does a timeline diff agree with the component count the scan actually
 * persisted?
 *
 * A diff whose `components_after` disagrees with what was just written is
 * describing a different scan than the one that happened. See the call site in
 * `scan()` for the two real entries in this repo's own timeline that exhibit
 * it, and why the resulting event is suppressed rather than repaired here (the
 * root cause is upstream in the Phase 5 snapshot build; this boundary only
 * refuses to make it durable).
 *
 * Returns false when there is no diff at all, so the caller's ternary handles
 * both "nothing to report" and "cannot be trusted" the same way.
 */
export declare function isDiffConsistentWithScan(entry: TimelineEntry | undefined, finalComponentCount: number): boolean;
export declare function scan(projectRoot?: string, options?: ScanOptions): Promise<ArchitectureScanOutcome<PromptScanResult, FieldUsageReport, TypeSpecReport>>;
/**
 * Quick scan - only packages, no code analysis
 */
export declare function quickScan(projectRoot?: string): Promise<ArchitectureScanOutcome<PromptScanResult, FieldUsageReport, TypeSpecReport>>;
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
 * R6 auto-refresh: run a policy-selected scan when the on-disk graph is stale.
 *
 * Cheap by design — checks only `index.last_scan` age. If older than
 * `staleAfterMinutes` (default 5), kicks off `scan({ mode: 'auto' })`, which
 * preserves manifest/config full-scan triggers and fast-paths ordinary source
 * edits or "no-changes" cases.
 * Per-entity files stay off (the default); auto-refresh is footprint-safe.
 *
 * Returns a one-line description that callers can surface to the user. Never
 * throws — auto-refresh is best-effort and must never block a read tool.
 *
 * Opt-out: pass `enabled: false` (CLI `--no-refresh`) or set env
 * `NAVGATOR_AUTO_REFRESH=false`.
 */
export interface AutoRefreshOptions {
    /** Default true. Programmatic override beats the env var. */
    enabled?: boolean;
    /** Default 5 minutes. Older than this → trigger policy-selected refresh. */
    staleAfterMinutes?: number;
    /**
     * Test-seam: swap the scan implementation. Defaults to the real `scan`
     * exported above. Tests use this to spy without dispatching real work.
     */
    scanImpl?: typeof scan;
}
export interface AutoRefreshResult {
    refreshed: boolean;
    /** "stale", "fresh", "no-index", "disabled", "busy", "error" */
    reason: 'stale' | 'fresh' | 'no-index' | 'disabled' | 'busy' | 'error';
    /** Files updated by the refresh (only set on `refreshed: true`). */
    filesChanged?: number;
    /** Human-readable summary suitable for one-line stderr / status emit. */
    message: string;
}
export declare function autoRefreshIfStale(projectRoot?: string, options?: AutoRefreshOptions): Promise<AutoRefreshResult>;
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