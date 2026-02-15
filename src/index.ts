/**
 * NavGator - Architecture Connection Tracker
 *
 * Know your stack before you change it.
 *
 * @packageDocumentation
 */

// Main exports
export { scan, quickScan, getScanStatus, scanPromptsOnly, type ScanOptions } from './scanner.js';
export { setup, fastSetup, fullSetup, isSetupComplete, formatSetupStatus } from './setup.js';
export { getConfig, SCHEMA_VERSION, type NavGatorConfig } from './config.js';

// Storage
export {
  loadIndex,
  loadAllComponents,
  loadAllConnections,
  loadGraph,
  storeComponent,
  storeConnection,
  deleteComponent,
} from './storage.js';

// Diagram generation
export {
  generateMermaidDiagram,
  generateComponentDiagram,
  generateLayerDiagram,
  generateSummaryDiagram,
  wrapInMarkdown,
  type DiagramOptions,
} from './diagram.js';

// Diff engine
export {
  computeArchitectureDiff,
  classifySignificance,
  loadTimeline,
  saveTimelineEntry,
  loadLatestSnapshot,
  buildCurrentSnapshot,
  formatTimeline,
  formatDiffSummary,
  formatDiffForSummary,
} from './diff.js';

// Project registry
export {
  registerProject,
  listProjects,
  formatProjectsList,
  type ProjectEntry,
} from './projects.js';

// Git utilities
export { getGitInfo } from './git.js';

// Impact analysis
export { computeImpact, computeSeverity } from './impact.js';

// Agent output
export { wrapInEnvelope, buildExecutiveSummary } from './agent-output.js';

// Types
export type {
  ArchitectureComponent,
  ArchitectureConnection,
  ConnectionGraph,
  ArchitectureIndex,
  ArchitectureLayer,
  ComponentType,
  ConnectionType,
  ScanResult,
  ScanWarning,
  Snapshot,
  SnapshotComponent,
  SnapshotConnection,
  DiffResult,
  DiffSignificance,
  DiffTrigger,
  TimelineEntry,
  Timeline,
  ComponentChange,
  ComponentModification,
  ConnectionChange,
  GitInfo,
  ImpactSeverity,
  ImpactAnalysis,
  AffectedComponent,
  AgentEnvelope,
  ExecutiveSummary,
  SummaryRisk,
  SummaryBlocker,
  SummaryAction,
  CompactComponent,
  CompactConnection,
} from './types.js';

// Compact serialization utilities
export { toCompactComponent, toCompactConnection } from './types.js';

// Resolve
export { resolveComponent, findCandidates } from './resolve.js';

// Classify
export { classifyConnection, classifyAllConnections } from './classify.js';
export type { SemanticClassification, SemanticInfo } from './classify.js';

// Trace
export { traceDataflow, formatTraceOutput } from './trace.js';
export type { TraceResult, TracePath, TraceStep, TraceOptions } from './trace.js';

// Rules
export { checkRules, getBuiltinRules, loadCustomRules, formatRulesOutput } from './rules.js';
export type { ArchitectureRule, RuleViolation } from './rules.js';

// Coverage
export { computeCoverage, formatCoverageOutput } from './coverage.js';
export type { CoverageReport, CoverageGap } from './coverage.js';

// Subgraph
export { extractSubgraph, subgraphToMermaid } from './subgraph.js';
export type { SubgraphOptions } from './subgraph.js';

// Sandbox
export { detectSandbox, isSandboxMode, getSandboxRestrictions } from './sandbox.js';
export type { SandboxConfig } from './sandbox.js';

// Prompt scanner exports
export {
  scanPrompts,
  formatPromptsOutput,
  formatPromptDetail,
  convertToArchitecture,
} from './scanners/prompts/index.js';

export type {
  DetectedPrompt,
  PromptScanResult,
  PromptMessage,
  PromptVariable,
  PromptCategory,
} from './scanners/prompts/types.js';
