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
export { registerProject, listProjects, formatProjectsList, updateProjectMeta, removeProject, pruneProjects, type ProjectEntry, type ProjectRegistry, type ProjectChangeSummary, } from './projects.js';
export { readJournal, formatJournal, appendJournalEvent, appendJournalEventSync, defaultRegistryDir, journalPathForDir, type RegistryJournalEvent, type JournalActor, type JournalOp, } from './registry-journal.js';
export { getGitInfo } from './git.js';
export { memoryEnabled, memoryDir, projectMemoryPath, recordMemoryEvent, readProjectMemory, listProjectMemories, readMemoryEvents, memoryStoreStats, removeProjectMemory, rebuildMemoryIndex, reconcileMemory, slug as memoryProjectSlug, MEMORY_SCHEMA_VERSION, DEFAULT_MAX_EVENT_BYTES, MAX_MILESTONES, type MemoryEvent, type MemoryEventKind, type ProjectMemory, type RecordMemoryEventInput, } from './memory/store.js';
export { mirrorStatus, mirrorProjectMemory, mirrorAll, type MirrorStatus, } from './memory/mirror.js';
export { computeHealth, isTmpRootedPath, classifyRegistryEntries, selectPrunableEntries, HEALTH_SCHEMA_VERSION, type HealthReport, type HealthFinding, type RegistryEntryClassification, } from './memory/health.js';
export { loadHomeConfig, homeConfigPath, resetHomeConfigCache, type NavGatorHomeConfig, } from './home-config.js';
export { componentBaseName, identityKey, mergeComponentAliases } from './component-identity.js';
export { writeSnapshotForCurrentRef, readCanonicalSnapshot, readBranchSnapshot, type WriteSnapshotResult, } from './git-aware/canonical.js';
export { getDefaultBranch, getCurrentBranch, getCurrentRef, isDefaultBranch, isWorktree, slugifyRef } from './git-aware/refs.js';
export { premergeDiff, type PremergeDiffOptions, type PremergeDiffResult } from './git-aware/premerge-diff.js';
export { discoverRepos } from './portfolio/discover.js';
export { scanPortfolio } from './portfolio/scan.js';
export { buildCrossRepoMap } from './portfolio/cross-repo.js';
export type { RepoDiscoveryOptions, DiscoveredRepo, PortfolioScanOptions, RepoScanStatus, RepoOutcome, PortfolioScanResult, CrossRepoRepoInput, SharedDependencyRepoVersion, SharedDependencyEntry, CrossRepoServiceCallBasis, CrossRepoServiceEdge, PortfolioStatus, CrossRepoMap, } from './portfolio/types.js';
export { parseGitHubUrl, type ParsedGitHubUrl } from './remote/github-url.js';
export { scanRemote, type ScanRemoteOptions, type ScanRemoteResult } from './remote/scan-remote.js';
export { computeImpact, computeSeverity } from './impact.js';
export { AGENT_OUTPUT_LIMITS, boundAgentCollection, wrapInEnvelope, buildExecutiveSummary, } from './agent-output.js';
export type { ArchitectureComponent, ArchitectureConnection, ConnectionGraph, ArchitectureIndex, ArchitectureLayer, ComponentType, ConnectionType, ScanResult, ArchitectureScanStatus, ArchitectureScanStats, ArchitectureScanPayload, ArchitectureScanOutcome, ScanWarning, Snapshot, SnapshotComponent, SnapshotConnection, DiffResult, DiffSignificance, DiffTrigger, TimelineEntry, Timeline, ComponentChange, ComponentModification, ConnectionChange, GitInfo, ImpactSeverity, ImpactAnalysis, AffectedComponent, AgentEnvelope, ExecutiveSummary, AgentCollectionWindow, SummaryRuleHealth, SummaryRuleViolation, SummaryRisk, SummaryBlocker, SummaryAction, CompactComponent, CompactConnection, } from './types.js';
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