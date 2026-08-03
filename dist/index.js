/**
 * NavGator - Architecture Connection Tracker
 *
 * Know your stack before you change it.
 *
 * @packageDocumentation
 */
// Main exports
export { scan, quickScan, getScanStatus, scanPromptsOnly } from './scanner.js';
export { setup, fastSetup, fullSetup, isSetupComplete, formatSetupStatus } from './setup.js';
export { getConfig, SCHEMA_VERSION } from './config.js';
// Storage
export { loadIndex, loadAllComponents, loadAllConnections, loadGraph, storeComponent, storeConnection, deleteComponent, } from './storage.js';
// Diagram generation
export { generateMermaidDiagram, generateComponentDiagram, generateLayerDiagram, generateSummaryDiagram, wrapInMarkdown, } from './diagram.js';
// Diff engine
export { computeArchitectureDiff, classifySignificance, loadTimeline, saveTimelineEntry, loadLatestSnapshot, buildCurrentSnapshot, formatTimeline, formatDiffSummary, formatDiffForSummary, } from './diff.js';
// Project registry
export { registerProject, listProjects, formatProjectsList, updateProjectMeta, removeProject, pruneProjects, } from './projects.js';
// Registry operation journal — every read and write of the project registry
export { readJournal, formatJournal, appendJournalEvent, appendJournalEventSync, defaultRegistryDir, journalPathForDir, } from './registry-journal.js';
// Git utilities
export { getGitInfo } from './git.js';
// gator-memory — durable narrative store for ~/.navgator/memory/
export { memoryEnabled, memoryDir, projectMemoryPath, recordMemoryEvent, readProjectMemory, listProjectMemories, readMemoryEvents, memoryStoreStats, removeProjectMemory, rebuildMemoryIndex, reconcileMemory, slug as memoryProjectSlug, MEMORY_SCHEMA_VERSION, DEFAULT_MAX_EVENT_BYTES, MAX_MILESTONES, } from './memory/store.js';
// gator-memory mirror — optional one-way export into a build-loop-memory tree
export { mirrorStatus, mirrorProjectMemory, mirrorAll, } from './memory/mirror.js';
// gator-memory / registry health — the single computation behind `navgator doctor`
export { computeHealth, isTmpRootedPath, classifyRegistryEntries, selectPrunableEntries, HEALTH_SCHEMA_VERSION, } from './memory/health.js';
// Home-scoped configuration — ~/.navgator/config.json
export { loadHomeConfig, homeConfigPath, resetHomeConfigCache, } from './home-config.js';
// Component identity — base-name normalization and alias merging
export { componentBaseName, identityKey, mergeComponentAliases } from './component-identity.js';
// Git-aware — canonical/branch snapshot storage (slice 3) and pre-merge diff (slice 4)
export { writeSnapshotForCurrentRef, readCanonicalSnapshot, readBranchSnapshot, } from './git-aware/canonical.js';
export { getDefaultBranch, getCurrentBranch, getCurrentRef, isDefaultBranch, isWorktree, slugifyRef } from './git-aware/refs.js';
export { premergeDiff } from './git-aware/premerge-diff.js';
// Portfolio — multi-repo scanning and cross-repo mapping
export { discoverRepos } from './portfolio/discover.js';
export { scanPortfolio } from './portfolio/scan.js';
export { buildCrossRepoMap } from './portfolio/cross-repo.js';
// Remote — GitHub URL parsing, clone, and scan
export { parseGitHubUrl } from './remote/github-url.js';
export { scanRemote } from './remote/scan-remote.js';
// Impact analysis
export { computeImpact, computeSeverity } from './impact.js';
// Agent output
export { AGENT_OUTPUT_LIMITS, boundAgentCollection, wrapInEnvelope, buildExecutiveSummary, } from './agent-output.js';
// Compact serialization utilities
export { toCompactComponent, toCompactConnection } from './types.js';
// Resolve
export { resolveComponent, findCandidates } from './resolve.js';
// File-level resolution
export { resolveFileConnections, looksLikeFilePath, formatFileImpact, formatFileConnections } from './file-resolve.js';
// Import scanner
export { scanImports } from './scanners/connections/import-scanner.js';
// Classify
export { classifyConnection, classifyAllConnections } from './classify.js';
// Trace
export { traceDataflow, formatTraceOutput } from './trace.js';
// Rules
export { checkRules, getBuiltinRules, loadCustomRules, formatRulesOutput } from './rules.js';
// Coverage
export { computeCoverage, formatCoverageOutput } from './coverage.js';
// Subgraph
export { extractSubgraph, subgraphToMermaid } from './subgraph.js';
// Sandbox
export { detectSandbox, isSandboxMode, getSandboxRestrictions } from './sandbox.js';
// Prompt scanner exports
export { scanPrompts, formatPromptsOutput, formatPromptDetail, convertToArchitecture, } from './scanners/prompts/index.js';
//# sourceMappingURL=index.js.map