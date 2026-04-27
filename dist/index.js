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
export { registerProject, listProjects, formatProjectsList, } from './projects.js';
// Git utilities
export { getGitInfo } from './git.js';
// Impact analysis
export { computeImpact, computeSeverity } from './impact.js';
// Agent output
export { wrapInEnvelope, buildExecutiveSummary } from './agent-output.js';
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