/**
 * NavGator Type Definitions
 * Architecture connection tracking for Claude Code
 */

// =============================================================================
// COMPONENT TYPES
// =============================================================================

/**
 * Types of architecture components that NavGator tracks
 */
export type ComponentType =
  // Package managers
  | 'npm'
  | 'pip'
  | 'spm'           // Swift Package Manager / CocoaPods
  | 'cargo'
  | 'go'
  | 'gem'
  | 'composer'
  // Architecture layers
  | 'framework'      // Next.js, Django, Rails, FastAPI
  | 'database'       // PostgreSQL, MongoDB, Redis, Supabase
  | 'queue'          // BullMQ, Celery, SQS, RabbitMQ
  | 'infra'          // Railway, Vercel, Docker, K8s
  | 'service'        // Stripe, Twilio, external APIs (non-AI)
  | 'llm'            // AI/LLM services: OpenAI, Claude, Groq, Anthropic
  | 'config'         // Environment variables, feature flags, config
  | 'cron'           // Scheduled jobs (Vercel crons, crontab, etc.)
  // Code-level components
  | 'api-endpoint'   // /api/users, /api/orders
  | 'db-table'       // users, orders, products tables
  | 'prompt'         // AI prompts (Claude, OpenAI)
  | 'worker'         // Queue workers/handlers
  | 'component'      // UI components (React, Vue)
  | 'xcode-target'   // Xcode build targets
  | 'other';

/**
 * Architecture layer classification
 */
export type ArchitectureLayer =
  | 'frontend'
  | 'backend'
  | 'database'
  | 'queue'
  | 'infra'
  | 'external';

/**
 * Component status
 */
export type ComponentStatus =
  | 'active'       // Currently in use
  | 'outdated'     // Newer version available
  | 'deprecated'   // Package/service deprecated
  | 'vulnerable'   // Has security vulnerability
  | 'unused'       // Detected but not imported/used
  | 'removed';     // Was removed from project

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
  // Identification
  component_id: string;         // COMP_type_name_hash (e.g., COMP_npm_react_a1b2) — random suffix, NOT stable across scans
  /**
   * Stable, deterministic identifier derived from type + canonical name.
   * Format: STABLE_<type>_<slug>. Same component across scans → same stable_id.
   * Used as the cross-scan join key for PageRank persistence, git diffs, timeline tracking.
   */
  stable_id?: string;
  name: string;                 // "react", "BullMQ", "Railway"
  version?: string;             // "18.2.0" (if applicable)

  // Classification
  type: ComponentType;

  // Role in the architecture
  role: {
    purpose: string;            // "UI framework", "Job queue", "Deployment"
    layer: ArchitectureLayer;
    critical: boolean;          // Is this critical to the app?
  };

  // Detection source
  source: {
    detection_method: 'auto' | 'manual' | 'hook';
    config_files: string[];     // ["package.json", "railway.toml"]
    confidence: number;         // 0-1 detection confidence
  };

  // Relationships (populated by graph builder)
  connects_to: ConnectionRef[];
  connected_from: ConnectionRef[];

  // Health/status
  status: ComponentStatus;
  health?: ComponentHealth;

  // Metadata
  tags: string[];
  documentation_url?: string;
  repository_url?: string;
  metadata?: Record<string, unknown>;  // Extensible metadata (e.g., prompt details)

  // Runtime identity (maps code component to runtime service/resource)
  runtime?: RuntimeIdentity;

  // Timestamps
  timestamp: number;            // When first detected
  last_updated: number;         // When last verified/updated
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
  id: string;                   // CVE ID or advisory ID
  severity: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  fixed_in?: string;            // Version that fixes it
  url?: string;
}

// =============================================================================
// RUNTIME IDENTITY (for runtime topology annotations)
// =============================================================================

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
    protocol?: string;    // postgres, redis, https, amqp
    host?: string;        // localhost, db.railway.internal, redis-12345.upstash.io
    port?: number;
    database?: string;    // database name
    path?: string;        // API path prefix
  };
  /** Env var that provides the connection (e.g., "DATABASE_URL", "REDIS_URL") */
  connection_env_var?: string;
  /** Runtime resource type */
  resource_type?: 'database' | 'cache' | 'queue' | 'api' | 'worker' | 'cron' | 'storage';
  /** Provider/engine (postgres, mysql, redis, bullmq, openai, etc.) */
  engine?: string;
}

// =============================================================================
// CONNECTION TYPES
// =============================================================================

/**
 * Types of connections between components
 */
export type ConnectionType =
  | 'api-calls-db'        // API endpoint → database table
  | 'frontend-calls-api'  // React/Vue component → API endpoint
  | 'queue-triggers'      // Queue job → handler function
  | 'service-call'        // Code → external service (Stripe, OpenAI)
  | 'imports'             // File imports another file/module
  | 'deploys-to'          // Code → infrastructure
  | 'env-dependency'      // Component → environment variable
  | 'schema-relation'     // Database model → related model (FK/relation)
  | 'cron-triggers'       // Cron job → API route handler
  | 'queue-produces'      // Producer → queue
  | 'queue-consumes'      // Queue → consumer worker
  | 'prompt-location'     // AI prompt definition location
  | 'prompt-usage'        // Code uses an AI prompt
  | 'uses-package'        // Code uses a package
  // Apple platform connections
  | 'observes'            // View ↔ @Published/@Observable state
  | 'conforms-to'         // Type conforms to protocol
  | 'notifies'            // NotificationCenter post ↔ observe
  | 'stores'              // Code ↔ UserDefaults/Keychain/@AppStorage key
  | 'navigates-to'        // View A → View B (NavigationLink, push navigation)
  | 'presents'            // View A presents View B (sheet, fullScreenCover, popover)
  | 'requires-entitlement' // Framework usage ↔ .entitlements entry
  | 'target-contains'     // Xcode target ↔ source files/frameworks
  | 'build-phase-includes' // Xcode build phase ↔ source files
  | 'generates'           // Build script/schema → generated source file
  | 'field-reference'     // Database model field → file that references it
  | 'runtime-binding'     // Component → its runtime service/resource (queue → Redis, Prisma → database)
  | 'queue-uses-cache'    // Queue system → cache/Redis instance it connects through
  | 'other';

/**
 * Code location reference
 */
export interface CodeLocation {
  file: string;               // Relative path: "src/api/users.ts"
  line: number;               // Line number (1-indexed)
  column?: number;            // Column number (optional)
  function?: string;          // Function/method name if detected
}

/**
 * Architecture Connection
 * Represents a relationship between two components
 */
export interface ArchitectureConnection {
  // Identification
  connection_id: string;        // CONN_type_hash (e.g., CONN_api_db_a1b2)

  // Source of connection
  from: {
    component_id: string;       // Reference to component
    location: CodeLocation;     // File:line where connection originates
  };

  // Target of connection
  to: {
    component_id: string;       // Reference to component
    location?: CodeLocation;    // File:line of target (if in codebase)
  };

  // Connection classification
  connection_type: ConnectionType;

  // Code reference (the actual code making this connection)
  // Symbol is PRIMARY (stable across refactors), line numbers are SECONDARY (for display)
  code_reference: {
    file: string;               // "src/api/users.ts"
    symbol: string;             // PRIMARY: "createUser" (stable identifier)
    symbol_type?: 'function' | 'method' | 'class' | 'variable' | 'import' | 'export';
    line_start?: number;        // SECONDARY: 45 (for display/navigation)
    line_end?: number;          // 52 (for multi-line)
    code_snippet?: string;      // Actual code (truncated to ~100 chars)
  };

  // Semantic classification (from classify.ts)
  semantic?: {
    classification: 'production' | 'admin' | 'analytics' | 'test' | 'dev-only' | 'migration' | 'unknown';
    confidence: number;         // 0-1
  };

  // Metadata
  description?: string;         // "Creates user in database"
  detected_from: string;        // Detection method/pattern that found this
  confidence: number;           // 0-1 confidence score

  // Timestamps
  timestamp: number;            // When detected
  last_verified: number;        // When last verified to still exist
}

// =============================================================================
// FILE HASH TRACKING (for staleness detection)
// =============================================================================

/**
 * File hash record for staleness detection
 */
export interface FileHashRecord {
  hash: string;                   // SHA-256 of file content
  lastScanned: number;            // Unix timestamp when scanned
  size: number;                   // File size in bytes
}

/**
 * Hash tracking for incremental scanning
 * Enables "3 files changed since last scan" warnings
 */
export interface NavHashes {
  version: '1.0';
  generatedAt: number;            // Unix timestamp
  projectPath: string;            // Absolute path to project root
  files: Record<string, FileHashRecord>;  // relativePath -> hash record
}

/**
 * File change detection result
 */
export interface FileChangeResult {
  added: string[];                // New files since last scan
  modified: string[];             // Files with changed content
  removed: string[];              // Files that no longer exist
  unchanged: string[];            // Files with same hash
}

// =============================================================================
// INDEX & GRAPH TYPES
// =============================================================================

/**
 * Quick lookup index for fast searches
 */
/**
 * Project-level metadata for agent orientation
 */
export interface ProjectMetadata {
  type: 'swift-app' | 'web-app' | 'api' | 'library' | 'monorepo' | 'unknown';
  platforms?: ('iOS' | 'macOS' | 'watchOS' | 'tvOS' | 'visionOS')[];
  architecture_pattern?: string;   // MVVM, TCA, MVC, VIPER, etc.
  min_deployment?: Record<string, string>; // { iOS: "17.0", macOS: "14.0" }
  targets?: { name: string; type: string; dependencies: string[] }[];
  entitlements?: { key: string; file: string }[];
  fragile_keys?: { key: string; type: string; files: string[] }[]; // String-keyed runtime deps
  xcodeProject?: { path: string; targets: { name: string; type: string; bundleId?: string }[] };
}

/**
 * Scan mode types (Run 1 — D2). 'auto' is the default decision, resolved
 * by selectScanMode to one of full/incremental/noop. 'incremental→full'
 * is the runtime label for an incremental scan that promoted to full
 * after an integrity-check failure.
 */
export type ScanType = 'full' | 'incremental' | 'incremental→full' | 'noop';

export interface ArchitectureIndex {
  schema_version?: string;      // NavGator schema version (e.g., '1.0.0')
  version: string;              // Index format version
  last_scan: number;            // Unix timestamp of last scan
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
  project_path: string;         // Absolute path to project root

  // Project-level metadata (for agent context)
  project?: ProjectMetadata;

  // Component lookups
  components: {
    by_name: Record<string, string>;           // name -> component_id
    by_type: Record<ComponentType, string[]>;  // type -> component_ids
    by_layer: Record<ArchitectureLayer, string[]>;
    by_status: Record<ComponentStatus, string[]>;
  };

  // Connection lookups
  connections: {
    by_type: Record<ConnectionType, string[]>;
    by_from: Record<string, string[]>;         // component_id -> connection_ids
    by_to: Record<string, string[]>;           // component_id -> connection_ids
  };

  // Statistics
  stats: {
    total_components: number;
    total_connections: number;
    components_by_type: Record<string, number>;
    connections_by_type: Record<string, number>;
    outdated_count: number;
    vulnerable_count: number;
  };
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
  id: string;                   // component_id
  stable_id?: string;           // derived; stable across scans
  name: string;
  type: ComponentType;
  layer: ArchitectureLayer;
}

export interface GraphEdge {
  id: string;                   // connection_id
  source: string;               // from component_id
  target: string;               // to component_id
  type: ConnectionType;
  label?: string;               // Connection description
}

// =============================================================================
// SCAN & DETECTION TYPES
// =============================================================================

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
  file_patterns: string[];      // Glob patterns for files to scan
  code_patterns: RegExp[];      // Regex patterns to match
  connection_type: ConnectionType;
  extract_target: (match: RegExpMatchArray) => string | null;
}

// =============================================================================
// GIT INFO
// =============================================================================

export interface GitInfo {
  branch: string;
  commit: string;
  commitFull?: string;
}

// =============================================================================
// IMPACT ANALYSIS TYPES
// =============================================================================

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
  change_required: string;      // Description of what needs to change
}

// =============================================================================
// CONFIGURATION TYPES
// =============================================================================

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

// =============================================================================
// ID GENERATION
// =============================================================================

/**
 * Generate a component ID
 * Format: COMP_type_name_random
 */
export function generateComponentId(type: ComponentType, name: string): string {
  const sanitizedName = name.toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 20);
  const random = Math.random().toString(36).slice(2, 6);
  return `COMP_${type}_${sanitizedName}_${random}`;
}

/**
 * Slugify a name for use in a stable_id.
 * Lowercase; keep [a-z0-9._-]; collapse runs of other chars to '-'; trim '-'.
 * Length-cap at 64 chars to keep filenames sane.
 */
function slugifyForStableId(name: string): string {
  const raw = (name ?? '').toString();
  const MAX = 48;
  const filtered = raw
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  // Hash-suffix triggers — narrow to cases where input identity could
  // genuinely be lost. Routine punctuation folding (spaces, slashes, @scopes)
  // does NOT trigger; that would make most names noisy.
  const hasNonAscii = /[^\u0000-\u007f]/.test(raw);
  const wasEmpty = filtered === '';
  const trimmed = filtered.slice(0, MAX);
  const wasTruncated = filtered.length > MAX;
  if (!hasNonAscii && !wasEmpty && !wasTruncated) {
    return trimmed;
  }
  // FNV-1a 32-bit over original raw bytes — deterministic, dependency-free.
  // Disambiguates non-ASCII names, empty inputs, and >48-char names that
  // would otherwise collide after slugification (Codex audit fix).
  let h = 0x811c9dc5;
  for (let i = 0; i < raw.length; i++) {
    h = (h ^ raw.charCodeAt(i)) >>> 0;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  const suffix = h.toString(36).padStart(7, '0').slice(0, 7);
  const base = trimmed || 'h';
  return `${base}-${suffix}`;
}

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
export function generateStableId(type: ComponentType, name: string, canonicalPath?: string): string {
  const slug = canonicalPath
    ? `${slugifyForStableId(canonicalPath)}__${slugifyForStableId(name)}`
    : slugifyForStableId(name);
  return `STABLE_${type}_${slug}`;
}

/**
 * Generate a connection ID
 * Format: CONN_type_random
 */
export function generateConnectionId(type: ConnectionType): string {
  const random = Math.random().toString(36).slice(2, 8);
  return `CONN_${type}_${random}`;
}

// =============================================================================
// COMPACT SERIALIZATION (for token efficiency)
// =============================================================================

/**
 * Compact component representation for token-efficient retrieval
 */
export interface CompactComponent {
  id: string;
  n: string;                    // name
  t: ComponentType;             // type
  v?: string;                   // version
  l: ArchitectureLayer;         // layer
  s: ComponentStatus;           // status
  ci: number;                   // connection in count
  co: number;                   // connection out count
}

/**
 * Compact connection representation
 */
export interface CompactConnection {
  id: string;
  f: string;                    // from component_id
  t: string;                    // to component_id
  ct: ConnectionType;           // connection_type
  file: string;
  sym: string;                  // symbol (PRIMARY identifier)
  st?: 'function' | 'method' | 'class' | 'variable' | 'import' | 'export';  // symbol_type
  line?: number;                // line_start (SECONDARY, for display)
}

/**
 * Convert component to compact form
 */
export function toCompactComponent(c: ArchitectureComponent): CompactComponent {
  return {
    id: c.component_id,
    n: c.name,
    t: c.type,
    v: c.version,
    l: c.role.layer,
    s: c.status,
    ci: c.connected_from.length,
    co: c.connects_to.length,
  };
}

/**
 * Convert connection to compact form
 */
export function toCompactConnection(c: ArchitectureConnection): CompactConnection {
  return {
    id: c.connection_id,
    f: c.from.component_id,
    t: c.to.component_id,
    ct: c.connection_type,
    file: c.code_reference.file,
    sym: c.code_reference.symbol,
    st: c.code_reference.symbol_type,
    line: c.code_reference.line_start,
  };
}

// =============================================================================
// SNAPSHOT v2 TYPES
// =============================================================================

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
  from: string;          // component_id
  to: string;            // component_id
  type: ConnectionType;
  from_name: string;     // resolved component name
  to_name: string;       // resolved component name
  file?: string;         // code_reference.file
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

// =============================================================================
// TIMELINE & DIFF TYPES
// =============================================================================

export type DiffSignificance = 'major' | 'minor' | 'patch';

export type DiffTrigger =
  | 'layer-change'          // database/infra layer added/removed
  | 'high-churn'            // >20% components changed
  | 'new-layer'             // entirely new layer introduced
  | 'new-package'           // new packages added
  | 'connection-change'     // connections added/removed
  | 'version-bump'          // major semver bump
  | 'metadata-only';        // version patches, status changes

export interface ComponentChange {
  name: string;
  type: ComponentType;
  layer: ArchitectureLayer;
  version?: string;
}

export interface ComponentModification {
  name: string;
  type: ComponentType;
  changes: string[];       // e.g. ["version: 1.0.0 → 2.0.0", "status: active → outdated"]
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
  id: string;              // TL_YYYYMMDDHHmmss
  timestamp: number;
  significance: DiffSignificance;
  triggers: DiffTrigger[];
  diff: DiffResult;
  snapshot_id?: string;    // the post-scan snapshot id
  git?: GitInfo;           // branch/commit when --track-branch used
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
}

export interface Timeline {
  version: '1.0';
  project_path: string;
  entries: TimelineEntry[];
}

// =============================================================================
// AGENT OUTPUT TYPES
// =============================================================================

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
