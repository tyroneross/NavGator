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

import { PromptDetector, createDetector, DetectorOptions } from './detector.js';
import {
  DetectedPrompt,
  PromptMessage,
  PromptScanResult,
  PromptWarning,
  PromptCategory,
  PromptVariable,
} from './types.js';
import {
  ArchitectureComponent,
  ArchitectureConnection,
  ScanResult,
  generateComponentId,
  generateConnectionId,
} from '../../types.js';

// Re-export types
export * from './types.js';
export { PromptDetector, createDetector } from './detector.js';

// =============================================================================
// MAIN SCAN FUNCTION
// =============================================================================

/**
 * Scan a project for AI prompts
 */
export async function scanPrompts(
  projectRoot: string,
  options?: DetectorOptions
): Promise<PromptScanResult> {
  const detector = createDetector(options);
  const { prompts, warnings } = await detector.scanProject(projectRoot);

  // Build summary
  const summary = buildSummary(prompts);

  return {
    prompts,
    summary,
    warnings,
  };
}

/**
 * Build summary statistics from prompts
 */
function buildSummary(prompts: DetectedPrompt[]): PromptScanResult['summary'] {
  const byProvider: Record<string, number> = {};
  const byCategory: Record<string, number> = {};
  let templatesCount = 0;
  let withToolsCount = 0;

  for (const prompt of prompts) {
    // Count by provider
    const provider = prompt.provider?.provider || 'unknown';
    byProvider[provider] = (byProvider[provider] || 0) + 1;

    // Count by category
    const category = prompt.category || 'unknown';
    byCategory[category] = (byCategory[category] || 0) + 1;

    // Count templates
    if (prompt.isTemplate) templatesCount++;

    // Count tool-using prompts
    if (prompt.tags.includes('tool-use')) withToolsCount++;
  }

  return {
    totalPrompts: prompts.length,
    byProvider,
    byCategory,
    templatesCount,
    withToolsCount,
  };
}

// =============================================================================
// CONVERT TO ARCHITECTURE COMPONENTS/CONNECTIONS
// =============================================================================

/**
 * Convert detected prompts to NavGator components and connections
 * for integration with the main architecture graph
 */
export function convertToArchitecture(
  prompts: DetectedPrompt[]
): ScanResult {
  const components: ArchitectureComponent[] = [];
  const connections: ArchitectureConnection[] = [];
  const timestamp = Date.now();

  for (const prompt of prompts) {
    // Create component for the prompt
    const component: ArchitectureComponent = {
      component_id: generateComponentId('prompt', prompt.name),
      name: prompt.name,
      type: 'prompt',
      version: undefined,
      role: {
        purpose: prompt.purpose || `AI prompt (${prompt.category})`,
        layer: 'backend',
        critical: true,
      },
      source: {
        detection_method: 'auto',
        config_files: [prompt.location.file],
        confidence: prompt.confidence,
      },
      connects_to: [],
      connected_from: [],
      status: 'active',
      tags: [
        'prompt',
        prompt.category || 'unknown',
        ...(prompt.provider ? [prompt.provider.provider] : []),
        ...prompt.tags,
      ],
      timestamp,
      last_updated: timestamp,
      // Store rich prompt metadata
      metadata: {
        promptId: prompt.id,
        category: prompt.category,
        isTemplate: prompt.isTemplate,
        variables: prompt.variables.map(v => v.name),
        provider: prompt.provider?.provider,
        model: prompt.provider?.model,
        messageCount: prompt.messages.length,
        hasSystemPrompt: prompt.messages.some(m => m.role === 'system'),
        // Store first message content (truncated)
        systemPrompt: prompt.messages.find(m => m.role === 'system')?.content?.slice(0, 500),
        userTemplate: prompt.messages.find(m => m.role === 'user')?.content?.slice(0, 500),
      },
    };
    components.push(component);

    // Create connection showing where prompt is defined
    const locationConnection: ArchitectureConnection = {
      connection_id: generateConnectionId('prompt-location'),
      from: {
        component_id: component.component_id,
        location: {
          file: prompt.location.file,
          line: prompt.location.lineStart,
          function: prompt.location.functionName,
        },
      },
      to: {
        component_id: component.component_id,
      },
      connection_type: 'prompt-location',
      code_reference: {
        file: prompt.location.file,
        symbol: prompt.location.functionName || prompt.name,
        symbol_type: prompt.location.functionName ? 'function' : 'variable',
        line_start: prompt.location.lineStart,
        line_end: prompt.location.lineEnd,
        code_snippet: prompt.rawContent?.slice(0, 200),
      },
      description: `Prompt defined: ${prompt.name}`,
      detected_from: 'Prompt scanner',
      confidence: prompt.confidence,
      timestamp,
      last_verified: timestamp,
    };
    connections.push(locationConnection);

    // Create connections for each usage
    for (const usage of prompt.usedBy) {
      const usageConnection: ArchitectureConnection = {
        connection_id: generateConnectionId('prompt-usage'),
        from: {
          component_id: `FILE:${usage.file}`,
          location: {
            file: usage.file,
            line: usage.line,
            function: usage.functionName,
          },
        },
        to: {
          component_id: component.component_id,
        },
        connection_type: 'service-call',
        code_reference: {
          file: usage.file,
          symbol: usage.functionName || `line_${usage.line}`,
          symbol_type: 'function',
          line_start: usage.line,
          code_snippet: usage.callPattern,
        },
        description: `Calls AI (${prompt.provider?.provider || 'unknown'}) with ${prompt.name}`,
        detected_from: 'Prompt usage detection',
        confidence: prompt.confidence,
        timestamp,
        last_verified: timestamp,
      };
      connections.push(usageConnection);
    }
  }

  return {
    components,
    connections,
    warnings: [],
  };
}

// =============================================================================
// FORMATTED OUTPUT
// =============================================================================

/**
 * Format prompts for CLI output
 */
export function formatPromptsOutput(result: PromptScanResult): string {
  const lines: string[] = [];

  lines.push('');
  lines.push('AI PROMPTS DETECTED');
  lines.push('='.repeat(60));
  lines.push('');

  if (result.prompts.length === 0) {
    lines.push('No AI prompts detected.');
    return lines.join('\n');
  }

  // Summary
  lines.push(`Total prompts: ${result.summary.totalPrompts}`);
  lines.push(`Templates: ${result.summary.templatesCount}`);
  lines.push(`With tools: ${result.summary.withToolsCount}`);
  lines.push('');

  // By provider
  lines.push('By Provider:');
  for (const [provider, count] of Object.entries(result.summary.byProvider)) {
    lines.push(`  ${provider}: ${count}`);
  }
  lines.push('');

  // By category
  lines.push('By Category:');
  for (const [category, count] of Object.entries(result.summary.byCategory)) {
    lines.push(`  ${category}: ${count}`);
  }
  lines.push('');

  // Individual prompts
  lines.push('-'.repeat(60));

  for (const prompt of result.prompts) {
    lines.push('');
    lines.push(`PROMPT: ${prompt.name}`);
    lines.push(`  File: ${prompt.location.file}:${prompt.location.lineStart}-${prompt.location.lineEnd}`);

    if (prompt.location.functionName) {
      lines.push(`  Function: ${prompt.location.functionName}`);
    }

    lines.push(`  Provider: ${prompt.provider?.provider || 'unknown'}`);
    lines.push(`  Category: ${prompt.category}`);

    if (prompt.purpose) {
      lines.push(`  Purpose: ${prompt.purpose}`);
    }

    if (prompt.isTemplate && prompt.variables.length > 0) {
      lines.push(`  Variables: ${prompt.variables.map(v => v.name).join(', ')}`);
    }

    if (prompt.tags.length > 0) {
      lines.push(`  Tags: ${prompt.tags.join(', ')}`);
    }

    // Show message preview
    const systemMsg = prompt.messages.find(m => m.role === 'system');
    if (systemMsg) {
      const preview = systemMsg.content.slice(0, 100).replace(/\n/g, ' ');
      lines.push(`  System: "${preview}${systemMsg.content.length > 100 ? '...' : ''}"`);
    }

    const userMsg = prompt.messages.find(m => m.role === 'user');
    if (userMsg) {
      const preview = userMsg.content.slice(0, 100).replace(/\n/g, ' ');
      lines.push(`  User: "${preview}${userMsg.content.length > 100 ? '...' : ''}"`);
    }

    lines.push(`  Confidence: ${(prompt.confidence * 100).toFixed(0)}%`);
  }

  return lines.join('\n');
}

/**
 * Format a single prompt for detailed view
 */
export function formatPromptDetail(prompt: DetectedPrompt): string {
  const lines: string[] = [];

  lines.push('');
  lines.push(`PROMPT: ${prompt.name}`);
  lines.push('='.repeat(60));
  lines.push('');

  lines.push(`ID: ${prompt.id}`);
  lines.push(`File: ${prompt.location.file}`);
  lines.push(`Lines: ${prompt.location.lineStart}-${prompt.location.lineEnd}`);

  if (prompt.location.functionName) {
    lines.push(`Function: ${prompt.location.functionName}`);
  }
  if (prompt.location.className) {
    lines.push(`Class: ${prompt.location.className}`);
  }

  lines.push('');
  lines.push('METADATA');
  lines.push('-'.repeat(40));
  lines.push(`Provider: ${prompt.provider?.provider || 'unknown'}`);
  if (prompt.provider?.model) {
    lines.push(`Model: ${prompt.provider.model}`);
  }
  lines.push(`Category: ${prompt.category}`);
  lines.push(`Is Template: ${prompt.isTemplate}`);
  if (prompt.templateSyntax) {
    lines.push(`Template Syntax: ${prompt.templateSyntax}`);
  }
  if (prompt.purpose) {
    lines.push(`Purpose: ${prompt.purpose}`);
  }
  lines.push(`Confidence: ${(prompt.confidence * 100).toFixed(0)}%`);
  lines.push(`Tags: ${prompt.tags.join(', ') || 'none'}`);

  if (prompt.variables.length > 0) {
    lines.push('');
    lines.push('VARIABLES');
    lines.push('-'.repeat(40));
    for (const variable of prompt.variables) {
      lines.push(`  ${variable.name} (${variable.pattern})`);
    }
  }

  lines.push('');
  lines.push('MESSAGES');
  lines.push('-'.repeat(40));

  for (const msg of prompt.messages) {
    lines.push('');
    lines.push(`[${msg.role.toUpperCase()}]`);
    lines.push(msg.content);
    if (msg.truncated) {
      lines.push(`... (truncated, original length: ${msg.originalLength})`);
    }
  }

  if (prompt.usedBy.length > 0) {
    lines.push('');
    lines.push('USAGE LOCATIONS');
    lines.push('-'.repeat(40));
    for (const usage of prompt.usedBy) {
      lines.push(`  ${usage.file}:${usage.line}`);
      lines.push(`    Call: ${usage.callPattern}`);
      if (usage.functionName) {
        lines.push(`    Function: ${usage.functionName}`);
      }
    }
  }

  return lines.join('\n');
}
