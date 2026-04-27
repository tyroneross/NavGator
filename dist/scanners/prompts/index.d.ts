/**
 * Prompt Scanner
 *
 * Comprehensive AI prompt detection and tracking for codebases.
 * Tracks prompt locations, content, purpose, and which AI services they're sent to.
 *
 * Features:
 * - Full prompt content extraction (up to 2000 chars)
 * - Template variable detection
 * - AI provider linkage (Claude, OpenAI, etc.)
 * - Purpose inference from comments and content
 * - Category classification
 *
 * @example
 * ```typescript
 * import { scanPrompts } from './scanners/prompts';
 *
 * const result = await scanPrompts('/path/to/project');
 * console.log(`Found ${result.prompts.length} prompts`);
 *
 * for (const prompt of result.prompts) {
 *   console.log(`${prompt.name} (${prompt.category})`);
 *   console.log(`  File: ${prompt.location.file}:${prompt.location.lineStart}`);
 *   console.log(`  Provider: ${prompt.provider?.provider || 'unknown'}`);
 *   console.log(`  Purpose: ${prompt.purpose || 'not detected'}`);
 * }
 * ```
 */
import { DetectorOptions } from './detector.js';
import { DetectedPrompt, PromptScanResult } from './types.js';
import { ScanResult } from '../../types.js';
export * from './types.js';
export { PromptDetector, createDetector } from './detector.js';
/**
 * Scan a project for AI prompts
 */
export declare function scanPrompts(projectRoot: string, options?: DetectorOptions, walkSet?: Set<string>): Promise<PromptScanResult>;
/**
 * Convert detected prompts to NavGator components and connections
 * for integration with the main architecture graph
 */
export declare function convertToArchitecture(prompts: DetectedPrompt[]): ScanResult;
/**
 * Format prompts for CLI output
 */
export declare function formatPromptsOutput(result: PromptScanResult): string;
/**
 * Format a single prompt for detailed view
 */
export declare function formatPromptDetail(prompt: DetectedPrompt): string;
//# sourceMappingURL=index.d.ts.map