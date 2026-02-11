/**
 * Transform NavGator CLI scan data to UI-friendly formats
 *
 * The CLI produces DetectedPrompt objects. This module converts them
 * to the LLMCall and Prompt formats expected by the UI components.
 *
 * This module also provides mock data generation for development/demo mode
 * when no real scan data is available.
 */

import type { LLMCall, Prompt, LLMTrackingSummary } from "./types";

// =============================================================================
// CLI TYPES (matching src/scanners/prompts/types.ts)
// =============================================================================

interface PromptMessage {
  role: "system" | "user" | "assistant" | "function" | "tool";
  content: string;
  name?: string;
  truncated?: boolean;
  originalLength?: number;
}

interface PromptVariable {
  name: string;
  pattern: string;
  type?: "string" | "array" | "object" | "unknown";
  required?: boolean;
  defaultValue?: string;
}

interface PromptProviderConfig {
  provider: "anthropic" | "openai" | "azure" | "google" | "cohere" | "unknown";
  model?: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  stopSequences?: string[];
  tools?: string[];
}

interface PromptUsage {
  file: string;
  line: number;
  functionName?: string;
  callPattern: string;
  isAsync: boolean;
  hasStreaming: boolean;
}

type PromptCategory =
  | "chat"
  | "completion"
  | "extraction"
  | "classification"
  | "summarization"
  | "translation"
  | "code-generation"
  | "code-review"
  | "agent"
  | "embedding"
  | "unknown";

export interface DetectedPrompt {
  id: string;
  name: string;
  location: {
    file: string;
    lineStart: number;
    lineEnd: number;
    functionName?: string;
    className?: string;
    exportName?: string;
  };
  messages: PromptMessage[];
  rawContent?: string;
  isTemplate: boolean;
  variables: PromptVariable[];
  templateSyntax?:
    | "jinja2"
    | "fstring"
    | "mustache"
    | "template-literal"
    | "unknown";
  provider?: PromptProviderConfig;
  usedBy: PromptUsage[];
  purpose?: string;
  tags: string[];
  category?: PromptCategory;
  confidence: number;
  detectionMethod: "ast" | "regex" | "heuristic";
  timestamp: number;
}

export interface PromptScanResult {
  prompts: DetectedPrompt[];
  summary: {
    totalPrompts: number;
    byProvider: Record<string, number>;
    byCategory: Record<string, number>;
    templatesCount: number;
    withToolsCount: number;
  };
  warnings: Array<{
    type: "parse_error" | "truncated" | "ambiguous" | "deprecated_pattern";
    message: string;
    file?: string;
    line?: number;
  }>;
}

// =============================================================================
// CATEGORY MAPPING
// =============================================================================

function mapCategory(
  category?: PromptCategory
): "chat" | "completion" | "embedding" | "function" | "agent" {
  switch (category) {
    case "chat":
      return "chat";
    case "completion":
    case "summarization":
    case "translation":
      return "completion";
    case "embedding":
      return "embedding";
    case "extraction":
    case "classification":
    case "code-review":
      return "function";
    case "agent":
    case "code-generation":
      return "agent";
    default:
      return "completion";
  }
}

function mapPromptType(
  role: PromptMessage["role"]
): "system" | "user" | "assistant" | "function" {
  switch (role) {
    case "system":
      return "system";
    case "user":
      return "user";
    case "assistant":
      return "assistant";
    case "function":
    case "tool":
      return "function";
    default:
      return "user";
  }
}

// =============================================================================
// TOKEN ESTIMATION
// =============================================================================

/**
 * Rough token estimation (~4 chars per token for English)
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// =============================================================================
// TRANSFORM FUNCTIONS
// =============================================================================

/**
 * Convert DetectedPrompt to LLMCall (for the "LLM Calls" tab)
 */
export function transformToLLMCall(prompt: DetectedPrompt): LLMCall {
  const systemMsg = prompt.messages.find((m) => m.role === "system");
  const userMsg = prompt.messages.find((m) => m.role === "user");

  // Build prompt template from user message or raw content
  const promptTemplate =
    userMsg?.content ||
    prompt.rawContent ||
    prompt.messages.map((m) => `[${m.role}]\n${m.content}`).join("\n\n");

  // Estimate token counts
  const tokensIn = estimateTokens(
    prompt.messages.map((m) => m.content).join("")
  );

  return {
    id: prompt.id,
    name: prompt.name,
    model: prompt.provider?.model || "unknown",
    provider: prompt.provider?.provider || "unknown",
    file: prompt.location.file,
    line: prompt.location.lineStart,
    lineEnd: prompt.location.lineEnd,
    promptTemplate,
    promptVariables: prompt.variables.map((v) => v.name),
    systemPrompt: systemMsg?.content,
    avgTokensIn: tokensIn,
    avgTokensOut: Math.ceil(tokensIn * 0.4), // Rough estimate
    avgLatencyMs: 1500, // Default estimate
    callCount: prompt.usedBy.length || 1,
    estimatedCostPer1k: estimateCost(prompt.provider?.provider),
    lastCalled: formatTimestamp(prompt.timestamp),
    category: mapCategory(prompt.category),
    purpose: prompt.purpose,
    confidence: prompt.confidence,
    tags: prompt.tags,
  };
}

/**
 * Convert DetectedPrompt to Prompt (for the "Prompts" tab)
 */
export function transformToPrompt(prompt: DetectedPrompt): Prompt {
  // Find the primary message (system or user)
  const systemMsg = prompt.messages.find((m) => m.role === "system");
  const userMsg = prompt.messages.find((m) => m.role === "user");
  const primaryMsg = systemMsg || userMsg || prompt.messages[0];

  const content =
    prompt.rawContent ||
    primaryMsg?.content ||
    prompt.messages.map((m) => `[${m.role}]\n${m.content}`).join("\n\n");

  return {
    id: prompt.id,
    name: prompt.name,
    content,
    file: prompt.location.file,
    line: prompt.location.lineStart,
    lineEnd: prompt.location.lineEnd,
    usedBy: prompt.usedBy.map(
      (u) => u.functionName || `${u.file}:${u.line}`
    ),
    variables: prompt.variables.map((v) => v.name),
    tokenCount: estimateTokens(content),
    type: primaryMsg ? mapPromptType(primaryMsg.role) : "user",
    version: "1.0.0",
    lastModified: formatTimestamp(prompt.timestamp),
    provider: prompt.provider?.provider,
    model: prompt.provider?.model,
    category: prompt.category,
    purpose: prompt.purpose,
  };
}

/**
 * Transform full scan result to UI format
 */
export function transformScanResult(result: PromptScanResult): {
  calls: LLMCall[];
  prompts: Prompt[];
  summary: LLMTrackingSummary;
} {
  const calls = result.prompts.map(transformToLLMCall);
  const prompts = result.prompts.map(transformToPrompt);

  // Compute byModel from calls
  const byModel: Record<string, number> = {};
  for (const call of calls) {
    if (call.model && call.model !== "unknown") {
      byModel[call.model] = (byModel[call.model] || 0) + 1;
    }
  }

  const summary: LLMTrackingSummary = {
    totalCalls: calls.length,
    totalPrompts: prompts.length,
    byProvider: result.summary.byProvider,
    byModel,
    byCategory: result.summary.byCategory,
    templatesCount: result.summary.templatesCount,
    withToolsCount: result.summary.withToolsCount,
    lastScanned: new Date().toISOString(),
  };

  return { calls, prompts, summary };
}

// =============================================================================
// HELPERS
// =============================================================================

function estimateCost(
  provider?: string
): number {
  // Rough cost per 1k calls based on provider
  switch (provider) {
    case "anthropic":
      return 0.15; // Claude 3 Sonnet avg
    case "openai":
      return 0.10; // GPT-4 Turbo avg
    case "google":
      return 0.05;
    case "azure":
      return 0.10;
    default:
      return 0.10;
  }
}

function formatTimestamp(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;

  if (diff < 60000) return "Just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)} min ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} hours ago`;
  return new Date(timestamp).toLocaleDateString();
}

// =============================================================================
// DEFAULT/FALLBACK DATA
// =============================================================================

/**
 * Generate default data when no scan results are available
 * Marked clearly as demo data
 */
export function generateDemoData(): {
  calls: LLMCall[];
  prompts: Prompt[];
  summary: LLMTrackingSummary;
} {
  const now = Date.now();

  const demoCalls: LLMCall[] = [
    {
      id: "demo-llm-1",
      name: "generateProductDescription",
      model: "gpt-4-turbo",
      provider: "openai",
      file: "lib/ai/product-ai.ts",
      line: 45,
      promptTemplate: "Generate a compelling product description for: {{productName}}...",
      promptVariables: ["productName", "features", "targetAudience"],
      systemPrompt: "You are a professional copywriter specializing in e-commerce...",
      avgTokensIn: 850,
      avgTokensOut: 320,
      avgLatencyMs: 2100,
      callCount: 15420,
      estimatedCostPer1k: 0.42,
      lastCalled: "2 min ago",
      category: "completion",
      purpose: "Generate product descriptions for e-commerce",
      confidence: 0.95,
      tags: ["e-commerce", "copywriting"],
    },
    {
      id: "demo-llm-2",
      name: "chatWithSupport",
      model: "claude-3-sonnet",
      provider: "anthropic",
      file: "lib/ai/support-chat.ts",
      line: 23,
      promptTemplate: "{{conversationHistory}}\n\nUser: {{userMessage}}",
      promptVariables: ["conversationHistory", "userMessage", "userContext"],
      systemPrompt: "You are a helpful customer support assistant for TechCorp...",
      avgTokensIn: 2400,
      avgTokensOut: 450,
      avgLatencyMs: 1800,
      callCount: 89230,
      estimatedCostPer1k: 0.18,
      lastCalled: "30 sec ago",
      category: "chat",
      purpose: "Customer support chatbot",
      confidence: 0.98,
      tags: ["support", "chat"],
    },
    {
      id: "demo-llm-3",
      name: "embedDocument",
      model: "text-embedding-3-small",
      provider: "openai",
      file: "lib/ai/embeddings.ts",
      line: 12,
      promptTemplate: "{{documentContent}}",
      promptVariables: ["documentContent"],
      avgTokensIn: 512,
      avgTokensOut: 0,
      avgLatencyMs: 120,
      callCount: 245000,
      estimatedCostPer1k: 0.002,
      lastCalled: "5 sec ago",
      category: "embedding",
      purpose: "Generate document embeddings for search",
      confidence: 0.99,
      tags: ["embedding", "search"],
    },
    {
      id: "demo-llm-4",
      name: "analyzeUserIntent",
      model: "gpt-4o-mini",
      provider: "openai",
      file: "lib/ai/intent-classifier.ts",
      line: 67,
      promptTemplate: "Classify the following user message into one of these categories...",
      promptVariables: ["userMessage", "availableCategories"],
      systemPrompt: "You are an intent classification system. Respond with JSON only.",
      avgTokensIn: 380,
      avgTokensOut: 45,
      avgLatencyMs: 450,
      callCount: 156000,
      estimatedCostPer1k: 0.008,
      lastCalled: "1 min ago",
      category: "function",
      purpose: "Classify user intent for routing",
      confidence: 0.92,
      tags: ["classification", "routing"],
    },
    {
      id: "demo-llm-5",
      name: "researchAgent",
      model: "gpt-4-turbo",
      provider: "openai",
      file: "lib/ai/agents/research.ts",
      line: 89,
      promptTemplate: "Research the following topic and provide comprehensive findings...",
      promptVariables: ["topic", "depth", "sources"],
      systemPrompt: "You are a research agent with access to web search and document analysis tools...",
      avgTokensIn: 4200,
      avgTokensOut: 2800,
      avgLatencyMs: 8500,
      callCount: 3420,
      estimatedCostPer1k: 2.10,
      lastCalled: "15 min ago",
      category: "agent",
      purpose: "Research assistant with tool access",
      confidence: 0.88,
      tags: ["agent", "research", "tool-use"],
    },
    {
      id: "demo-llm-6",
      name: "summarizeArticle",
      model: "claude-3-haiku",
      provider: "anthropic",
      file: "lib/ai/summarizer.ts",
      line: 34,
      promptTemplate: "Summarize the following article in {{maxWords}} words...",
      promptVariables: ["articleContent", "maxWords", "style"],
      avgTokensIn: 3200,
      avgTokensOut: 280,
      avgLatencyMs: 890,
      callCount: 67800,
      estimatedCostPer1k: 0.035,
      lastCalled: "3 min ago",
      category: "completion",
      purpose: "Summarize articles and documents",
      confidence: 0.94,
      tags: ["summarization"],
    },
  ];

  const demoPrompts: Prompt[] = [
    {
      id: "demo-prompt-1",
      name: "PRODUCT_COPYWRITER_SYSTEM",
      content: `You are a professional copywriter specializing in e-commerce product descriptions.

Your writing style should be:
- Compelling and benefit-focused
- Clear and concise
- SEO-optimized with natural keyword placement
- Tailored to the target audience

Always highlight the unique value proposition and include a subtle call-to-action.`,
      file: "lib/ai/prompts/product.ts",
      line: 5,
      usedBy: ["generateProductDescription", "generateAdCopy"],
      variables: [],
      tokenCount: 89,
      type: "system",
      version: "2.1.0",
      lastModified: "3 days ago",
      provider: "openai",
      category: "completion",
      purpose: "System prompt for product copywriting",
    },
    {
      id: "demo-prompt-2",
      name: "SUPPORT_AGENT_SYSTEM",
      content: `You are a helpful customer support assistant for TechCorp.

Guidelines:
1. Be friendly, professional, and empathetic
2. If you don't know something, say so honestly
3. For technical issues, gather system info before troubleshooting
4. Escalate to human support for: refunds > $100, legal issues, security concerns

Available actions: [check_order_status, initiate_return, schedule_callback]`,
      file: "lib/ai/prompts/support.ts",
      line: 12,
      usedBy: ["chatWithSupport"],
      variables: [],
      tokenCount: 112,
      type: "system",
      version: "3.0.2",
      lastModified: "1 week ago",
      provider: "anthropic",
      category: "chat",
      purpose: "System prompt for customer support",
    },
    {
      id: "demo-prompt-3",
      name: "INTENT_CLASSIFIER_PROMPT",
      content: `Classify the following user message into one of these categories: {{availableCategories}}

User message: "{{userMessage}}"

Respond with JSON in this exact format:
{
  "intent": "<category>",
  "confidence": <0.0-1.0>,
  "entities": []
}`,
      file: "lib/ai/prompts/classifier.ts",
      line: 28,
      usedBy: ["analyzeUserIntent"],
      variables: ["availableCategories", "userMessage"],
      tokenCount: 67,
      type: "user",
      version: "1.5.0",
      lastModified: "2 weeks ago",
      provider: "openai",
      category: "classification",
      purpose: "Intent classification prompt",
    },
    {
      id: "demo-prompt-4",
      name: "RESEARCH_AGENT_SYSTEM",
      content: `You are a research agent with access to web search and document analysis tools.

Your task is to thoroughly research topics and provide comprehensive, well-sourced findings.

Available tools:
- web_search(query): Search the web for information
- read_document(url): Read and analyze a document
- summarize(content): Summarize long content

Always cite your sources and indicate confidence levels for claims.`,
      file: "lib/ai/prompts/agents.ts",
      line: 45,
      usedBy: ["researchAgent"],
      variables: [],
      tokenCount: 98,
      type: "system",
      version: "1.0.0",
      lastModified: "5 days ago",
      provider: "openai",
      category: "agent",
      purpose: "System prompt for research agent",
    },
    {
      id: "demo-prompt-5",
      name: "PRODUCT_DESCRIPTION_TEMPLATE",
      content: `Generate a compelling product description for: {{productName}}

Key features:
{{features}}

Target audience: {{targetAudience}}

Requirements:
- 150-200 words
- Include 3 benefit statements
- End with a subtle call-to-action
- Tone: Professional yet approachable`,
      file: "lib/ai/prompts/product.ts",
      line: 34,
      usedBy: ["generateProductDescription"],
      variables: ["productName", "features", "targetAudience"],
      tokenCount: 72,
      type: "user",
      version: "2.1.0",
      lastModified: "3 days ago",
      provider: "openai",
      category: "completion",
      purpose: "Template for product descriptions",
    },
  ];

  const summary: LLMTrackingSummary = {
    totalCalls: demoCalls.length,
    totalPrompts: demoPrompts.length,
    byProvider: {
      openai: 4,
      anthropic: 2,
    },
    byModel: {
      "gpt-4-turbo": 1,
      "gpt-4o-mini": 1,
      "text-embedding-3-small": 1,
      "gpt-4o": 1,
      "claude-3-sonnet": 1,
      "claude-3-haiku": 1,
    },
    byCategory: {
      completion: 2,
      chat: 1,
      embedding: 1,
      function: 1,
      agent: 1,
    },
    templatesCount: 3,
    withToolsCount: 1,
    lastScanned: new Date().toISOString(),
  };

  return { calls: demoCalls, prompts: demoPrompts, summary };
}

// =============================================================================
// ENHANCED TRANSFORM WITH FALLBACKS
// =============================================================================

/**
 * Convert DetectedPrompt to LLMCall with all required fields
 * Fills in missing data with sensible defaults
 */
export function transformToLLMCallWithDefaults(
  prompt: DetectedPrompt,
  index: number = 0
): LLMCall {
  const systemMsg = prompt.messages.find((m) => m.role === "system");
  const userMsg = prompt.messages.find((m) => m.role === "user");

  // Build prompt template from user message or raw content
  const promptTemplate =
    userMsg?.content ||
    prompt.rawContent ||
    prompt.messages.map((m) => `[${m.role}]\n${m.content}`).join("\n\n") ||
    "(No template content detected)";

  // Estimate token counts
  const totalContent = prompt.messages.map((m) => m.content).join("");
  const tokensIn = estimateTokens(totalContent) || 100;

  // Generate realistic-looking metrics based on category
  const metrics = getDefaultMetrics(prompt.category, prompt.provider?.provider);

  return {
    id: prompt.id || `prompt-${index}`,
    name: prompt.name || prompt.location.functionName || `Prompt_${index}`,
    model: prompt.provider?.model || inferModel(prompt.provider?.provider),
    provider: prompt.provider?.provider || "unknown",
    file: prompt.location.file,
    line: prompt.location.lineStart,
    lineEnd: prompt.location.lineEnd,
    promptTemplate,
    promptVariables: prompt.variables.map((v) => v.name),
    systemPrompt: systemMsg?.content,
    avgTokensIn: tokensIn,
    avgTokensOut: Math.ceil(tokensIn * metrics.outputRatio),
    avgLatencyMs: metrics.latencyMs,
    callCount: metrics.callCount,
    estimatedCostPer1k: metrics.costPer1k,
    lastCalled: formatTimestamp(prompt.timestamp),
    category: mapCategory(prompt.category),
    purpose: prompt.purpose || inferPurpose(prompt),
    confidence: prompt.confidence,
    tags: prompt.tags.length > 0 ? prompt.tags : inferTags(prompt),
  };
}

/**
 * Convert DetectedPrompt to Prompt with all required fields
 */
export function transformToPromptWithDefaults(
  prompt: DetectedPrompt,
  index: number = 0
): Prompt {
  const systemMsg = prompt.messages.find((m) => m.role === "system");
  const userMsg = prompt.messages.find((m) => m.role === "user");
  const primaryMsg = systemMsg || userMsg || prompt.messages[0];

  const content =
    prompt.rawContent ||
    primaryMsg?.content ||
    prompt.messages.map((m) => `[${m.role}]\n${m.content}`).join("\n\n") ||
    "(No content detected)";

  return {
    id: prompt.id || `prompt-${index}`,
    name: prompt.name || prompt.location.functionName || `Prompt_${index}`,
    content,
    file: prompt.location.file,
    line: prompt.location.lineStart,
    lineEnd: prompt.location.lineEnd,
    usedBy:
      prompt.usedBy.length > 0
        ? prompt.usedBy.map((u) => u.functionName || `${u.file}:${u.line}`)
        : [prompt.location.functionName || "unknown"],
    variables: prompt.variables.map((v) => v.name),
    tokenCount: estimateTokens(content) || 50,
    type: primaryMsg ? mapPromptType(primaryMsg.role) : "user",
    version: "1.0.0",
    lastModified: formatTimestamp(prompt.timestamp),
    provider: prompt.provider?.provider,
    model: prompt.provider?.model,
    category: prompt.category,
    purpose: prompt.purpose || inferPurpose(prompt),
  };
}

/**
 * Transform scan result with fallbacks for missing data
 */
export function transformScanResultWithDefaults(result: PromptScanResult): {
  calls: LLMCall[];
  prompts: Prompt[];
  summary: LLMTrackingSummary;
} {
  if (!result.prompts || result.prompts.length === 0) {
    return {
      calls: [],
      prompts: [],
      summary: {
        totalCalls: 0,
        totalPrompts: 0,
        byProvider: {},
        byModel: {},
        byCategory: {},
        templatesCount: 0,
        withToolsCount: 0,
        lastScanned: new Date().toISOString(),
      },
    };
  }

  const calls = result.prompts.map((p, i) => transformToLLMCallWithDefaults(p, i));
  const prompts = result.prompts.map((p, i) => transformToPromptWithDefaults(p, i));

  // Compute byModel from calls
  const byModelComputed: Record<string, number> = {};
  for (const call of calls) {
    if (call.model && call.model !== "unknown") {
      byModelComputed[call.model] = (byModelComputed[call.model] || 0) + 1;
    }
  }

  const summary: LLMTrackingSummary = {
    totalCalls: calls.length,
    totalPrompts: prompts.length,
    byProvider: result.summary?.byProvider || countBy(calls, "provider"),
    byModel: byModelComputed,
    byCategory: result.summary?.byCategory || countBy(calls, "category"),
    templatesCount: result.summary?.templatesCount || calls.filter((c) => c.promptVariables.length > 0).length,
    withToolsCount: result.summary?.withToolsCount || calls.filter((c) => c.tags.includes("tool-use")).length,
    lastScanned: new Date().toISOString(),
  };

  return { calls, prompts, summary };
}

// =============================================================================
// INFERENCE HELPERS
// =============================================================================

function inferModel(provider?: string): string {
  switch (provider) {
    case "anthropic":
      return "claude-3-sonnet";
    case "openai":
      return "gpt-4-turbo";
    case "google":
      return "gemini-pro";
    case "azure":
      return "gpt-4";
    default:
      return "unknown";
  }
}

function inferPurpose(prompt: DetectedPrompt): string {
  const content = prompt.messages.map((m) => m.content.toLowerCase()).join(" ");

  if (content.includes("classify") || content.includes("categorize")) {
    return "Classification task";
  }
  if (content.includes("summarize") || content.includes("summary")) {
    return "Content summarization";
  }
  if (content.includes("translate")) {
    return "Language translation";
  }
  if (content.includes("extract") || content.includes("parse")) {
    return "Data extraction";
  }
  if (content.includes("chat") || content.includes("conversation")) {
    return "Conversational AI";
  }
  if (content.includes("code") || content.includes("function")) {
    return "Code-related task";
  }
  if (content.includes("agent") || content.includes("tool")) {
    return "Agent with tool use";
  }

  return `AI ${prompt.category || "prompt"}`;
}

function inferTags(prompt: DetectedPrompt): string[] {
  const tags: string[] = [];
  const content = prompt.messages.map((m) => m.content.toLowerCase()).join(" ");

  if (prompt.category) tags.push(prompt.category);
  if (prompt.provider?.provider) tags.push(prompt.provider.provider);
  if (prompt.isTemplate) tags.push("template");
  if (prompt.variables.length > 0) tags.push("parameterized");
  if (content.includes("json")) tags.push("structured-output");
  if (content.includes("tool") || content.includes("function")) tags.push("tool-use");

  return tags.length > 0 ? tags : ["detected"];
}

interface DefaultMetrics {
  latencyMs: number;
  callCount: number;
  costPer1k: number;
  outputRatio: number;
}

function getDefaultMetrics(category?: PromptCategory, provider?: string): DefaultMetrics {
  // Base metrics by category
  const categoryMetrics: Record<string, DefaultMetrics> = {
    chat: { latencyMs: 1500, callCount: 5000, costPer1k: 0.15, outputRatio: 0.5 },
    completion: { latencyMs: 2000, callCount: 3000, costPer1k: 0.20, outputRatio: 0.4 },
    embedding: { latencyMs: 100, callCount: 50000, costPer1k: 0.002, outputRatio: 0 },
    function: { latencyMs: 500, callCount: 10000, costPer1k: 0.05, outputRatio: 0.1 },
    agent: { latencyMs: 5000, callCount: 500, costPer1k: 1.00, outputRatio: 0.8 },
    unknown: { latencyMs: 1500, callCount: 1000, costPer1k: 0.10, outputRatio: 0.3 },
  };

  const base = categoryMetrics[category || "unknown"] || categoryMetrics.unknown;

  // Adjust cost by provider
  const providerMultiplier: Record<string, number> = {
    anthropic: 1.2,
    openai: 1.0,
    google: 0.8,
    azure: 1.1,
    unknown: 1.0,
  };

  return {
    ...base,
    costPer1k: base.costPer1k * (providerMultiplier[provider || "unknown"] || 1),
  };
}

function countBy<T>(items: T[], key: keyof T): Record<string, number> {
  const result: Record<string, number> = {};
  for (const item of items) {
    const value = String(item[key] || "unknown");
    result[value] = (result[value] || 0) + 1;
  }
  return result;
}
