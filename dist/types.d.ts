/**
 * NavGator Type Definitions
 * Architecture connection tracking for Claude Code
 */
/**
 * Types of architecture components that NavGator tracks
 */
export type ComponentType = 'npm' | 'pip' | 'spm' | 'cargo' | 'go' | 'gem' | 'composer' | 'framework' | 'database' | 'queue' | 'infra' | 'service' | 'llm' | 'config' | 'cron' | 'api-endpoint' | 'db-table' | 'prompt' | 'worker' | 'component' | 'xcode-target' | 'other';
/**
 * Architecture layer classification
 */
export type ArchitectureLayer = 'frontend' | 'backend' | 'database' | 'queue' | 'infra' | 'external';
/**
 * Component status
 */
export type ComponentStatus = 'active' | 'outdated' | 'deprecated' | 'vulnerable' | 'unused' | 'removed';
/**
 * Reference to a connection (used in component's connects_to/connected_from)
 */
export interface ConnectionRef {
    connection_id: string;
    target_component_id: string;
    connection_type: ConnectionType;
}
/**
 * Architecture Component
 * Represents a package, service, framework, or other trackable component
 */
export interface ArchitectureComponent {
    component_id: string;
    /**
     * Stable, deterministic identifier derived from type + canonical name.
     * Format: STABLE_<type>_<slug>. Same component across scans → same stable_id.
     * Used as the cross-scan join key for PageRank persistence, git diffs, timeline tracking.
     */
    stable_id?: string;
    name: string;
    version?: string;
    type: ComponentType;
    role: {
        purpose: string;
        layer: ArchitectureLayer;
        critical: boolean;
    };
    source: {
        detection_method: 'auto' | 'manual' | 'hook';
        config_files: string[];
        confidence: number;
    };
    connects_to: ConnectionRef[];
    connected_from: ConnectionRef[];
    status: ComponentStatus;
    health?: ComponentHealth;
    tags: string[];
    documentation_url?: string;
    repository_url?: string;
    metadata?: Record<string, unknown>;
    runtime?: RuntimeIdentity;
    timestamp: number;
    last_updated: number;
}
/**
 * Component health information
 */
export interface ComponentHealth {
    last_audit: number;
    update_available?: string;
    update_type?: 'patch' | 'minor' | 'major';
    vulnerabilities?: Vulnerability[];
    compatibility_notes?: string;
}
/**
 * Security vulnerability information
 */
export interface Vulnerability {
    id: string;
    severity: 'critical' | 'high' | 'medium' | 'low';
    title: string;
    fixed_in?: string;
    url?: string;
}
/**
 * Runtime identity annotation for architecture components.
 * Maps code-level components to their runtime services/resources.
 * Extracted from code and config — never from live service polling.
 */
export interface RuntimeIdentity {
    /** Service/resource name as known at runtime (e.g., "email-queue", "worker") */
    service_name?: string;
    /** Deployment platform (vercel, railway, heroku, docker, local) */
    platform?: string;
    /** Parsed connection info (no secrets — just host, port, db name, protocol) */
    endpoint?: {
        protocol?: string;
        host?: string;
        port?: number;
        database?: string;
        path?: string;
    };
    /** Env var that provides the connection (e.g., "DATABASE_URL", "REDIS_URL") */
    connection_env_var?: string;
    /** Runtime resource type */
    resource_type?: 'database' | 'cache' | 'queue' | 'api' | 'worker' | 'cron' | 'storage';
    /** Provider/engine (postgres, mysql, redis, bullmq, openai, etc.) */
    engine?: string;
}
/**
 * Types of connections between components
 */
export type ConnectionType = 'api-calls-db' | 'frontend-calls-api' | 'queue-triggers' | 'service-call' | 'imports' | 'deploys-to' | 'env-dependency' | 'schema-relation' | 'cron-triggers' | 'queue-produces' | 'queue-consumes' | 'prompt-location' | 'prompt-usage' | 'uses-package' | 'observes' | 'conforms-to' | 'notifies' | 'stores' | 'navigates-to' | 'presents' | 'requires-entitlement' | 'target-contains' | 'build-phase-includes' | 'generates' | 'field-reference' | 'runtime-binding' | 'queue-uses-cache' | 'other';
/**
 * Code location reference
 */
export interface CodeLocation {
    file: string;
    line: number;
    column?: number;
    function?: string;
}
/**
 * Architecture Connection
 * Represents a relationship between two components
 */
export interface ArchitectureConnection {
    connection_id: string;
    from: {
        component_id: string;
        location: CodeLocation;
    };
    to: {
        component_id: string;
        location?: CodeLocation;
    };
    connection_type: ConnectionType;
    code_reference: {
        file: string;
        symbol: string;
        symbol_type?: 'function' | 'method' | 'class' | 'variable' | 'import' | 'export';
        line_start?: number;
        line_end?: number;
        code_snippet?: string;
    };
    semantic?: {
        classification: 'production' | 'admin' | 'analytics' | 'test' | 'dev-only' | 'migration' | 'unknown';
        confidence: number;
    };
    description?: string;
    detected_from: string;
    confidence: number;
    timestamp: number;
    last_verified: number;
}
/**
 * File hash record for staleness detection
 */
export interface FileHashRecord {
    hash: string;
    lastScanned: number;
    size: number;
}
/**
 * Hash tracking for incremental scanning
 * Enables "3 files changed since last scan" warnings
 */
export interface NavHashes {
    version: '1.0';
    generatedAt: number;
    projectPath: string;
    files: Record<string, FileHashRecord>;
}
/**
 * File change detection result
 */
export interface FileChangeResult {
    added: string[];
    modified: string[];
    removed: string[];
    unchanged: string[];
}
/**
 * Quick lookup index for fast searches
 */
/**
 * Project-level metadata for agent orientation
 */
export interface ProjectMetadata {
    type: 'swift-app' | 'web-app' | 'api' | 'library' | 'monorepo' | 'unknown';
    platforms?: ('iOS' | 'macOS' | 'watchOS' | 'tvOS' | 'visionOS')[];
    architecture_pattern?: string;
    min_deployment?: Record<string, string>;
    targets?: {
        name: string;
        type: string;
        dependencies: string[];
    }[];
    entitlements?: {
        key: string;
        file: string;
    }[];
    fragile_keys?: {
        key: string;
        type: string;
        files: string[];
    }[];
    xcodeProject?: {
        path: string;
        targets: {
            name: string;
            type: string;
            bundleId?: string;
        }[];
    };
}
/**
 * Scan mode types (Run 1 — D2). 'auto' is the default decision, resolved
 * by selectScanMode to one of full/incremental/noop. 'incremental→full'
 * is the runtime label for an incremental scan that promoted to full
 * after an integrity-check failure.
 */
export type ScanType = 'full' | 'incremental' | 'incremental→full' | 'noop';
export interface ArchitectureIndex {
    schema_version?: string;
    version: string;
    last_scan: number;
    /**
     * Run 1 — D2: timestamp of the most recent FULL scan (or
     * 'incremental→full' promote). Used by selectScanMode to enforce the
     * staleness trigger (force full after 7 days). Optional for backward
     * compat; selectScanMode treats `undefined` as "never had a full scan".
     */
    last_full_scan?: number;
    /**
     * Run 1 — D2: count of incremental scans since the most recent full
     * scan. selectScanMode forces a full scan once this exceeds the cap
     * (currently 20). Reset to 0 on every full or 'incremental→full' scan.
     */
    incrementals_since_full?: number;
    project_path: string;
    project?: ProjectMetadata;
    components: {
        by_name: Record<string, string>;
        by_type: Record<ComponentType, string[]>;
        by_layer: Record<ArchitectureLayer, string[]>;
        by_status: Record<ComponentStatus, string[]>;
    };
    connections: {
        by_type: Record<ConnectionType, string[]>;
        by_from: Record<string, string[]>;
        by_to: Record<string, string[]>;
    };
    stats: {
        total_components: number;
        total_connections: number;
        components_by_type: Record<string, number>;
        connections_by_type: Record<string, number>;
        outdated_count: number;
        vulnerable_count: number;
    };
    /**
     * Run 2 — D5: per-stratum EWMA state for defect-rate drift detection.
     * Updated after each scan that runs an audit. Optional for backward compat.
     * If any stratum's EWMA breaches its control limits, the next scan
     * auto-promotes to mode='full' + audit-plan='Cochran' for tighter inspection.
     */
    ewma?: Record<string, EwmaStateSnapshot>;
    /**
     * Run 2 — D4: rolling count of audits that have run on this index. Used
     * to switch from AQL → SPRT once history ≥ 3.
     */
    audit_history_count?: number;
    /**
     * Run 2: when the previous run's audit detected an EWMA breach, this is
     * set so the NEXT scan can read it and auto-promote.
     */
    pending_drift_breach?: boolean;
}
/**
 * Run 2 — snapshot of EWMA state persisted on the index. Mirrors `EwmaState`
 * from `src/audit/spc.ts`; duplicated here so types.ts has zero runtime imports
 * from the audit module.
 */
export interface EwmaStateSnapshot {
    lambda: number;
    L: number;
    mean: number;
    variance: number;
    n: number;
    points: number[];
    breach_pending?: boolean;
}
/**
 * Run 2 — D2 defect taxonomy.
 */
export type AuditDefectClass = 'HALLUCINATED_COMPONENT' | 'HALLUCINATED_EDGE' | 'WRONG_ENDPOINT' | 'STALE_REFERENCE' | 'DEDUP_COLLISION' | 'MISSED_EDGE';
export interface AuditSampleEvidence {
    id: string;
    ok: boolean;
    reason?: string;
}
/**
 * Run 2 — D4: audit report attached to a TimelineEntry.
 */
export interface AuditReport {
    plan: 'AQL' | 'SPRT' | 'Cochran';
    n: number;
    c: number;
    sampled: number;
    defects: number;
    defect_rate: number;
    by_class: Partial<Record<AuditDefectClass, {
        sampled: number;
        defects: number;
    }>>;
    by_stratum: Record<string, {
        sampled: number;
        defects: number;
        defect_rate: number;
    }>;
    llm_skipped?: boolean;
    verdict: 'accept' | 'reject' | 'continue';
    drift_breach?: boolean;
    timestamp: number;
    defect_evidence?: AuditSampleEvidence[];
}
/**
 * Full connection graph (for visualization/analysis)
 */
export interface ConnectionGraph {
    schema_version?: string;
    nodes: GraphNode[];
    edges: GraphEdge[];
    metadata: {
        generated_at: number;
        component_count: number;
        connection_count: number;
    };
}
export interface GraphNode {
    id: string;
    stable_id?: string;
    name: string;
    type: ComponentType;
    layer: ArchitectureLayer;
}
export interface GraphEdge {
    id: string;
    source: string;
    target: string;
    type: ConnectionType;
    label?: string;
}
/**
 * Scanner result for a single detection
 */
export interface ScanResult {
    components: ArchitectureComponent[];
    connections: ArchitectureConnection[];
    warnings: ScanWarning[];
}
export interface ScanWarning {
    type: 'missing_file' | 'parse_error' | 'low_confidence' | 'deprecated';
    message: string;
    file?: string;
    line?: number;
}
/**
 * Detection pattern for finding connections
 */
export interface DetectionPattern {
    name: string;
    description: string;
    file_patterns: string[];
    code_patterns: RegExp[];
    connection_type: ConnectionType;
    extract_target: (match: RegExpMatchArray) => string | null;
}
export interface GitInfo {
    branch: string;
    commit: string;
    commitFull?: string;
}
export type ImpactSeverity = 'critical' | 'high' | 'medium' | 'low';
/**
 * Impact analysis result
 */
export interface ImpactAnalysis {
    component: ArchitectureComponent;
    severity: ImpactSeverity;
    affected: AffectedComponent[];
    total_files_affected: number;
    summary: string;
}
export interface AffectedComponent {
    component: ArchitectureComponent;
    connection: ArchitectureConnection;
    impact_type: 'direct' | 'transitive';
    change_required: string;
}
/**
 * Storage mode for architecture data
 */
export type StorageMode = 'local' | 'shared';
/**
 * NavGator configuration
 */
export interface NavGatorConfig {
    storageMode: StorageMode;
    storagePath: string;
    autoScan: boolean;
    healthCheckEnabled: boolean;
    scanDepth: 'shallow' | 'deep';
    defaultConfidenceThreshold: number;
    maxResultsPerQuery: number;
    sandbox?: boolean;
}
/**
 * Generate a component ID
 * Format: COMP_type_name_random
 */
export declare function generateComponentId(type: ComponentType, name: string): string;
/**
 * Generate a stable, deterministic component identifier.
 * Format: STABLE_<type>_<slug>
 *
 * Same (type, name) → same stable_id across scans. This is the cross-scan
 * join key — distinct from `component_id` which carries a random suffix
 * for legacy backward compatibility.
 *
 * NOTE: collisions on (type, name) are intentional — they represent the
 * same logical component re-detected. Callers needing path-uniqueness
 * (e.g., two `prompt`-type components in different files) should pass a
 * canonical_path as the second argument when available.
 */
export declare function generateStableId(type: ComponentType, name: string, canonicalPath?: string): string;
/**
 * Generate a connection ID
 * Format: CONN_type_random
 */
export declare function generateConnectionId(type: ConnectionType): string;
/**
 * Compact component representation for token-efficient retrieval
 */
export interface CompactComponent {
    id: string;
    n: string;
    t: ComponentType;
    v?: string;
    l: ArchitectureLayer;
    s: ComponentStatus;
    ci: number;
    co: number;
}
/**
 * Compact connection representation
 */
export interface CompactConnection {
    id: string;
    f: string;
    t: string;
    ct: ConnectionType;
    file: string;
    sym: string;
    st?: 'function' | 'method' | 'class' | 'variable' | 'import' | 'export';
    line?: number;
}
/**
 * Convert component to compact form
 */
export declare function toCompactComponent(c: ArchitectureComponent): CompactComponent;
/**
 * Convert connection to compact form
 */
export declare function toCompactConnection(c: ArchitectureConnection): CompactConnection;
export interface SnapshotComponent {
    component_id: string;
    name: string;
    type: ComponentType;
    version?: string;
    status: ComponentStatus;
    layer: ArchitectureLayer;
    critical: boolean;
}
export interface SnapshotConnection {
    connection_id: string;
    from: string;
    to: string;
    type: ConnectionType;
    from_name: string;
    to_name: string;
    file?: string;
}
export interface Snapshot {
    snapshot_id: string;
    snapshot_version: '2.0';
    timestamp: number;
    reason?: string;
    git?: GitInfo;
    components: SnapshotComponent[];
    connections: SnapshotConnection[];
    stats: {
        total_components: number;
        total_connections: number;
    };
}
export type DiffSignificance = 'major' | 'minor' | 'patch';
export type DiffTrigger = 'layer-change' | 'high-churn' | 'new-layer' | 'new-package' | 'connection-change' | 'version-bump' | 'metadata-only';
export interface ComponentChange {
    name: string;
    type: ComponentType;
    layer: ArchitectureLayer;
    version?: string;
}
export interface ComponentModification {
    name: string;
    type: ComponentType;
    changes: string[];
}
export interface ConnectionChange {
    from_name: string;
    to_name: string;
    type: ConnectionType;
    file?: string;
}
export interface DiffResult {
    components: {
        added: ComponentChange[];
        removed: ComponentChange[];
        modified: ComponentModification[];
    };
    connections: {
        added: ConnectionChange[];
        removed: ConnectionChange[];
    };
    stats: {
        total_changes: number;
        components_before: number;
        components_after: number;
        connections_before: number;
        connections_after: number;
    };
}
export interface TimelineEntry {
    id: string;
    timestamp: number;
    significance: DiffSignificance;
    triggers: DiffTrigger[];
    diff: DiffResult;
    snapshot_id?: string;
    git?: GitInfo;
    /**
     * Run 1 — D2: which scan mode produced this entry. 'incremental→full'
     * is the special promote case (Run 1.6 #3 / Run 1.7 — Problem A).
     * Optional for backward compat with timeline entries written before
     * mode tracking shipped.
     */
    scan_type?: ScanType;
    /**
     * Run 1.6 — item #3: number of source files actually walked by the
     * scanners. For 'incremental' this is the walk-set size (changed +
     * reverse-deps). For 'full' (or recursive-re-entry promote per Run 1.7
     * Problem A) this is the full source-file count. Lets agents detect
     * a silent integrity-promote vs a true full scan by comparing
     * scan_type and files_scanned.
     */
    files_scanned?: number;
    /**
     * Run 2 — D4: audit report from this scan's self-measurement pass.
     * Absent when `--no-audit` was used or audit was internally skipped
     * (e.g., empty population). Audit failures NEVER cause the scan itself
     * to fail; only EWMA drift triggers the next scan to auto-promote.
     */
    audit?: AuditReport;
}
export interface Timeline {
    version: '1.0';
    project_path: string;
    entries: TimelineEntry[];
}
/**
 * Stable envelope format for machine consumers (Codex, agents, CI)
 */
export interface AgentEnvelope<T> {
    schema_version: string;
    command: string;
    timestamp: number;
    data: T;
}
/**
 * Executive summary for agent orientation
 */
export interface ExecutiveSummary {
    project_path: string;
    timestamp: number;
    git?: GitInfo;
    risks: SummaryRisk[];
    blockers: SummaryBlocker[];
    next_actions: SummaryAction[];
    stats: {
        total_components: number;
        total_connections: number;
        outdated_count: number;
        vulnerable_count: number;
    };
    components: CompactComponent[];
    connections: CompactConnection[];
}
export interface SummaryRisk {
    type: string;
    severity: ImpactSeverity;
    component?: string;
    message: string;
}
export interface SummaryBlocker {
    type: string;
    component?: string;
    message: string;
}
export interface SummaryAction {
    action: string;
    reason: string;
    command?: string;
}
//# sourceMappingURL=types.d.ts.map