/**
 * Prompt Scanner Types
 *
 * Rich types for tracking AI prompts in codebases.
 * Inspired by PromptLayer's registry pattern for version control and metadata.
 *
 * @see https://docs.promptlayer.com/features/prompt-registry/overview
 */

// =============================================================================
// PROMPT STRUCTURE
// =============================================================================

/**
 * A single message in a prompt (system, user, assistant)
 */
export interface PromptMessage {
  role: 'system' | 'user' | 'assistant' | 'function' | 'tool';
  content: string;
  name?: string;           // For function/tool messages
  truncated?: boolean;     // If content was truncated for storage
  originalLength?: number; // Original length before truncation
}

/**
 * Variables/placeholders in a prompt template
 */
export interface PromptVariable {
  name: string;            // Variable name (e.g., "user_input", "context")
  pattern: string;         // How it appears in template (e.g., "{user_input}", "{{context}}")
  type?: 'string' | 'array' | 'object' | 'unknown';
  required?: boolean;
  defaultValue?: string;
}

/**
 * AI provider configuration detected with the prompt
 */
export interface PromptProviderConfig {
  provider: 'anthropic' | 'openai' | 'azure' | 'google' | 'cohere' | 'unknown';
  model?: string;          // e.g., "claude-3-opus", "gpt-4"
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  stopSequences?: string[];
  tools?: string[];        // Tool/function names if detected
}

// =============================================================================
// PROMPT DETECTION RESULT
// =============================================================================

/**
 * A detected prompt in the codebase
 */
export interface DetectedPrompt {
  // Identity
  id: string;                      // Unique ID (PROMPT_xxx)
  name: string;                    // Extracted name or generated

  // Location
  location: {
    file: string;                  // Relative file path
    lineStart: number;             // Starting line
    lineEnd: number;               // Ending line
    functionName?: string;         // Containing function
    className?: string;            // Containing class (if any)
    exportName?: string;           // If exported, the export name
  };

  // Content
  messages: PromptMessage[];       // Full prompt messages
  rawContent?: string;             // Raw string if single-string prompt

  // Template info
  isTemplate: boolean;             // Has variables/placeholders
  variables: PromptVariable[];     // Detected variables
  templateSyntax?: 'jinja2' | 'fstring' | 'mustache' | 'template-literal' | 'unknown';

  // Provider & Usage
  provider?: PromptProviderConfig;
  usedBy: PromptUsage[];           // Where this prompt is called

  // Metadata
  purpose?: string;                // Extracted from comments/docstrings
  tags: string[];                  // Auto-detected tags
  category?: PromptCategory;

  // Detection info
  confidence: number;              // 0-1 detection confidence
  detectionMethod: 'ast' | 'regex' | 'heuristic';
  timestamp: number;
}

/**
 * Where a prompt is used (called)
 */
export interface PromptUsage {
  file: string;
  line: number;
  functionName?: string;
  callPattern: string;             // e.g., "anthropic.messages.create", "openai.chat.completions.create"
  isAsync: boolean;
  hasStreaming: boolean;
}

/**
 * Prompt category based on detected purpose
 */
export type PromptCategory =
  | 'chat'              // Conversational
  | 'completion'        // Text completion
  | 'extraction'        // Data extraction
  | 'classification'    // Categorization
  | 'summarization'     // Summarizing content
  | 'translation'       // Language translation
  | 'code-generation'   // Writing code
  | 'code-review'       // Reviewing code
  | 'agent'             // Agent/tool use
  | 'embedding'         // Generating embeddings
  | 'unknown';

// =============================================================================
// PROMPT PATTERNS
// =============================================================================

/**
 * Pattern definition for detecting prompts
 */
export interface PromptPattern {
  name: string;
  provider: PromptProviderConfig['provider'];
  patterns: RegExp[];
  messageExtractor?: (content: string, match: RegExpMatchArray) => PromptMessage[] | null;
  configExtractor?: (content: string) => Partial<PromptProviderConfig>;
}

// =============================================================================
// SCAN RESULT
// =============================================================================

/**
 * Result of prompt scanning
 */
export interface PromptScanResult {
  prompts: DetectedPrompt[];
  summary: {
    totalPrompts: number;
    byProvider: Record<string, number>;
    byCategory: Record<string, number>;
    templatesCount: number;
    withToolsCount: number;
    /** Number of anchor-traced LLM call sites (from llm-call-tracer) */
    tracedCallSites?: number;
  };
  warnings: PromptWarning[];
  /** Anchor-based traced LLM calls (from llm-call-tracer). Present when tracer ran. */
  tracedCalls?: import('../connections/llm-call-tracer.js').TracedLLMCall[];
}

export interface PromptWarning {
  type: 'parse_error' | 'truncated' | 'ambiguous' | 'deprecated_pattern';
  message: string;
  file?: string;
  line?: number;
}

// =============================================================================
// CONSTANTS
// =============================================================================

/**
 * Maximum prompt content length to store (characters)
 * Longer prompts are truncated with a note
 */
export const MAX_PROMPT_LENGTH = 2000;

/**
 * Maximum number of messages to store per prompt
 */
export const MAX_MESSAGES_PER_PROMPT = 10;

/**
 * Keywords that suggest prompt purpose
 */
export const PURPOSE_KEYWORDS: Record<PromptCategory, string[]> = {
  'chat': ['chat', 'conversation', 'assistant', 'helpful'],
  'completion': ['complete', 'continue', 'generate'],
  'extraction': ['extract', 'parse', 'identify', 'find'],
  'classification': ['classify', 'categorize', 'label', 'determine'],
  'summarization': ['summarize', 'summary', 'tldr', 'condense'],
  'translation': ['translate', 'convert', 'language'],
  'code-generation': ['code', 'implement', 'write function', 'generate code'],
  'code-review': ['review', 'analyze code', 'find bugs', 'improve'],
  'agent': ['tool', 'function', 'action', 'execute'],
  'embedding': ['embed', 'vector', 'similarity'],
  'unknown': [],
};
