/**
 * Service Call Scanner
 * Detects connections to external services (Stripe, OpenAI, Claude, etc.)
 */

import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';
import {
  ArchitectureConnection,
  ArchitectureComponent,
  generateConnectionId,
  generateComponentId,
  ScanResult,
  CodeLocation,
} from '../../types.js';

// =============================================================================
// SERVICE DETECTION PATTERNS
// =============================================================================

interface ServicePattern {
  serviceName: string;
  patterns: RegExp[];
  componentType: 'service' | 'database' | 'queue';
  layer: 'external' | 'database' | 'queue';
  purpose: string;
}

const SERVICE_PATTERNS: ServicePattern[] = [
  // AI Services
  {
    serviceName: 'Claude (Anthropic)',
    patterns: [
      /anthropic\.messages\.create/,
      /anthropic\.completions\.create/,
      /new Anthropic\(/,
      /from anthropic import/,
    ],
    componentType: 'service',
    layer: 'external',
    purpose: 'Claude AI API',
  },
  {
    serviceName: 'OpenAI',
    patterns: [
      /openai\.chat\.completions\.create/,
      /openai\.completions\.create/,
      /new OpenAI\(/,
      /from openai import/,
      /OpenAIApi\(/,
    ],
    componentType: 'service',
    layer: 'external',
    purpose: 'OpenAI API',
  },

  // Payment Services
  {
    serviceName: 'Stripe',
    patterns: [
      /stripe\.customers\./,
      /stripe\.paymentIntents\./,
      /stripe\.subscriptions\./,
      /stripe\.invoices\./,
      /stripe\.checkout\./,
      /new Stripe\(/,
    ],
    componentType: 'service',
    layer: 'external',
    purpose: 'Stripe payments',
  },

  // Database Services
  {
    serviceName: 'Supabase',
    patterns: [
      /supabase\.from\(/,
      /createClient\(\s*process\.env\.SUPABASE/,
      /supabase\.auth\./,
      /supabase\.storage\./,
    ],
    componentType: 'database',
    layer: 'database',
    purpose: 'Supabase backend',
  },
  {
    serviceName: 'Firebase',
    patterns: [
      /firebase\.firestore\(/,
      /firebase\.auth\(/,
      /initializeApp\(/,
      /getFirestore\(/,
    ],
    componentType: 'database',
    layer: 'database',
    purpose: 'Firebase backend',
  },

  // Queue Services
  {
    serviceName: 'BullMQ',
    patterns: [
      /new Queue\(/,
      /new Worker\(/,
      /Queue\.add\(/,
      /from 'bullmq'/,
    ],
    componentType: 'queue',
    layer: 'queue',
    purpose: 'BullMQ job queue',
  },
  {
    serviceName: 'Celery',
    patterns: [
      /@celery\.task/,
      /celery\.send_task/,
      /delay\(\)/,
      /apply_async\(/,
    ],
    componentType: 'queue',
    layer: 'queue',
    purpose: 'Celery task queue',
  },

  // Communication Services
  {
    serviceName: 'Twilio',
    patterns: [
      /twilio\.messages\.create/,
      /new Twilio\(/,
      /twilio\.calls\./,
    ],
    componentType: 'service',
    layer: 'external',
    purpose: 'Twilio SMS/Voice',
  },
  {
    serviceName: 'SendGrid',
    patterns: [
      /sgMail\.send/,
      /@sendgrid\/mail/,
      /sendgrid\.send/,
    ],
    componentType: 'service',
    layer: 'external',
    purpose: 'SendGrid email',
  },

  // Cloud Storage
  {
    serviceName: 'AWS S3',
    patterns: [
      /s3\.putObject/,
      /s3\.getObject/,
      /S3Client\(/,
      /PutObjectCommand/,
    ],
    componentType: 'service',
    layer: 'external',
    purpose: 'AWS S3 storage',
  },
];

// =============================================================================
// SCANNING
// =============================================================================

/**
 * Scan for service calls in the codebase
 */
export async function scanServiceCalls(projectRoot: string): Promise<ScanResult> {
  const components: ArchitectureComponent[] = [];
  const connections: ArchitectureConnection[] = [];
  const timestamp = Date.now();

  // Find all source files
  const sourceFiles = await glob('**/*.{ts,tsx,js,jsx,py}', {
    cwd: projectRoot,
    ignore: ['node_modules/**', 'dist/**', 'build/**', '.next/**', '__pycache__/**', 'venv/**'],
  });

  // Track which services we've found
  const foundServices = new Map<string, ArchitectureComponent>();

  for (const file of sourceFiles) {
    const filePath = path.join(projectRoot, file);

    // Skip if not a file (could be a directory matching the glob pattern)
    try {
      const stat = await fs.promises.stat(filePath);
      if (!stat.isFile()) continue;
    } catch {
      continue; // Skip if we can't stat the file
    }

    let content: string;
    try {
      content = await fs.promises.readFile(filePath, 'utf-8');
    } catch {
      continue; // Skip files we can't read
    }
    const lines = content.split('\n');

    for (const pattern of SERVICE_PATTERNS) {
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        for (const regex of pattern.patterns) {
          if (regex.test(line)) {
            // Create service component if not exists
            if (!foundServices.has(pattern.serviceName)) {
              const component: ArchitectureComponent = {
                component_id: generateComponentId(pattern.componentType, pattern.serviceName),
                name: pattern.serviceName,
                type: pattern.componentType,
                role: {
                  purpose: pattern.purpose,
                  layer: pattern.layer,
                  critical: true,
                },
                source: {
                  detection_method: 'auto',
                  config_files: [],
                  confidence: 0.9,
                },
                connects_to: [],
                connected_from: [],
                status: 'active',
                tags: [pattern.componentType, pattern.layer],
                timestamp,
                last_updated: timestamp,
              };
              foundServices.set(pattern.serviceName, component);
              components.push(component);
            }

            // Create connection
            const serviceComponent = foundServices.get(pattern.serviceName)!;
            const functionName = extractFunctionName(lines, i);

            const connection: ArchitectureConnection = {
              connection_id: generateConnectionId('service-call'),
              from: {
                component_id: `FILE:${file}`,
                location: {
                  file,
                  line: i + 1,
                  function: functionName,
                },
              },
              to: {
                component_id: serviceComponent.component_id,
              },
              connection_type: 'service-call',
              code_reference: {
                file,
                symbol: functionName || `anonymous_${i + 1}`,
                symbol_type: functionName ? 'function' : undefined,
                line_start: i + 1,
                code_snippet: line.trim().slice(0, 100),
              },
              description: `Calls ${pattern.serviceName}`,
              detected_from: `Pattern: ${regex.source}`,
              confidence: 0.85,
              timestamp,
              last_verified: timestamp,
            };
            connections.push(connection);

            break; // Only match once per line per pattern
          }
        }
      }
    }
  }

  return { components, connections, warnings: [] };
}

/**
 * Extract function name from surrounding context
 */
function extractFunctionName(lines: string[], lineIndex: number): string | undefined {
  // Look backwards for function definition
  for (let i = lineIndex; i >= Math.max(0, lineIndex - 20); i--) {
    const line = lines[i];

    // JavaScript/TypeScript function patterns
    const jsMatch = line.match(
      /(?:async\s+)?(?:function\s+)?(\w+)\s*(?:=\s*(?:async\s*)?\(|[\(:])/
    );
    if (jsMatch) return jsMatch[1];

    // Arrow function assignment
    const arrowMatch = line.match(/(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\(/);
    if (arrowMatch) return arrowMatch[1];

    // Method definition
    const methodMatch = line.match(/(?:async\s+)?(\w+)\s*\([^)]*\)\s*[:{]/);
    if (methodMatch) return methodMatch[1];

    // Python function
    const pyMatch = line.match(/(?:async\s+)?def\s+(\w+)\s*\(/);
    if (pyMatch) return pyMatch[1];
  }

  return undefined;
}

/**
 * Specifically scan for AI prompt locations
 */
export async function scanPromptLocations(projectRoot: string): Promise<ScanResult> {
  const components: ArchitectureComponent[] = [];
  const connections: ArchitectureConnection[] = [];
  const timestamp = Date.now();

  // Patterns that indicate a prompt definition
  const promptPatterns = [
    /messages:\s*\[\s*\{[^}]*role:\s*['"](?:system|user|assistant)['"]/s,
    /prompt\s*[:=]\s*[`'"]/,
    /system_prompt\s*[:=]\s*[`'"]/,
    /SYSTEM_PROMPT\s*[:=]\s*[`'"]/,
    /content:\s*[`'"][^`'"]{50,}/,
  ];

  const sourceFiles = await glob('**/*.{ts,tsx,js,jsx,py}', {
    cwd: projectRoot,
    ignore: ['node_modules/**', 'dist/**', 'build/**', '.next/**', '__pycache__/**', 'venv/**'],
  });

  for (const file of sourceFiles) {
    const filePath = path.join(projectRoot, file);

    // Skip if not a file (could be a directory matching the glob pattern)
    try {
      const stat = await fs.promises.stat(filePath);
      if (!stat.isFile()) continue;
    } catch {
      continue; // Skip if we can't stat the file
    }

    let content: string;
    try {
      content = await fs.promises.readFile(filePath, 'utf-8');
    } catch {
      continue; // Skip files we can't read
    }
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const context = lines.slice(Math.max(0, i - 2), i + 3).join('\n');

      for (const pattern of promptPatterns) {
        if (pattern.test(context)) {
          const functionName = extractFunctionName(lines, i);
          const promptName = extractPromptName(lines, i, file);

          // Create prompt component
          const component: ArchitectureComponent = {
            component_id: generateComponentId('prompt', promptName),
            name: promptName,
            type: 'prompt',
            role: {
              purpose: 'AI prompt definition',
              layer: 'backend',
              critical: true,
            },
            source: {
              detection_method: 'auto',
              config_files: [file],
              confidence: 0.8,
            },
            connects_to: [],
            connected_from: [],
            status: 'active',
            tags: ['prompt', 'ai'],
            timestamp,
            last_updated: timestamp,
          };
          components.push(component);

          // Create connection showing where prompt is defined
          const connection: ArchitectureConnection = {
            connection_id: generateConnectionId('prompt-location'),
            from: {
              component_id: component.component_id,
              location: {
                file,
                line: i + 1,
                function: functionName,
              },
            },
            to: {
              component_id: component.component_id,
            },
            connection_type: 'prompt-location',
            code_reference: {
              file,
              symbol: promptName,
              symbol_type: 'variable',
              line_start: i + 1,
              code_snippet: line.trim().slice(0, 100),
            },
            description: `Prompt defined: ${promptName}`,
            detected_from: 'Prompt pattern detection',
            confidence: 0.75,
            timestamp,
            last_verified: timestamp,
          };
          connections.push(connection);

          break;
        }
      }
    }
  }

  return { components, connections, warnings: [] };
}

/**
 * Extract a meaningful prompt name from context
 */
function extractPromptName(lines: string[], lineIndex: number, file: string): string {
  // Look for variable assignment
  for (let i = lineIndex; i >= Math.max(0, lineIndex - 5); i--) {
    const line = lines[i];

    // Variable names like SYSTEM_PROMPT, summarizePrompt, etc.
    const varMatch = line.match(/(?:const|let|var|PROMPT|prompt)\s*[:=]\s*(\w*[Pp]rompt\w*)/i);
    if (varMatch) return varMatch[1];

    // Function names
    const funcMatch = line.match(/(?:function|def|async)\s+(\w+)/);
    if (funcMatch) return `${funcMatch[1]}_prompt`;
  }

  // Fallback to file-based name
  const baseName = path.basename(file, path.extname(file));
  return `${baseName}_prompt_L${lineIndex + 1}`;
}
