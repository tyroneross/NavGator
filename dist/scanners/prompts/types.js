/**
 * Prompt Scanner Types
 *
 * Rich types for tracking AI prompts in codebases.
 * Inspired by PromptLayer's registry pattern for version control and metadata.
 *
 * @see https://docs.promptlayer.com/features/prompt-registry/overview
 */
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
export const PURPOSE_KEYWORDS = {
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
//# sourceMappingURL=types.js.map