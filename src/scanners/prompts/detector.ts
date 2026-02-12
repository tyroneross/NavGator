/**
 * Prompt Detector
 *
 * Detects AI prompt patterns in source code using regex patterns.
 * For more accurate detection, use the AST-based extractor.
 */

import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';
import {
  DetectedPrompt,
  PromptMessage,
  PromptPattern,
  PromptVariable,
  PromptWarning,
  MAX_PROMPT_LENGTH,
} from './types.js';

// =============================================================================
// DETECTION PATTERNS
// =============================================================================

/**
 * Patterns for detecting AI API calls
 */
export const AI_CALL_PATTERNS: PromptPattern[] = [
  // Anthropic/Claude
  {
    name: 'anthropic-messages',
    provider: 'anthropic',
    patterns: [
      /anthropic\.messages\.create\s*\(/,
      /client\.messages\.create\s*\(/,
      /claude\.messages\.create\s*\(/,
      /Anthropic\s*\(\s*\)\.messages\.create/,
    ],
  },
  {
    name: 'anthropic-completions',
    provider: 'anthropic',
    patterns: [
      /anthropic\.completions\.create\s*\(/,
      /client\.completions\.create\s*\(/,
    ],
  },

  // OpenAI
  {
    name: 'openai-chat',
    provider: 'openai',
    patterns: [
      /openai\.chat\.completions\.create\s*\(/,
      /client\.chat\.completions\.create\s*\(/,
      /ChatCompletion\.create\s*\(/,
    ],
  },
  {
    name: 'openai-completions',
    provider: 'openai',
    patterns: [
      /openai\.completions\.create\s*\(/,
      /Completion\.create\s*\(/,
    ],
  },

  // Azure OpenAI
  {
    name: 'azure-openai',
    provider: 'azure',
    patterns: [
      /AzureOpenAI\s*\(/,
      /azure_endpoint/,
    ],
  },

  // Google AI
  {
    name: 'google-gemini',
    provider: 'google',
    patterns: [
      /genai\.GenerativeModel/,
      /model\.generate_content/,
      /gemini-pro/,
    ],
  },
];

/**
 * Patterns for detecting prompt definitions
 */
export const PROMPT_DEFINITION_PATTERNS = [
  // Message arrays
  /messages\s*[=:]\s*\[/,
  /messages\s*:\s*\[/,

  // System prompts
  /system_prompt\s*[=:]\s*[`'"]/i,
  /SYSTEM_PROMPT\s*[=:]\s*[`'"]/,
  /systemPrompt\s*[=:]\s*[`'"]/,

  // Generic prompt variables
  /(?:const|let|var)\s+(\w*[Pp]rompt\w*)\s*=\s*[`'"]/,
  /(?:const|let|var)\s+(\w*[Ii]nstruction\w*)\s*=\s*[`'"]/,

  // Python style
  /^(?:PROMPT|SYSTEM_PROMPT|USER_PROMPT)\s*=\s*(?:"""|\\'\\'\\'|")/m,
];

/**
 * Patterns for detecting template variables
 */
export const TEMPLATE_VARIABLE_PATTERNS = [
  // JavaScript template literals
  /\$\{(\w+)\}/g,

  // Jinja2 / Mustache
  /\{\{\s*(\w+)\s*\}\}/g,

  // Python f-strings (captured in context)
  /\{(\w+)\}/g,

  // Handlebars-style
  /\{\{\{\s*(\w+)\s*\}\}\}/g,
];

// =============================================================================
// DETECTOR CLASS
// =============================================================================

export interface DetectorOptions {
  maxPromptLength?: number;
  includeRawContent?: boolean;
  detectVariables?: boolean;
}

/**
 * Detects prompts in source files using regex patterns
 */
export class PromptDetector {
  private options: Required<DetectorOptions>;

  constructor(options: DetectorOptions = {}) {
    this.options = {
      maxPromptLength: options.maxPromptLength ?? MAX_PROMPT_LENGTH,
      includeRawContent: options.includeRawContent ?? true,
      detectVariables: options.detectVariables ?? true,
    };
  }

  /**
   * Scan a project for prompts
   */
  async scanProject(projectRoot: string): Promise<{
    prompts: DetectedPrompt[];
    warnings: PromptWarning[];
  }> {
    const prompts: DetectedPrompt[] = [];
    const warnings: PromptWarning[] = [];

    // Find source files
    const sourceFiles = await glob('**/*.{ts,tsx,js,jsx,py}', {
      cwd: projectRoot,
      ignore: [
        'node_modules/**',
        'dist/**',
        'build/**',
        '.next/**',
        '__pycache__/**',
        'venv/**',
        '.git/**',
        '*.min.js',
        '*.bundle.js',
      ],
    });

    for (const file of sourceFiles) {
      try {
        const filePath = path.join(projectRoot, file);
        const content = await fs.promises.readFile(filePath, 'utf-8');

        const filePrompts = this.detectInFile(file, content);
        prompts.push(...filePrompts);
      } catch (error) {
        warnings.push({
          type: 'parse_error',
          message: `Failed to read ${file}: ${error instanceof Error ? error.message : 'Unknown error'}`,
          file,
        });
      }
    }

    return { prompts, warnings };
  }

  /**
   * Detect prompts in a single file
   */
  detectInFile(filePath: string, content: string): DetectedPrompt[] {
    const prompts: DetectedPrompt[] = [];
    const lines = content.split('\n');

    // Track AI API calls to link prompts to providers
    const apiCalls = this.findAPICalls(content, lines);

    // Find prompt definitions
    const promptMatches = this.findPromptDefinitions(content, lines);

    for (const match of promptMatches) {
      const prompt = this.buildPromptFromMatch(filePath, lines, match, apiCalls);
      if (prompt) {
        prompts.push(prompt);
      }
    }

    return prompts;
  }

  /**
   * Find AI API calls in the file
   */
  private findAPICalls(
    content: string,
    lines: string[]
  ): Array<{ line: number; provider: string; pattern: string }> {
    const calls: Array<{ line: number; provider: string; pattern: string }> = [];

    for (const pattern of AI_CALL_PATTERNS) {
      for (const regex of pattern.patterns) {
        for (let i = 0; i < lines.length; i++) {
          if (regex.test(lines[i])) {
            calls.push({
              line: i + 1,
              provider: pattern.provider,
              pattern: pattern.name,
            });
          }
        }
      }
    }

    return calls;
  }

  /**
   * Find prompt definitions in content
   */
  private findPromptDefinitions(
    content: string,
    lines: string[]
  ): Array<{
    lineStart: number;
    lineEnd: number;
    type: 'messages' | 'string' | 'template';
    name?: string;
  }> {
    const matches: Array<{
      lineStart: number;
      lineEnd: number;
      type: 'messages' | 'string' | 'template';
      name?: string;
    }> = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Check for messages array
      if (/messages\s*[=:]\s*\[/.test(line)) {
        const endLine = this.findArrayEnd(lines, i);
        matches.push({
          lineStart: i + 1,
          lineEnd: endLine + 1,
          type: 'messages',
        });
        continue;
      }

      // Check for prompt variable definitions
      const varMatch = line.match(
        /(?:const|let|var)\s+(\w*[Pp]rompt\w*|\w*[Ii]nstruction\w*|SYSTEM_PROMPT|USER_PROMPT)\s*=\s*([`'"])/
      );
      if (varMatch) {
        const varName = varMatch[1];
        const quote = varMatch[2];
        const endLine = this.findStringEnd(lines, i, quote);

        matches.push({
          lineStart: i + 1,
          lineEnd: endLine + 1,
          type: quote === '`' ? 'template' : 'string',
          name: varName,
        });
        continue;
      }

      // Check for Python multi-line strings
      if (/^(?:PROMPT|SYSTEM_PROMPT|USER_PROMPT)\s*=\s*(?:"""|'''|f"""|f''')/.test(line)) {
        const varMatch = line.match(/^(\w+)\s*=/);
        const endLine = this.findPythonStringEnd(lines, i);

        matches.push({
          lineStart: i + 1,
          lineEnd: endLine + 1,
          type: 'template',
          name: varMatch?.[1],
        });
      }
    }

    return matches;
  }

  /**
   * Find the end of an array definition
   */
  private findArrayEnd(lines: string[], startLine: number): number {
    let depth = 0;
    let inString = false;
    let stringChar = '';

    for (let i = startLine; i < lines.length; i++) {
      const line = lines[i];

      for (let j = 0; j < line.length; j++) {
        const char = line[j];
        const prevChar = j > 0 ? line[j - 1] : '';

        // Handle string boundaries
        if ((char === '"' || char === "'" || char === '`') && prevChar !== '\\') {
          if (!inString) {
            inString = true;
            stringChar = char;
          } else if (char === stringChar) {
            inString = false;
          }
          continue;
        }

        if (inString) continue;

        if (char === '[' || char === '{') depth++;
        if (char === ']' || char === '}') depth--;

        if (depth === 0 && char === ']') {
          return i;
        }
      }
    }

    return Math.min(startLine + 50, lines.length - 1);
  }

  /**
   * Find the end of a string definition
   */
  private findStringEnd(lines: string[], startLine: number, quote: string): number {
    if (quote === '`') {
      // Template literal - find closing backtick
      for (let i = startLine; i < lines.length; i++) {
        const line = lines[i];
        const startIdx = i === startLine ? line.indexOf('`') + 1 : 0;

        for (let j = startIdx; j < line.length; j++) {
          if (line[j] === '`' && line[j - 1] !== '\\') {
            return i;
          }
        }
      }
    } else {
      // Single line string
      return startLine;
    }

    return startLine;
  }

  /**
   * Find the end of a Python multi-line string
   */
  private findPythonStringEnd(lines: string[], startLine: number): number {
    const line = lines[startLine];
    const tripleQuote = line.includes('"""') ? '"""' : "'''";

    // Check if it closes on the same line
    const firstIdx = line.indexOf(tripleQuote);
    const secondIdx = line.indexOf(tripleQuote, firstIdx + 3);
    if (secondIdx !== -1) {
      return startLine;
    }

    // Find closing triple quote
    for (let i = startLine + 1; i < lines.length; i++) {
      if (lines[i].includes(tripleQuote)) {
        return i;
      }
    }

    return Math.min(startLine + 50, lines.length - 1);
  }

  /**
   * Build a DetectedPrompt from a match
   */
  private buildPromptFromMatch(
    filePath: string,
    lines: string[],
    match: { lineStart: number; lineEnd: number; type: string; name?: string },
    apiCalls: Array<{ line: number; provider: string; pattern: string }>
  ): DetectedPrompt | null {
    const { lineStart, lineEnd, type, name } = match;

    // Extract content
    const contentLines = lines.slice(lineStart - 1, lineEnd);
    const rawContent = contentLines.join('\n');

    // Find containing function
    const functionName = this.findContainingFunction(lines, lineStart - 1);

    // Find nearest API call to determine provider
    const nearestCall = this.findNearestAPICall(apiCalls, lineStart);

    // Extract messages if it's a messages array
    const messages = type === 'messages'
      ? this.extractMessages(rawContent)
      : this.extractSingleMessage(rawContent);

    // Detect variables
    const variables = this.options.detectVariables
      ? this.detectVariables(rawContent)
      : [];

    // Determine purpose from comments and content
    const purpose = this.extractPurpose(lines, lineStart - 1, rawContent);

    // Generate ID
    const id = this.generatePromptId(filePath, lineStart, name);

    // Truncate content if needed
    const truncated = rawContent.length > this.options.maxPromptLength;
    const storedContent = truncated
      ? rawContent.slice(0, this.options.maxPromptLength)
      : rawContent;

    return {
      id,
      name: name || this.generatePromptName(filePath, functionName, lineStart),
      location: {
        file: filePath,
        lineStart,
        lineEnd,
        functionName,
      },
      messages,
      rawContent: this.options.includeRawContent ? storedContent : undefined,
      isTemplate: variables.length > 0,
      variables,
      templateSyntax: this.detectTemplateSyntax(rawContent),
      provider: nearestCall ? {
        provider: nearestCall.provider as any,
      } : undefined,
      usedBy: nearestCall ? [{
        file: filePath,
        line: nearestCall.line,
        functionName,
        callPattern: nearestCall.pattern,
        isAsync: true,
        hasStreaming: rawContent.includes('stream'),
      }] : [],
      purpose,
      tags: this.generateTags(rawContent, messages),
      category: this.detectCategory(rawContent, messages),
      confidence: this.calculateConfidence(messages, nearestCall),
      detectionMethod: 'regex',
      timestamp: Date.now(),
    };
  }

  /**
   * Extract messages from a messages array
   */
  private extractMessages(content: string): PromptMessage[] {
    const messages: PromptMessage[] = [];

    // Match message objects
    const messagePattern = /\{\s*role\s*:\s*['"](\w+)['"]\s*,\s*content\s*:\s*([`'"])([\s\S]*?)\2\s*\}/g;

    let match;
    while ((match = messagePattern.exec(content)) !== null) {
      const role = match[1] as PromptMessage['role'];
      let msgContent = match[3];

      // Truncate if too long
      const truncated = msgContent.length > this.options.maxPromptLength;
      if (truncated) {
        msgContent = msgContent.slice(0, this.options.maxPromptLength);
      }

      messages.push({
        role,
        content: msgContent,
        truncated,
        originalLength: truncated ? match[3].length : undefined,
      });
    }

    return messages;
  }

  /**
   * Extract a single message from string content
   */
  private extractSingleMessage(content: string): PromptMessage[] {
    // Extract the string content
    const stringMatch = content.match(/=\s*([`'"])([\s\S]*?)\1/);
    if (!stringMatch) return [];

    let msgContent = stringMatch[2];
    const truncated = msgContent.length > this.options.maxPromptLength;
    if (truncated) {
      msgContent = msgContent.slice(0, this.options.maxPromptLength);
    }

    // Determine role from variable name
    const isSystem = /system/i.test(content);

    return [{
      role: isSystem ? 'system' : 'user',
      content: msgContent,
      truncated,
      originalLength: truncated ? stringMatch[2].length : undefined,
    }];
  }

  /**
   * Detect template variables in content
   */
  private detectVariables(content: string): PromptVariable[] {
    const variables: PromptVariable[] = [];
    const seen = new Set<string>();

    for (const pattern of TEMPLATE_VARIABLE_PATTERNS) {
      let match;
      const regex = new RegExp(pattern.source, pattern.flags);

      while ((match = regex.exec(content)) !== null) {
        const name = match[1];
        if (!seen.has(name)) {
          seen.add(name);
          variables.push({
            name,
            pattern: match[0],
            type: 'unknown',
          });
        }
      }
    }

    return variables;
  }

  /**
   * Find the containing function for a line
   */
  private findContainingFunction(lines: string[], lineIndex: number): string | undefined {
    for (let i = lineIndex; i >= Math.max(0, lineIndex - 30); i--) {
      const line = lines[i];

      // JavaScript/TypeScript patterns
      const jsMatch = line.match(
        /(?:async\s+)?(?:function\s+)?(\w+)\s*(?:=\s*(?:async\s*)?\(|[\(:])/
      );
      if (jsMatch) return jsMatch[1];

      const arrowMatch = line.match(/(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\(/);
      if (arrowMatch) return arrowMatch[1];

      const methodMatch = line.match(/(?:async\s+)?(\w+)\s*\([^)]*\)\s*[:{]/);
      if (methodMatch) return methodMatch[1];

      // Python patterns
      const pyMatch = line.match(/(?:async\s+)?def\s+(\w+)\s*\(/);
      if (pyMatch) return pyMatch[1];
    }

    return undefined;
  }

  /**
   * Find nearest API call to a line
   */
  private findNearestAPICall(
    apiCalls: Array<{ line: number; provider: string; pattern: string }>,
    promptLine: number
  ): { line: number; provider: string; pattern: string } | undefined {
    let nearest: { line: number; provider: string; pattern: string } | undefined;
    let minDistance = Infinity;

    for (const call of apiCalls) {
      const distance = Math.abs(call.line - promptLine);
      // Prefer calls after the prompt (where it's used)
      const adjustedDistance = call.line >= promptLine ? distance : distance + 100;

      if (adjustedDistance < minDistance) {
        minDistance = adjustedDistance;
        nearest = call;
      }
    }

    // Only return if reasonably close (within 50 lines)
    return minDistance < 150 ? nearest : undefined;
  }

  /**
   * Extract purpose from comments near the prompt
   */
  private extractPurpose(lines: string[], lineIndex: number, content: string): string | undefined {
    // Look for comments above the prompt
    for (let i = lineIndex - 1; i >= Math.max(0, lineIndex - 5); i--) {
      const line = lines[i].trim();

      // JSDoc style
      if (line.startsWith('*') && !line.startsWith('*/')) {
        const comment = line.replace(/^\*\s*/, '').trim();
        if (comment && !comment.startsWith('@')) {
          return comment;
        }
      }

      // Single line comment
      if (line.startsWith('//') || line.startsWith('#')) {
        const comment = line.replace(/^[/#]+\s*/, '').trim();
        if (comment) {
          return comment;
        }
      }
    }

    // Try to extract from content itself
    if (content.includes('You are')) {
      const match = content.match(/You are (?:a |an )?([^.!?\n]{10,60})/);
      if (match) return `AI assistant: ${match[1]}`;
    }

    return undefined;
  }

  /**
   * Detect template syntax used
   */
  private detectTemplateSyntax(content: string): DetectedPrompt['templateSyntax'] {
    if (/\$\{/.test(content)) return 'template-literal';
    if (/\{\{[^{]/.test(content)) return 'jinja2';
    if (/\{\{\{/.test(content)) return 'mustache';
    if (/f['"]/.test(content) || /f"""/.test(content)) return 'fstring';
    if (/\{[a-zA-Z_]\w*\}/.test(content)) return 'fstring';
    return undefined;
  }

  /**
   * Generate tags from content
   */
  private generateTags(content: string, messages: PromptMessage[]): string[] {
    const tags: string[] = [];
    const lowerContent = content.toLowerCase();

    if (messages.some(m => m.role === 'system')) tags.push('has-system-prompt');
    if (lowerContent.includes('json')) tags.push('json-output');
    if (lowerContent.includes('step by step') || lowerContent.includes('step-by-step')) tags.push('chain-of-thought');
    if (lowerContent.includes('tool') || lowerContent.includes('function')) tags.push('tool-use');
    if (lowerContent.includes('example')) tags.push('few-shot');
    if (/\{[\w_]+\}/.test(content)) tags.push('templated');

    return tags;
  }

  /**
   * Detect prompt category
   */
  private detectCategory(content: string, messages: PromptMessage[]): DetectedPrompt['category'] {
    const lowerContent = content.toLowerCase();

    if (lowerContent.includes('summarize') || lowerContent.includes('summary')) return 'summarization';
    if (lowerContent.includes('extract') || lowerContent.includes('parse')) return 'extraction';
    if (lowerContent.includes('classify') || lowerContent.includes('categorize')) return 'classification';
    if (lowerContent.includes('translate')) return 'translation';
    if (lowerContent.includes('code') && (lowerContent.includes('write') || lowerContent.includes('generate'))) return 'code-generation';
    if (lowerContent.includes('review') && lowerContent.includes('code')) return 'code-review';
    if (lowerContent.includes('tool') || lowerContent.includes('function_call')) return 'agent';
    if (lowerContent.includes('embed')) return 'embedding';
    if (messages.length > 1 || lowerContent.includes('chat') || lowerContent.includes('conversation')) return 'chat';

    return 'unknown';
  }

  /**
   * Calculate detection confidence
   */
  private calculateConfidence(
    messages: PromptMessage[],
    apiCall?: { line: number; provider: string; pattern: string }
  ): number {
    let confidence = 0.5; // Base confidence

    if (messages.length > 0) confidence += 0.2;
    if (messages.some(m => m.role === 'system')) confidence += 0.1;
    if (apiCall) confidence += 0.2;

    return Math.min(confidence, 1.0);
  }

  /**
   * Generate a unique prompt ID
   */
  private generatePromptId(file: string, line: number, name?: string): string {
    const hash = Buffer.from(`${file}:${line}:${name || ''}`).toString('base64url').slice(0, 16);
    return `PROMPT_${hash}`;
  }

  /**
   * Generate a prompt name from context
   */
  private generatePromptName(file: string, functionName?: string, line?: number): string {
    const baseName = path.basename(file, path.extname(file));

    if (functionName) {
      return `${functionName}_prompt`;
    }

    return `${baseName}_L${line}_prompt`;
  }
}

/**
 * Create a default detector instance
 */
export function createDetector(options?: DetectorOptions): PromptDetector {
  return new PromptDetector(options);
}
