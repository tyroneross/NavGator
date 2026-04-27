/**
 * Prompt Detector
 *
 * Detects AI prompt patterns in source code using regex patterns.
 * For more accurate detection, use the AST-based extractor.
 */
import { DetectedPrompt, PromptPattern, PromptWarning } from './types.js';
/**
 * Patterns for detecting AI API calls
 */
export declare const AI_CALL_PATTERNS: PromptPattern[];
/**
 * Patterns for detecting prompt definitions
 */
export declare const PROMPT_DEFINITION_PATTERNS: RegExp[];
/**
 * Patterns for detecting template variables
 */
export declare const TEMPLATE_VARIABLE_PATTERNS: RegExp[];
export interface DetectorOptions {
    maxPromptLength?: number;
    includeRawContent?: boolean;
    detectVariables?: boolean;
    /** Only create prompts that have a nearby API call anchor (default: true) */
    requireAPICallAnchor?: boolean;
    /** Minimum corroborating signals to surface a prompt (default: 2) */
    minCorroborationSignals?: number;
    /** Lower thresholds for thorough prompt detection (used with --prompts flag) */
    aggressive?: boolean;
}
/**
 * Find the end of an array definition, starting from startLine.
 * The opening `[` on startLine is expected to be the first `[` encountered.
 * Returns the line index of the closing `]`, or startLine + 50 as a fallback.
 */
export declare function findArrayEnd(lines: string[], startLine: number): number;
/**
 * Detects prompts in source files using regex patterns
 */
export declare class PromptDetector {
    private options;
    constructor(options?: DetectorOptions);
    /**
     * Scan a project for prompts.
     *
     * `walkSet` (optional) restricts the set of project-relative files scanned
     * — used by incremental mode. Bit-identical to today when undefined.
     */
    scanProject(projectRoot: string, walkSet?: Set<string>): Promise<{
        prompts: DetectedPrompt[];
        warnings: PromptWarning[];
    }>;
    /**
     * Detect prompts in a single file
     */
    detectInFile(filePath: string, content: string): DetectedPrompt[];
    /**
     * Check if a file is in a UI/component directory (likely false positive)
     */
    private isUIFile;
    /**
     * Check if file imports any AI SDK
     */
    private hasAISDKImport;
    /**
     * Count corroboration signals for a prompt match
     */
    private countCorroborationSignals;
    /**
     * Find AI API calls in the file
     */
    private findAPICalls;
    /**
     * Find prompt definitions in content
     */
    private findPromptDefinitions;
    /**
     * Find the end of an array definition
     */
    private findArrayEnd;
    /**
     * Find the end of a string definition
     */
    private findStringEnd;
    /**
     * Find the end of a Python multi-line string
     */
    private findPythonStringEnd;
    /**
     * Build a DetectedPrompt from a match
     */
    private buildPromptFromMatch;
    /**
     * Extract messages from a messages array
     */
    private extractMessages;
    /**
     * Extract a single message from string content
     */
    private extractSingleMessage;
    /**
     * Detect template variables in content
     */
    private detectVariables;
    /**
     * Find the containing function for a line
     */
    private findContainingFunction;
    /**
     * Find nearest API call to a line
     */
    private findNearestAPICall;
    /**
     * Extract purpose from comments near the prompt
     */
    private extractPurpose;
    /**
     * Detect template syntax used
     */
    private detectTemplateSyntax;
    /**
     * Generate tags from content
     */
    private generateTags;
    /**
     * Detect prompt category
     */
    private detectCategory;
    /**
     * Calculate detection confidence
     */
    private calculateConfidence;
    /**
     * Generate a unique prompt ID
     */
    private generatePromptId;
    /**
     * Generate a prompt name from context
     */
    private generatePromptName;
}
/**
 * Create a default detector instance
 */
export declare function createDetector(options?: DetectorOptions): PromptDetector;
//# sourceMappingURL=detector.d.ts.map