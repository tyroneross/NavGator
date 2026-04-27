/**
 * NavGator - Architecture Connection Tracker
 *
 * Know your stack before you change it.
 *
 * @packageDocumentation
 */
export { scan, quickScan, getScanStatus, scanPromptsOnly, type ScanOptions } from './scanner.js';
export { setup, fastSetup, fullSetup, isSetupComplete, formatSetupStatus } from './setup.js';
export { getConfig, SCHEMA_VERSION, type NavGatorConfig } from './config.js';
export { loadIndex, loadAllComponents, loadAllConnections, loadGraph, storeComponent, storeConnection, deleteComponent, } from './storage.js';
export { generateMermaidDiagram, generateComponentDiagram, generateLayerDiagram, generateSummaryDiagram, wrapInMarkdown, type DiagramOptions, } from './diagram.js';
export { computeArchitectureDiff, classifySignificance, loadTimeline, saveTimelineEntry, loadLatestSnapshot, buildCurrentSnapshot, formatTimeline, formatDiffSummary, formatDiffForSummary, } from './diff.js';
export { registerProject, listProjects, formatProjectsList, type ProjectEntry, } from './projects.js';
export { getGitInfo } from './git.js';
export { computeImpact, computeSeverity } from './impact.js';
export { wrapInEnvelope, buildExecutiveSummary } from './agent-output.js';
export type { ArchitectureComponent, ArchitectureConnection, ConnectionGraph, ArchitectureIndex, ArchitectureLayer, ComponentType, ConnectionType, ScanResult, ScanWarning, Snapshot, SnapshotComponent, SnapshotConnection, DiffResult, DiffSignificance, DiffTrigger, TimelineEntry, Timeline, ComponentChange, ComponentModification, ConnectionChange, GitInfo, ImpactSeverity, ImpactAnalysis, AffectedComponent, AgentEnvelope, ExecutiveSummary, SummaryRisk, SummaryBlocker, SummaryAction, CompactComponent, CompactConnection, } from './types.js';
export { toCompactComponent, toCompactConnection } from './types.js';
export { resolveComponent, findCandidates } from './resolve.js';
export { resolveFileConnections, looksLikeFilePath, formatFileImpact, formatFileConnections } from './file-resolve.js';
export type { FileConnections } from './file-resolve.js';
export { scanImports } from './scanners/connections/import-scanner.js';
export { classifyConnection, classifyAllConnections } from './classify.js';
export type { SemanticClassification, SemanticInfo } from './classify.js';
export { traceDataflow, formatTraceOutput } from './trace.js';
export type { TraceResult, TracePath, TraceStep, TraceOptions } from './trace.js';
export { checkRules, getBuiltinRules, loadCustomRules, formatRulesOutput } from './rules.js';
export type { ArchitectureRule, RuleViolation } from './rules.js';
export { computeCoverage, formatCoverageOutput } from './coverage.js';
export type { CoverageReport, CoverageGap } from './coverage.js';
export { extractSubgraph, subgraphToMermaid } from './subgraph.js';
export type { SubgraphOptions } from './subgraph.js';
export { detectSandbox, isSandboxMode, getSandboxRestrictions } from './sandbox.js';
export type { SandboxConfig } from './sandbox.js';
export { scanPrompts, formatPromptsOutput, formatPromptDetail, convertToArchitecture, } from './scanners/prompts/index.js';
export type { DetectedPrompt, PromptScanResult, PromptMessage, PromptVariable, PromptCategory, } from './scanners/prompts/types.js';
//# sourceMappingURL=index.d.ts.map