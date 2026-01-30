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
  componentType: 'service' | 'database' | 'queue' | 'llm';
  layer: 'external' | 'database' | 'queue';
  purpose: string;
}

const SERVICE_PATTERNS: ServicePattern[] = [
  // AI/LLM Services - These get their own 'llm' type for visibility
  {
    serviceName: 'Claude (Anthropic)',
    patterns: [
      /anthropic\.messages\.create/,
      /anthropic\.completions\.create/,
      /new Anthropic\(/,
      /from anthropic import/,
      /AnthropicAI/,
      /import\s+Anthropic\s+from\s+['"]@anthropic-ai\/sdk['"]/,
      /require\(['"]@anthropic-ai\/sdk['"]\)/,
      /ChatAnthropic\(/,
    ],
    componentType: 'llm',
    layer: 'external',
    purpose: 'Claude AI API',
  },
  {
    serviceName: 'OpenAI',
    patterns: [
      /openai\.chat\.completions\.create/,
      /openai\.completions\.create/,
      /openai\.embeddings\.create/,
      /new OpenAI\(/,
      /from openai import/,
      /OpenAIApi\(/,
      /import\s+OpenAI\s+from\s+['"]openai['"]/,
      /require\(['"]openai['"]\)/,
      /ChatOpenAI\(/,
      /wrapOpenAI\(/,
    ],
    componentType: 'llm',
    layer: 'external',
    purpose: 'OpenAI API',
  },
  {
    serviceName: 'Groq',
    patterns: [
      /new Groq\(/,
      /groq\.chat\.completions\.create/,
      /from groq import/,
      /import\s+Groq\s+from\s+['"]groq-sdk['"]/,
      /require\(['"]groq-sdk['"]\)/,
      /ChatGroq\(/,
      /from\s+['"]@langchain\/groq['"]/,
    ],
    componentType: 'llm',
    layer: 'external',
    purpose: 'Groq LLM API',
  },
  {
    serviceName: 'Cohere',
    patterns: [
      /new Cohere\(/,
      /cohere\.generate/,
      /cohere\.chat/,
      /from cohere import/,
    ],
    componentType: 'llm',
    layer: 'external',
    purpose: 'Cohere API',
  },
  {
    serviceName: 'Gemini (Google)',
    patterns: [
      /GenerativeModel\(/,
      /gemini-pro/,
      /from google\.generativeai/,
      /ChatGoogleGenerativeAI\(/,
      /from\s+['"]@langchain\/google-genai['"]/,
    ],
    componentType: 'llm',
    layer: 'external',
    purpose: 'Google Gemini API',
  },
  {
    serviceName: 'Vercel AI SDK',
    patterns: [
      /from\s+['"]ai['"]/,
      /from\s+['"]@ai-sdk\//,
      /import\s+\{[^}]*generateText[^}]*\}/,
      /import\s+\{[^}]*streamText[^}]*\}/,
      /import\s+\{[^}]*generateObject[^}]*\}/,
      /import\s+\{[^}]*useChat[^}]*\}/,
      /import\s+\{[^}]*useCompletion[^}]*\}/,
    ],
    componentType: 'llm',
    layer: 'external',
    purpose: 'Vercel AI SDK',
  },
  {
    serviceName: 'LangChain',
    patterns: [
      /from\s+['"]langchain/,
      /from\s+['"]@langchain\//,
      /require\(['"]langchain/,
      /require\(['"]@langchain\//,
      /ChatPromptTemplate\./,
      /StructuredOutputParser\./,
      /RunnableSequence\./,
    ],
    componentType: 'llm',
    layer: 'external',
    purpose: 'LangChain framework',
  },
  {
    serviceName: 'LangSmith',
    patterns: [
      /from\s+['"]langsmith/,
      /require\(['"]langsmith/,
      /traceable\(/,
      /LANGCHAIN_TRACING/,
    ],
    componentType: 'llm',
    layer: 'external',
    purpose: 'LangSmith observability',
  },
  {
    serviceName: 'Mistral',
    patterns: [
      /new MistralClient\(/,
      /import\s+.*from\s+['"]@mistralai/,
      /from mistralai import/,
    ],
    componentType: 'llm',
    layer: 'external',
    purpose: 'Mistral AI API',
  },
  {
    serviceName: 'Replicate',
    patterns: [
      /new Replicate\(/,
      /import\s+Replicate\s+from\s+['"]replicate['"]/,
      /replicate\.run\(/,
    ],
    componentType: 'llm',
    layer: 'external',
    purpose: 'Replicate API',
  },
  {
    serviceName: 'HuggingFace',
    patterns: [
      /HfInference\(/,
      /from\s+['"]@huggingface\/inference['"]/,
      /huggingface\.co\/api/,
    ],
    componentType: 'llm',
    layer: 'external',
    purpose: 'HuggingFace Inference API',
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
// FALSE POSITIVE DETECTION
// =============================================================================

// =============================================================================
// ACCURACY GUARDRAILS
// =============================================================================
//
// Strategy: Context-aware confidence scoring instead of LLM post-processing.
// Inspired by ZeroFalse (arxiv:2510.02534) approach of enriching static analysis
// with flow-sensitive context, but without the LLM dependency.
//
// Three layers:
//   1. Line-level: Is the match in a comment, string literal, or example code?
//   2. File-level: Is this a test, mock, docs, or generated file?
//   3. Corroboration: Does an import/require for this service exist in the file?
//
// Each layer adjusts confidence. Only results >= 0.5 confidence are surfaced.
// =============================================================================

const MIN_CONFIDENCE = 0.5;

/**
 * Check if a match is inside a comment
 */
function isInComment(line: string, matchIndex: number): boolean {
  const trimmed = line.trimStart();
  // Single-line comment (JS/TS/Python)
  if (trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('*')) {
    return true;
  }
  // Inline comment: check if // appears before the match
  const commentStart = line.indexOf('//');
  if (commentStart >= 0 && commentStart < matchIndex) {
    return true;
  }
  return false;
}

/**
 * Check if a match is inside a string literal (not actual code)
 */
function isInStringLiteral(line: string, matchStart: number): boolean {
  // Count unescaped quotes before the match position
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < matchStart && i < line.length; i++) {
    const c = line[i];
    const prev = i > 0 ? line[i - 1] : '';
    if (c === "'" && prev !== '\\' && !inDouble) inSingle = !inSingle;
    if (c === '"' && prev !== '\\' && !inSingle) inDouble = !inDouble;
  }
  return inSingle || inDouble;
}

/**
 * Check if a line is example/mock code (string literal containing code)
 */
function isExampleCode(line: string): boolean {
  const examplePatterns = [
    /code:\s*["'`].*["'`]/,
    /example:\s*["'`]/,
    /snippet:\s*["'`]/,
    /sample:\s*["'`]/,
    /mock:\s*["'`]/,
    /["'`]await\s+\w+\.\w+\.\w+\([^)]*\)["'`]/,
    /["'`][^"'`]*\.\.\.[^"'`]*["'`]/,
  ];
  return examplePatterns.some(pattern => pattern.test(line));
}

/**
 * Check if a file should be excluded from scanning
 */
function shouldExcludeFile(file: string, projectRoot: string): boolean {
  const excludePatterns = [
    /NavGator\/src\//,
    /NavGator\/web\//,
    /\/__tests__\//,
    /\/test\//,
    /\/tests\//,
    /\/mocks?\//,
    /\/fixtures?\//,
    /\.test\.(ts|tsx|js|jsx)$/,
    /\.spec\.(ts|tsx|js|jsx)$/,
    /\.mock\.(ts|tsx|js|jsx)$/,
  ];

  const fullPath = path.join(projectRoot, file);
  return excludePatterns.some(pattern => pattern.test(fullPath) || pattern.test(file));
}

/**
 * Check if a file is documentation, config, or generated code (lower confidence)
 */
function getFileConfidenceModifier(file: string): number {
  // Documentation / non-code files — lower confidence
  if (/\.(md|mdx|txt|rst|adoc)$/.test(file)) return -0.4;
  if (/README|CHANGELOG|LICENSE/i.test(file)) return -0.4;
  // Generated / compiled
  if (/\.(d\.ts|map|min\.js)$/.test(file)) return -0.3;
  if (/\/dist\/|\/build\/|\/generated\//.test(file)) return -0.3;
  // Config files — sometimes legitimate (e.g., docker-compose)
  if (/\.(json|ya?ml|toml|ini)$/.test(file)) return -0.1;
  return 0;
}

/**
 * Check if the file contains a corroborating import/require for a service.
 * An import + a call site = high confidence. A call site without import = suspicious.
 */
function hasCorroboratingImport(fileContent: string, serviceName: string): boolean {
  const importPatterns: Record<string, RegExp[]> = {
    'Claude (Anthropic)': [/@anthropic-ai\/sdk/, /anthropic/],
    'OpenAI': [/['"]openai['"]/, /@langchain\/openai/],
    'Groq': [/groq-sdk/, /@langchain\/groq/],
    'Stripe': [/['"]stripe['"]/],
    'Supabase': [/@supabase\/supabase-js/],
    'Firebase': [/firebase\//],
    'BullMQ': [/['"]bullmq['"]/],
    'Twilio': [/['"]twilio['"]/],
    'SendGrid': [/@sendgrid\//],
    'AWS S3': [/@aws-sdk\/client-s3/],
    'Vercel AI SDK': [/['"]ai['"]/, /@ai-sdk\//],
    'LangChain': [/langchain/, /@langchain\//],
    'LangSmith': [/langsmith/],
    'Cohere': [/['"]cohere['"]/],
    'Gemini (Google)': [/google\.generativeai/, /@langchain\/google/],
    'Mistral': [/@mistralai/],
    'Replicate': [/['"]replicate['"]/],
    'HuggingFace': [/@huggingface\//],
  };

  const patterns = importPatterns[serviceName];
  if (!patterns) return true; // No import check available, don't penalize

  return patterns.some(p => p.test(fileContent));
}

/**
 * Compute final confidence for a match, applying all guardrail layers.
 * Returns 0 if the match should be discarded entirely.
 */
function computeConfidence(
  line: string,
  matchIndex: number,
  file: string,
  fileContent: string,
  serviceName: string,
  baseConfidence: number = 0.9,
): number {
  let confidence = baseConfidence;

  // Layer 1: Line-level checks
  if (isInComment(line, matchIndex)) return 0;
  if (isExampleCode(line)) return 0;
  if (isInStringLiteral(line, matchIndex)) {
    confidence -= 0.3;
  }

  // Layer 2: File-level checks
  confidence += getFileConfidenceModifier(file);

  // Layer 3: Corroboration — does the file import this service?
  if (!hasCorroboratingImport(fileContent, serviceName)) {
    confidence -= 0.2;
  }

  return Math.max(0, Math.min(1, confidence));
}

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
    ignore: [
      'node_modules/**',
      'dist/**',
      'build/**',
      '.next/**',
      '__pycache__/**',
      'venv/**',
      '**/node_modules/**',
      '**/.git/**',
    ],
  });

  // Track which services we've found
  const foundServices = new Map<string, ArchitectureComponent>();

  for (const file of sourceFiles) {
    // Skip files that should be excluded (NavGator's own code, test files, etc.)
    if (shouldExcludeFile(file, projectRoot)) {
      continue;
    }

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
          const match = regex.exec(line);
          if (match) {
            // Compute confidence with all guardrail layers
            const confidence = computeConfidence(
              line,
              match.index,
              file,
              content,
              pattern.serviceName,
            );

            // Skip low-confidence matches
            if (confidence < MIN_CONFIDENCE) {
              continue;
            }

            // Create service component if not exists (use highest confidence seen)
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
                  confidence,
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
            } else {
              // Update confidence if this match is higher
              const existing = foundServices.get(pattern.serviceName)!;
              if (confidence > existing.source.confidence) {
                existing.source.confidence = confidence;
              }
            }

            // Create connection with computed confidence
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
              confidence,
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
    ignore: [
      'node_modules/**',
      'dist/**',
      'build/**',
      '.next/**',
      '__pycache__/**',
      'venv/**',
      '**/node_modules/**',
      '**/.git/**',
    ],
  });

  for (const file of sourceFiles) {
    // Skip files that should be excluded (NavGator's own code, test files, etc.)
    if (shouldExcludeFile(file, projectRoot)) {
      continue;
    }

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

      // Skip example/mock code patterns
      if (isExampleCode(line)) {
        continue;
      }

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
