/**
 * Transform NavGator CLI scan data to UI-friendly formats
 *
 * LLMCall items come from the anchor-based tracer (TracedLLMCall[]).
 * Prompt items come from the regex prompt detector (DetectedPrompt[]).
 *
 * This module does NOT fabricate runtime metrics — NavGator is a static
 * code analysis tool, not a runtime monitor.
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

// =============================================================================
// TRACED LLM CALL (from llm-call-tracer.ts)
// =============================================================================

interface TracedLLMCall {
  id: string;
  name: string;
  anchor: {
    file: string;
    line: number;
    code: string;
    method: string;
  };
  provider: {
    name: string;
    sdk: string;
    importLine: number;
    clientVariable: string;
  };
  model: {
    value: string | null;
    isDynamic: boolean;
    variableName?: string;
    line: number;
  };
  prompt: {
    type: "messages-array" | "string-prompt" | "template" | "variable-ref";
    content?: string;
    systemPrompt?: string;
    hasUserTemplate: boolean;
    variables: string[];
    definitionFile?: string;
    definitionLine?: number;
  };
  config: {
    temperature?: number;
    maxTokens?: number;
    stream?: boolean;
    tools?: string[];
  };
  callType: "chat" | "completion" | "embedding" | "image" | "audio" | "function-call";
  confidence: number;
}

export interface PromptScanResult {
  prompts: DetectedPrompt[];
  summary: {
    totalPrompts: number;
    byProvider: Record<string, number>;
    byCategory: Record<string, number>;
    templatesCount: number;
    withToolsCount: number;
    tracedCallSites?: number;
  };
  warnings: Array<{
    type: "parse_error" | "truncated" | "ambiguous" | "deprecated_pattern";
    message: string;
    file?: string;
    line?: number;
  }>;
  /** Anchor-based traced LLM calls (present when tracer ran) */
  tracedCalls?: TracedLLMCall[];
}

// =============================================================================
// CATEGORY MAPPING
// =============================================================================

function mapCallType(
  callType: TracedLLMCall["callType"]
): LLMCall["category"] {
  switch (callType) {
    case "chat":
      return "chat";
    case "completion":
      return "completion";
    case "embedding":
      return "embedding";
    case "image":
      return "image";
    case "audio":
      return "audio";
    case "function-call":
      return "function";
    default:
      return "completion";
  }
}

function mapPromptCategory(
  category?: PromptCategory
): LLMCall["category"] {
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

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// =============================================================================
// TRANSFORM: TracedLLMCall → LLMCall (for "LLM Calls" tab)
// =============================================================================

function transformTracedCall(traced: TracedLLMCall): LLMCall {
  const promptContent =
    traced.prompt.content ||
    traced.prompt.systemPrompt ||
    traced.anchor.code ||
    "(prompt content not extracted)";

  return {
    id: traced.id,
    name: traced.name,
    model: traced.model.value || (traced.model.isDynamic ? `dynamic (${traced.model.variableName || "variable"})` : "unknown"),
    provider: traced.provider.name,
    file: traced.anchor.file,
    line: traced.anchor.line,
    promptTemplate: promptContent,
    promptVariables: traced.prompt.variables,
    systemPrompt: traced.prompt.systemPrompt,
    method: traced.anchor.method,
    sdk: traced.provider.sdk,
    configExtracted: Object.keys(traced.config).length > 0 ? traced.config : undefined,
    category: mapCallType(traced.callType),
    purpose: undefined,
    confidence: traced.confidence,
    tags: buildTracedCallTags(traced),
  };
}

function buildTracedCallTags(traced: TracedLLMCall): string[] {
  const tags: string[] = [traced.provider.name];

  if (traced.config.stream) tags.push("streaming");
  if (traced.config.tools && traced.config.tools.length > 0) tags.push("tool-use");
  if (traced.prompt.hasUserTemplate) tags.push("templated");
  if (traced.prompt.type === "messages-array") tags.push("messages-array");
  if (traced.model.isDynamic) tags.push("dynamic-model");

  return tags;
}

// =============================================================================
// TRANSFORM: DetectedPrompt → LLMCall (fallback when no tracer data)
// =============================================================================

function transformPromptToLLMCall(prompt: DetectedPrompt, index: number): LLMCall {
  const systemMsg = prompt.messages.find((m) => m.role === "system");
  const userMsg = prompt.messages.find((m) => m.role === "user");

  const promptTemplate =
    userMsg?.content ||
    prompt.rawContent ||
    prompt.messages.map((m) => `[${m.role}]\n${m.content}`).join("\n\n") ||
    "(No template content detected)";

  return {
    id: prompt.id || `prompt-${index}`,
    name: prompt.name || prompt.location.functionName || `Prompt_${index}`,
    model: prompt.provider?.model || "unknown",
    provider: prompt.provider?.provider || "unknown",
    file: prompt.location.file,
    line: prompt.location.lineStart,
    lineEnd: prompt.location.lineEnd,
    promptTemplate,
    promptVariables: prompt.variables.map((v) => v.name),
    systemPrompt: systemMsg?.content,
    category: mapPromptCategory(prompt.category),
    purpose: prompt.purpose,
    confidence: prompt.confidence,
    tags: prompt.tags.length > 0 ? prompt.tags : inferTags(prompt),
  };
}

// =============================================================================
// TRANSFORM: DetectedPrompt → Prompt (for "Prompts" tab)
// =============================================================================

function transformToPrompt(prompt: DetectedPrompt, index: number): Prompt {
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
    purpose: prompt.purpose,
  };
}

// =============================================================================
// MAIN TRANSFORM (public API)
// =============================================================================

/**
 * Transform scan result to UI format.
 *
 * - If tracedCalls are present (from the anchor-based tracer), LLMCall items
 *   come from those. This gives accurate provider/model attribution.
 * - Prompt items always come from DetectedPrompt[].
 * - No runtime metrics are fabricated.
 */
export function transformScanResultWithDefaults(result: PromptScanResult): {
  calls: LLMCall[];
  prompts: Prompt[];
  summary: LLMTrackingSummary;
} {
  const hasTracerData = result.tracedCalls && result.tracedCalls.length > 0;

  // LLM Calls: prefer tracer data; fall back to prompt-based
  let calls: LLMCall[];
  if (hasTracerData) {
    calls = result.tracedCalls!.map(transformTracedCall);
  } else if (result.prompts && result.prompts.length > 0) {
    calls = result.prompts.map((p, i) => transformPromptToLLMCall(p, i));
  } else {
    calls = [];
  }

  // Prompts: always from detected prompts
  const prompts = (result.prompts || []).map((p, i) => transformToPrompt(p, i));

  // Build summary from actual data
  const byProvider: Record<string, number> = {};
  const byModel: Record<string, number> = {};
  const byCategory: Record<string, number> = {};
  const filesWithAI = new Set<string>();

  for (const call of calls) {
    const provider = call.provider || "unknown";
    byProvider[provider] = (byProvider[provider] || 0) + 1;

    if (call.model && call.model !== "unknown" && !call.model.startsWith("dynamic")) {
      byModel[call.model] = (byModel[call.model] || 0) + 1;
    }

    byCategory[call.category] = (byCategory[call.category] || 0) + 1;
    filesWithAI.add(call.file);
  }

  const summary: LLMTrackingSummary = {
    totalCalls: calls.length,
    totalPrompts: prompts.length,
    byProvider,
    byModel,
    byCategory,
    templatesCount: result.summary?.templatesCount || calls.filter((c) => c.promptVariables.length > 0).length,
    withToolsCount: result.summary?.withToolsCount || calls.filter((c) => c.tags.includes("tool-use")).length,
    filesWithAI: filesWithAI.size,
    lastScanned: new Date().toISOString(),
  };

  return { calls, prompts, summary };
}

/**
 * Simple transform without fallbacks (used by POST endpoint)
 */
export function transformScanResult(result: PromptScanResult): {
  calls: LLMCall[];
  prompts: Prompt[];
  summary: LLMTrackingSummary;
} {
  return transformScanResultWithDefaults(result);
}

// =============================================================================
// HELPERS
// =============================================================================

function formatTimestamp(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;

  if (diff < 60000) return "Just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)} min ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} hours ago`;
  return new Date(timestamp).toLocaleDateString();
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

// =============================================================================
// DEMO DATA
// =============================================================================

/**
 * Generate demo data that reflects what a real scan looks like.
 * Clearly marked as demo — no fabricated runtime metrics.
 */
export function generateDemoData(): {
  calls: LLMCall[];
  prompts: Prompt[];
  summary: LLMTrackingSummary;
} {
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
      method: "chat.completions.create",
      sdk: "openai",
      configExtracted: { temperature: 0.7, maxTokens: 500 },
      category: "completion",
      purpose: "Generate product descriptions for e-commerce",
      confidence: 0.95,
      tags: ["openai", "templated"],
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
      method: "messages.create",
      sdk: "@anthropic-ai/sdk",
      configExtracted: { maxTokens: 1024 },
      category: "chat",
      purpose: "Customer support chatbot",
      confidence: 0.98,
      tags: ["anthropic", "streaming"],
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
      method: "embeddings.create",
      sdk: "openai",
      category: "embedding",
      purpose: "Generate document embeddings for search",
      confidence: 0.99,
      tags: ["openai", "embedding"],
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
      method: "chat.completions.create",
      sdk: "openai",
      configExtracted: { temperature: 0 },
      category: "function",
      purpose: "Classify user intent for routing",
      confidence: 0.92,
      tags: ["openai", "structured-output"],
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
      method: "chat.completions.create",
      sdk: "openai",
      configExtracted: { temperature: 0.3, tools: ["web_search", "read_document"] },
      category: "agent",
      purpose: "Research assistant with tool access",
      confidence: 0.88,
      tags: ["openai", "tool-use"],
    },
  ];

  const demoPrompts: Prompt[] = [
    {
      id: "demo-prompt-1",
      name: "PRODUCT_COPYWRITER_SYSTEM",
      content: `You are a professional copywriter specializing in e-commerce product descriptions.\n\nYour writing style should be:\n- Compelling and benefit-focused\n- Clear and concise\n- SEO-optimized with natural keyword placement`,
      file: "lib/ai/prompts/product.ts",
      line: 5,
      usedBy: ["generateProductDescription"],
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
      content: `You are a helpful customer support assistant for TechCorp.\n\nGuidelines:\n1. Be friendly, professional, and empathetic\n2. If you don't know something, say so honestly\n3. Escalate to human support for: refunds > $100, legal issues, security concerns`,
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
      content: `Classify the following user message into one of these categories: {{availableCategories}}\n\nUser message: "{{userMessage}}"\n\nRespond with JSON.`,
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
  ];

  const summary: LLMTrackingSummary = {
    totalCalls: demoCalls.length,
    totalPrompts: demoPrompts.length,
    byProvider: { openai: 4, anthropic: 1 },
    byModel: {
      "gpt-4-turbo": 2,
      "gpt-4o-mini": 1,
      "text-embedding-3-small": 1,
      "claude-3-sonnet": 1,
    },
    byCategory: { completion: 1, chat: 1, embedding: 1, function: 1, agent: 1 },
    templatesCount: 3,
    withToolsCount: 1,
    filesWithAI: 5,
    lastScanned: new Date().toISOString(),
  };

  return { calls: demoCalls, prompts: demoPrompts, summary };
}
