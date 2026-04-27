/**
 * Prompt Scanner Types
 *
 * Rich types for tracking AI prompts in codebases.
 * Inspired by PromptLayer's registry pattern for version control and metadata.
 *
 * @see https://docs.promptlayer.com/features/prompt-registry/overview
 */
/**
 * A single message in a prompt (system, user, assistant)
 */
export interface PromptMessage {
    role: 'system' | 'user' | 'assistant' | 'function' | 'tool';
    content: string;
    name?: string;
    truncated?: boolean;
    originalLength?: number;
}
/**
 * Variables/placeholders in a prompt template
 */
export interface PromptVariable {
    name: string;
    pattern: string;
    type?: 'string' | 'array' | 'object' | 'unknown';
    required?: boolean;
    defaultValue?: string;
}
/**
 * AI provider configuration detected with the prompt
 */
export interface PromptProviderConfig {
    provider: 'anthropic' | 'openai' | 'azure' | 'google' | 'cohere' | 'unknown';
    model?: string;
    temperature?: number;
    maxTokens?: number;
    topP?: number;
    stopSequences?: string[];
    tools?: string[];
}
/**
 * A detected prompt in the codebase
 */
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
    templateSyntax?: 'jinja2' | 'fstring' | 'mustache' | 'template-literal' | 'unknown';
    provider?: PromptProviderConfig;
    usedBy: PromptUsage[];
    purpose?: string;
    tags: string[];
    category?: PromptCategory;
    confidence: number;
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
    callPattern: string;
    isAsync: boolean;
    hasStreaming: boolean;
}
/**
 * Prompt category based on detected purpose
 */
export type PromptCategory = 'chat' | 'completion' | 'extraction' | 'classification' | 'summarization' | 'translation' | 'code-generation' | 'code-review' | 'agent' | 'embedding' | 'unknown';
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
/**
 * Maximum prompt content length to store (characters)
 * Longer prompts are truncated with a note
 */
export declare const MAX_PROMPT_LENGTH = 2000;
/**
 * Maximum number of messages to store per prompt
 */
export declare const MAX_MESSAGES_PER_PROMPT = 10;
/**
 * Keywords that suggest prompt purpose
 */
export declare const PURPOSE_KEYWORDS: Record<PromptCategory, string[]>;
//# sourceMappingURL=types.d.ts.map