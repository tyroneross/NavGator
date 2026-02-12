/**
 * Shared types for NavGator Web UI
 *
 * These types mirror the CLI scanner output but are optimized for UI display.
 */

// =============================================================================
// LLM CALL SITE (from anchor-based tracer)
// =============================================================================

export interface LLMCall {
  id: string;
  name: string;
  model: string;
  provider: string;
  file: string;
  line: number;
  lineEnd?: number;
  promptTemplate: string;
  promptVariables: string[];
  systemPrompt?: string;
  /** SDK method called (e.g. "chat.completions.create", "invoke") */
  method?: string;
  /** SDK package name (e.g. "openai", "groq-sdk", "@langchain/openai") */
  sdk?: string;
  /** Extracted call configuration (model, temperature, etc.) */
  configExtracted?: {
    temperature?: number;
    maxTokens?: number;
    stream?: boolean;
    tools?: string[];
  };
  category: "chat" | "completion" | "embedding" | "function" | "agent" | "image" | "audio";
  purpose?: string;
  confidence: number;
  tags: string[];
}

// =============================================================================
// PROMPT (stored prompt templates)
// =============================================================================

export interface Prompt {
  id: string;
  name: string;
  content: string;
  file: string;
  line: number;
  lineEnd?: number;
  usedBy: string[];
  variables: string[];
  tokenCount: number;
  type: "system" | "user" | "assistant" | "function";
  version?: string;
  lastModified: string;
  provider?: string;
  model?: string;
  category?: string;
  purpose?: string;
}

// =============================================================================
// COMPONENT (packages, services, infrastructure)
// =============================================================================

export interface Component {
  id: string;
  name: string;
  type: "npm" | "pip" | "spm" | "cargo" | "go" | "gem" | "composer" | "service" | "database" | "queue" | "infra" | "framework" | "prompt" | "llm";
  layer: "frontend" | "backend" | "data" | "shared" | "external" | "hosting";
  version?: string;
  purpose?: string;
  connections: number;
  status: "active" | "outdated" | "deprecated" | "removed";
  tags: string[];
  file?: string;
  line?: number;
}

// =============================================================================
// CONNECTION (relationships between components)
// =============================================================================

export interface Connection {
  id: string;
  from: string;
  fromComponent?: string;
  to: string;
  toComponent?: string;
  type: "service-call" | "api-calls-db" | "frontend-calls-api" | "queue-triggers" | "imports" | "prompt-usage" | "deploys-to" | "observes" | "conforms-to" | "notifies" | "stores" | "navigates-to" | "requires-entitlement" | "target-contains" | "generates" | "uses-package" | "other";
  symbol: string;
  line: number;
  code: string;
  confidence?: number;
}

// =============================================================================
// SUMMARY STATS
// =============================================================================

export interface LLMTrackingSummary {
  /** Total anchor-traced LLM call sites */
  totalCalls: number;
  /** Total detected prompt definitions */
  totalPrompts: number;
  byProvider: Record<string, number>;
  byModel: Record<string, number>;
  byCategory: Record<string, number>;
  templatesCount: number;
  withToolsCount: number;
  /** Number of unique files containing AI calls */
  filesWithAI?: number;
  lastScanned?: string;
}

export interface ComponentsSummary {
  totalComponents: number;
  byType: Record<string, number>;
  byLayer: Record<string, number>;
  outdatedCount: number;
  lastScanned?: string;
}

export interface ConnectionsSummary {
  totalConnections: number;
  byType: Record<string, number>;
  lastScanned?: string;
}

// =============================================================================
// API RESPONSES
// =============================================================================

export interface PromptsApiResponse {
  success: boolean;
  data?: {
    calls: LLMCall[];
    prompts: Prompt[];
    summary: LLMTrackingSummary;
  };
  error?: string;
  source: "scan" | "cache" | "mock";
}

export interface ComponentsApiResponse {
  success: boolean;
  data?: {
    components: Component[];
    summary: ComponentsSummary;
  };
  error?: string;
  source: "scan" | "cache" | "mock";
}

export interface ConnectionsApiResponse {
  success: boolean;
  data?: {
    connections: Connection[];
    summary: ConnectionsSummary;
  };
  error?: string;
  source: "scan" | "cache" | "mock";
}

// =============================================================================
// STATUS
// =============================================================================

export interface ProjectStatus {
  project_path: string;
  project_name: string;
  last_scan: number | null;
  last_scan_formatted: string | null;
  stats: {
    total_components: number;
    total_connections: number;
    components_by_type: Record<string, number>;
    connections_by_type: Record<string, number>;
    outdated_count: number;
    vulnerable_count: number;
  };
}

export interface StatusApiResponse {
  success: boolean;
  data?: ProjectStatus;
  error?: string;
  source: "scan" | "cache" | "mock";
}

// =============================================================================
// SCAN REQUEST
// =============================================================================

export interface ScanRequest {
  projectPath?: string;
  forceRescan?: boolean;
}
