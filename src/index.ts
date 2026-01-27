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
export { getConfig, type NavGatorConfig } from './config.js';

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
} from './types.js';

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
