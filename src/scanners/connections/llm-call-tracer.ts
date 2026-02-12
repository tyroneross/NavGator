/**
 * LLM Call Tracer
 *
 * Anchor-based detection of AI/LLM API calls in source code.
 * Instead of searching for "prompt-like" patterns everywhere,
 * starts from unambiguous API call sites and traces backwards
 * to find the provider, model, prompt content, and configuration.
 *
 * 4-pass approach:
 *   Pass 1: Find SDK imports & client initializations
 *   Pass 2: Find API call sites (anchors)
 *   Pass 3: Map wrapper functions
 *   Pass 4: Extract call arguments (model, messages, config)
 */

import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';
import {
  ArchitectureConnection,
  ArchitectureComponent,
  ScanResult,
  generateConnectionId,
  generateComponentId,
} from '../../types.js';

// =============================================================================
// TYPES
// =============================================================================

export interface TracedLLMCall {
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
    type: 'messages-array' | 'string-prompt' | 'template' | 'variable-ref';
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

  callType: 'chat' | 'completion' | 'embedding' | 'image' | 'audio' | 'function-call';
  confidence: number;
}

/** SDK import detected in a file */
interface SDKImport {
  file: string;
  line: number;
  sdk: string;           // Package name: 'openai', '@anthropic-ai/sdk', etc.
  providerName: string;  // Normalized: 'openai', 'anthropic', 'groq', etc.
  importedNames: string[];  // ['OpenAI'], ['Anthropic'], ['generateText', 'streamText']
}

/** Client initialization (new OpenAI(), new Groq(), etc.) */
interface ClientInit {
  file: string;
  line: number;
  variableName: string;  // 'openai', 'client', 'groq'
  sdk: string;
  providerName: string;
  className: string;     // 'OpenAI', 'Anthropic', 'Groq'
}

/** An API call site found in the code */
interface CallAnchor {
  file: string;
  line: number;
  code: string;
  method: string;        // 'chat.completions.create', 'messages.create', etc.
  clientVariable: string;
  providerName: string;
  sdk: string;
  callType: TracedLLMCall['callType'];
  containingFunction?: string;
}

/** A wrapper function that contains an SDK call */
interface WrapperFunction {
  file: string;
  functionName: string;
  className?: string;
  exportedAs?: string;
  containedAnchors: CallAnchor[];
  hasTraceable: boolean;  // LangSmith @traceable() decorator
}

// =============================================================================
// SDK DEFINITIONS
// =============================================================================

interface SDKDefinition {
  packageNames: string[];
  providerName: string;
  classNames: string[];           // Classes that indicate client init
  callPatterns: CallPattern[];
}

interface CallPattern {
  pattern: RegExp;
  method: string;
  callType: TracedLLMCall['callType'];
  requiresClientVar: boolean;  // true for OOP SDKs, false for functional (Vercel AI)
}

const SDK_DEFINITIONS: SDKDefinition[] = [
  // OpenAI
  {
    packageNames: ['openai'],
    providerName: 'openai',
    classNames: ['OpenAI', 'OpenAIApi'],
    callPatterns: [
      { pattern: /\.chat\.completions\.create\s*\(/, method: 'chat.completions.create', callType: 'chat', requiresClientVar: true },
      { pattern: /\.completions\.create\s*\(/, method: 'completions.create', callType: 'completion', requiresClientVar: true },
      { pattern: /\.embeddings\.create\s*\(/, method: 'embeddings.create', callType: 'embedding', requiresClientVar: true },
      { pattern: /\.images\.generate\s*\(/, method: 'images.generate', callType: 'image', requiresClientVar: true },
      { pattern: /\.audio\.transcriptions\s*\.create\s*\(/, method: 'audio.transcriptions.create', callType: 'audio', requiresClientVar: true },
    ],
  },
  // Anthropic
  {
    packageNames: ['@anthropic-ai/sdk'],
    providerName: 'anthropic',
    classNames: ['Anthropic'],
    callPatterns: [
      { pattern: /\.messages\.create\s*\(/, method: 'messages.create', callType: 'chat', requiresClientVar: true },
      { pattern: /\.completions\.create\s*\(/, method: 'completions.create', callType: 'completion', requiresClientVar: true },
      { pattern: /\.beta\./, method: 'beta', callType: 'chat', requiresClientVar: true },
    ],
  },
  // Groq
  {
    packageNames: ['groq-sdk'],
    providerName: 'groq',
    classNames: ['Groq'],
    callPatterns: [
      { pattern: /\.chat\.completions\.create\s*\(/, method: 'chat.completions.create', callType: 'chat', requiresClientVar: true },
    ],
  },
  // Cohere
  {
    packageNames: ['cohere-ai', 'cohere'],
    providerName: 'cohere',
    classNames: ['CohereClient', 'Cohere'],
    callPatterns: [
      { pattern: /\.generate\s*\(/, method: 'generate', callType: 'completion', requiresClientVar: true },
      { pattern: /\.chat\s*\(/, method: 'chat', callType: 'chat', requiresClientVar: true },
      { pattern: /\.embed\s*\(/, method: 'embed', callType: 'embedding', requiresClientVar: true },
    ],
  },
  // Mistral
  {
    packageNames: ['@mistralai/mistralai'],
    providerName: 'mistral',
    classNames: ['MistralClient', 'Mistral'],
    callPatterns: [
      { pattern: /\.chat\s*\(/, method: 'chat', callType: 'chat', requiresClientVar: true },
      { pattern: /\.chatStream\s*\(/, method: 'chatStream', callType: 'chat', requiresClientVar: true },
    ],
  },
  // Vercel AI SDK (functional, no client var)
  {
    packageNames: ['ai', '@ai-sdk/openai', '@ai-sdk/anthropic', '@ai-sdk/google'],
    providerName: 'vercel-ai-sdk',
    classNames: [],
    callPatterns: [
      { pattern: /\bgenerateText\s*\(/, method: 'generateText', callType: 'completion', requiresClientVar: false },
      { pattern: /\bstreamText\s*\(/, method: 'streamText', callType: 'chat', requiresClientVar: false },
      { pattern: /\bgenerateObject\s*\(/, method: 'generateObject', callType: 'function-call', requiresClientVar: false },
      { pattern: /\bstreamObject\s*\(/, method: 'streamObject', callType: 'function-call', requiresClientVar: false },
      { pattern: /\bembed\s*\(/, method: 'embed', callType: 'embedding', requiresClientVar: false },
      { pattern: /\bembedMany\s*\(/, method: 'embedMany', callType: 'embedding', requiresClientVar: false },
    ],
  },
  // LangChain
  {
    packageNames: ['@langchain/openai', '@langchain/anthropic', '@langchain/groq', '@langchain/core', '@langchain/community', 'langchain'],
    providerName: 'langchain',
    classNames: ['ChatOpenAI', 'ChatAnthropic', 'ChatGroq', 'ChatGoogleGenerativeAI'],
    callPatterns: [
      { pattern: /\.invoke\s*\(/, method: 'invoke', callType: 'chat', requiresClientVar: true },
      { pattern: /\.call\s*\(/, method: 'call', callType: 'chat', requiresClientVar: true },
      { pattern: /\.stream\s*\(/, method: 'stream', callType: 'chat', requiresClientVar: true },
      { pattern: /\.batch\s*\(/, method: 'batch', callType: 'chat', requiresClientVar: true },
    ],
  },
];

// =============================================================================
// FILE EXCLUSIONS
// =============================================================================

function shouldExcludeFile(file: string): boolean {
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
    /\.(d\.ts|map|min\.js)$/,
    /\/dist\//,
    /\/build\//,
    /\/generated\//,
  ];
  return excludePatterns.some(p => p.test(file));
}

// =============================================================================
// PASS 1: FIND SDK IMPORTS
// =============================================================================

function findSDKImports(content: string, lines: string[], file: string): SDKImport[] {
  const imports: SDKImport[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    for (const sdk of SDK_DEFINITIONS) {
      for (const pkg of sdk.packageNames) {
        // Static imports: import X from 'pkg' or import { X } from 'pkg'
        const staticImport = line.match(
          new RegExp(`import\\s+(?:(?:\\{\\s*([^}]+)\\s*\\})|(?:(\\w+)))\\s+from\\s+['"]${escapeRegex(pkg)}['"]`)
        );
        if (staticImport) {
          const names = staticImport[1]
            ? staticImport[1].split(',').map(n => n.trim().split(/\s+as\s+/).pop()!.trim())
            : [staticImport[2]];
          imports.push({
            file,
            line: i + 1,
            sdk: pkg,
            providerName: sdk.providerName,
            importedNames: names.filter(Boolean),
          });
          continue;
        }

        // Dynamic imports: const { X } = await import('pkg')
        const dynamicImport = line.match(
          new RegExp(`(?:const|let|var)\\s+(?:\\{\\s*([^}]+)\\s*\\}|(\\w+))\\s*=\\s*(?:await\\s+)?import\\s*\\(\\s*['"]${escapeRegex(pkg)}['"]`)
        );
        if (dynamicImport) {
          const names = dynamicImport[1]
            ? dynamicImport[1].split(',').map(n => n.trim())
            : [dynamicImport[2]];
          imports.push({
            file,
            line: i + 1,
            sdk: pkg,
            providerName: sdk.providerName,
            importedNames: names.filter(Boolean),
          });
          continue;
        }

        // require(): const X = require('pkg')
        const requireImport = line.match(
          new RegExp(`(?:const|let|var)\\s+(\\w+)\\s*=\\s*require\\s*\\(\\s*['"]${escapeRegex(pkg)}['"]`)
        );
        if (requireImport) {
          imports.push({
            file,
            line: i + 1,
            sdk: pkg,
            providerName: sdk.providerName,
            importedNames: [requireImport[1]],
          });
        }
      }
    }
  }

  return imports;
}

// =============================================================================
// PASS 1B: FIND CLIENT INITIALIZATIONS
// =============================================================================

function findClientInits(lines: string[], file: string, imports: SDKImport[]): ClientInit[] {
  const inits: ClientInit[] = [];

  // Build set of imported class names for this file
  const importedClasses = new Map<string, SDKImport>();
  for (const imp of imports) {
    for (const name of imp.importedNames) {
      importedClasses.set(name, imp);
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Match: const x = new ClassName(...)
    const initMatch = line.match(
      /(?:const|let|var)\s+(\w+)\s*=\s*new\s+(\w+)\s*\(/
    );
    if (initMatch) {
      const [, varName, className] = initMatch;

      // Check if the class is from a known SDK
      const imp = importedClasses.get(className);
      if (imp) {
        inits.push({
          file,
          line: i + 1,
          variableName: varName,
          sdk: imp.sdk,
          providerName: imp.providerName,
          className,
        });
        continue;
      }

      // Also check SDK definitions directly for the class name
      for (const sdk of SDK_DEFINITIONS) {
        if (sdk.classNames.includes(className)) {
          inits.push({
            file,
            line: i + 1,
            variableName: varName,
            sdk: sdk.packageNames[0],
            providerName: sdk.providerName,
            className,
          });
          break;
        }
      }
    }

    // Match: this.client = new ClassName(...)
    const thisInitMatch = line.match(
      /this\.(\w+)\s*=\s*new\s+(\w+)\s*\(/
    );
    if (thisInitMatch) {
      const [, propName, className] = thisInitMatch;
      const imp = importedClasses.get(className);
      if (imp) {
        inits.push({
          file,
          line: i + 1,
          variableName: `this.${propName}`,
          sdk: imp.sdk,
          providerName: imp.providerName,
          className,
        });
      }
    }
  }

  return inits;
}

// =============================================================================
// PASS 2: FIND API CALL ANCHORS
// =============================================================================

function findCallAnchors(
  lines: string[],
  file: string,
  imports: SDKImport[],
  clientInits: ClientInit[],
): CallAnchor[] {
  const anchors: CallAnchor[] = [];

  // Build lookup of known client variables
  const clientVars = new Map<string, ClientInit>();
  for (const init of clientInits) {
    clientVars.set(init.variableName, init);
    // Also track without 'this.' prefix for method access
    if (init.variableName.startsWith('this.')) {
      clientVars.set(init.variableName.replace('this.', ''), init);
    }
  }

  // Build set of imported function names (for functional SDKs like Vercel AI)
  const importedFunctions = new Set<string>();
  for (const imp of imports) {
    for (const name of imp.importedNames) {
      importedFunctions.add(name);
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Skip comments
    const trimmed = line.trimStart();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('#')) {
      continue;
    }

    for (const sdk of SDK_DEFINITIONS) {
      for (const cp of sdk.callPatterns) {
        if (!cp.pattern.test(line)) continue;

        if (cp.requiresClientVar) {
          // OOP style: find the variable calling the method
          // Match: varName.method( or this.varName.method(
          const varMatch = line.match(/(\w+(?:\.\w+)?)\.(?:chat|messages|completions|embeddings|images|audio|beta)/);
          if (!varMatch) continue;

          const callerVar = varMatch[1];

          // Check if this variable is a known client
          const clientInit = clientVars.get(callerVar);
          if (clientInit && clientInit.providerName === sdk.providerName) {
            const funcName = extractFunctionName(lines, i);
            anchors.push({
              file,
              line: i + 1,
              code: line.trim().slice(0, 120),
              method: cp.method,
              clientVariable: callerVar,
              providerName: sdk.providerName,
              sdk: clientInit.sdk,
              callType: cp.callType,
              containingFunction: funcName,
            });
            break;
          }

          // For LangChain .invoke() / .call() — match chains and LangChain model instances
          if (sdk.providerName === 'langchain') {
            // Check if file has any LangChain imports
            const hasLangChainImport = imports.some(imp =>
              imp.providerName === 'langchain'
            );
            if (hasLangChainImport) {
              const funcName = extractFunctionName(lines, i);
              anchors.push({
                file,
                line: i + 1,
                code: line.trim().slice(0, 120),
                method: cp.method,
                clientVariable: callerVar,
                providerName: 'langchain',
                sdk: imports.find(imp => imp.providerName === 'langchain')?.sdk || 'langchain',
                callType: cp.callType,
                containingFunction: funcName,
              });
              break;
            }
          }
        } else {
          // Functional style (Vercel AI SDK): generateText(...)
          // Check if the function was imported from the right package
          const funcMatch = line.match(new RegExp(`\\b(${sdk.callPatterns.map(p => {
            const src = p.pattern.source;
            // Extract function name from pattern like \bgenerateText\s*\(
            const m = src.match(/\\b(\w+)/);
            return m ? m[1] : '';
          }).filter(Boolean).join('|')})\\s*\\(`));

          if (funcMatch && importedFunctions.has(funcMatch[1])) {
            const funcName = extractFunctionName(lines, i);
            anchors.push({
              file,
              line: i + 1,
              code: line.trim().slice(0, 120),
              method: funcMatch[1],
              clientVariable: funcMatch[1],
              providerName: sdk.providerName,
              sdk: sdk.packageNames[0],
              callType: cp.callType,
              containingFunction: funcName,
            });
            break;
          }
        }
      }
    }
  }

  return anchors;
}

// =============================================================================
// PASS 3: MAP WRAPPER FUNCTIONS
// =============================================================================

function mapWrapperFunctions(
  anchors: CallAnchor[],
  fileContents: Map<string, { content: string; lines: string[] }>,
): WrapperFunction[] {
  const wrappers: WrapperFunction[] = [];

  // Group anchors by file+function
  const anchorsByFunction = new Map<string, CallAnchor[]>();
  for (const anchor of anchors) {
    if (anchor.containingFunction) {
      const key = `${anchor.file}::${anchor.containingFunction}`;
      if (!anchorsByFunction.has(key)) {
        anchorsByFunction.set(key, []);
      }
      anchorsByFunction.get(key)!.push(anchor);
    }
  }

  // For each function that contains an anchor, build a wrapper entry
  for (const [key, fnAnchors] of anchorsByFunction) {
    const [file, funcName] = key.split('::');
    const fileData = fileContents.get(file);
    if (!fileData) continue;

    // Check if function has @traceable() decorator or LangSmith wrapping
    const hasTraceable = fileData.content.includes('traceable(') ||
      fileData.content.includes('@traceable');

    // Detect class membership
    const className = detectClassName(fileData.lines, fnAnchors[0].line - 1);

    // Check if the function is exported
    const exportedAs = detectExport(fileData.lines, funcName);

    wrappers.push({
      file,
      functionName: funcName,
      className,
      exportedAs,
      containedAnchors: fnAnchors,
      hasTraceable,
    });
  }

  return wrappers;
}

// =============================================================================
// PASS 4: EXTRACT CALL ARGUMENTS
// =============================================================================

function extractCallArguments(
  anchor: CallAnchor,
  lines: string[],
): Partial<TracedLLMCall> {
  const anchorLine = anchor.line - 1;

  // Look at the anchor line and the following lines for the arguments object
  const contextLines = lines.slice(anchorLine, Math.min(anchorLine + 30, lines.length));
  const context = contextLines.join('\n');

  // Extract model
  const model = extractModel(context, lines, anchorLine);

  // Extract prompt/messages
  const prompt = extractPromptInfo(context, lines, anchorLine);

  // Extract config
  const config = extractConfig(context);

  return { model, prompt, config };
}

function extractModel(context: string, lines: string[], anchorLine: number): TracedLLMCall['model'] {
  // Look for model: "value" or model: variable
  const modelStringMatch = context.match(/model\s*:\s*['"`]([^'"`]+)['"`]/);
  if (modelStringMatch) {
    return {
      value: modelStringMatch[1],
      isDynamic: false,
      line: findLineOffset(lines, anchorLine, modelStringMatch[0]),
    };
  }

  // Model as variable reference
  const modelVarMatch = context.match(/model\s*:\s*(\w+(?:\.\w+)*)/);
  if (modelVarMatch) {
    const varName = modelVarMatch[1];
    // Try to resolve the variable value
    const resolved = resolveVariable(lines, anchorLine, varName);
    return {
      value: resolved || null,
      isDynamic: !resolved,
      variableName: varName,
      line: findLineOffset(lines, anchorLine, modelVarMatch[0]),
    };
  }

  return { value: null, isDynamic: true, line: anchorLine + 1 };
}

function extractPromptInfo(
  context: string,
  lines: string[],
  anchorLine: number,
): TracedLLMCall['prompt'] {
  // Check for messages array
  const messagesMatch = context.match(/messages\s*:\s*\[/);
  if (messagesMatch) {
    // Try to extract system prompt from inline messages
    const systemMatch = context.match(
      /role\s*:\s*['"]system['"]\s*,\s*content\s*:\s*(?:['"`]([^'"`]{0,500})['"`]|(\w+))/
    );

    // Try to extract user template
    const userMatch = context.match(
      /role\s*:\s*['"]user['"]\s*,\s*content\s*:\s*(?:['"`]([^'"`]{0,500})['"`]|(\w+))/
    );

    // Detect template variables
    const variables = detectTemplateVars(context);

    return {
      type: 'messages-array',
      content: userMatch?.[1] || userMatch?.[2] || undefined,
      systemPrompt: systemMatch?.[1] || systemMatch?.[2] || undefined,
      hasUserTemplate: !!userMatch,
      variables,
    };
  }

  // Check for messages as variable reference
  const messagesVarMatch = context.match(/messages\s*:\s*(\w+)/);
  if (messagesVarMatch) {
    return {
      type: 'variable-ref',
      content: undefined,
      systemPrompt: undefined,
      hasUserTemplate: false,
      variables: [],
    };
  }

  // Check for prompt: string (Vercel AI SDK style)
  const promptStringMatch = context.match(/prompt\s*:\s*['"`]([^'"`]{0,500})/);
  if (promptStringMatch) {
    return {
      type: 'string-prompt',
      content: promptStringMatch[1],
      hasUserTemplate: true,
      variables: detectTemplateVars(promptStringMatch[1]),
    };
  }

  // Check for system: string (Vercel AI SDK style)
  const systemStringMatch = context.match(/system\s*:\s*['"`]([^'"`]{0,500})/);

  return {
    type: 'string-prompt',
    content: undefined,
    systemPrompt: systemStringMatch?.[1] || undefined,
    hasUserTemplate: false,
    variables: [],
  };
}

function extractConfig(context: string): TracedLLMCall['config'] {
  const config: TracedLLMCall['config'] = {};

  const tempMatch = context.match(/temperature\s*:\s*([\d.]+)/);
  if (tempMatch) config.temperature = parseFloat(tempMatch[1]);

  const maxTokensMatch = context.match(/(?:max_tokens|maxTokens)\s*:\s*(\d+)/);
  if (maxTokensMatch) config.maxTokens = parseInt(maxTokensMatch[1]);

  const streamMatch = context.match(/stream\s*:\s*(true|false)/);
  if (streamMatch) config.stream = streamMatch[1] === 'true';

  const toolsMatch = context.match(/tools\s*:\s*\[/);
  if (toolsMatch) config.tools = ['detected'];

  return config;
}

// =============================================================================
// MAIN SCAN FUNCTION
// =============================================================================

export interface LLMTraceResult {
  calls: TracedLLMCall[];
  wrappers: WrapperFunction[];
  scanResult: ScanResult;
}

export async function traceLLMCalls(projectRoot: string): Promise<LLMTraceResult> {
  const sourceFiles = await glob('**/*.{ts,tsx,js,jsx,py}', {
    cwd: projectRoot,
    ignore: [
      'node_modules/**', 'dist/**', 'build/**', '.next/**',
      '__pycache__/**', 'venv/**', '**/node_modules/**', '**/.git/**',
    ],
  });

  // Read all source files
  const fileContents = new Map<string, { content: string; lines: string[] }>();
  for (const file of sourceFiles) {
    if (shouldExcludeFile(file)) continue;
    const filePath = path.join(projectRoot, file);
    try {
      const stat = await fs.promises.stat(filePath);
      if (!stat.isFile()) continue;
      const content = await fs.promises.readFile(filePath, 'utf-8');
      fileContents.set(file, { content, lines: content.split('\n') });
    } catch {
      continue;
    }
  }

  // -------------------------------------------------------------------------
  // Pass 1: Find SDK imports and client initializations
  // -------------------------------------------------------------------------
  const allImports: SDKImport[] = [];
  const allClientInits: ClientInit[] = [];

  for (const [file, { content, lines }] of fileContents) {
    const imports = findSDKImports(content, lines, file);
    allImports.push(...imports);

    const inits = findClientInits(lines, file, imports);
    allClientInits.push(...inits);
  }

  // -------------------------------------------------------------------------
  // Pass 2: Find API call anchors
  // -------------------------------------------------------------------------
  const allAnchors: CallAnchor[] = [];

  for (const [file, { content, lines }] of fileContents) {
    // Only scan files that have SDK imports or that use known client variables
    const fileImports = allImports.filter(i => i.file === file);
    const fileInits = allClientInits.filter(i => i.file === file);

    // Also include inits from other files that might be imported here
    const importedVars = findImportedClientVars(lines, file, allClientInits);
    const combinedInits = [...fileInits, ...importedVars];

    if (fileImports.length === 0 && combinedInits.length === 0) continue;

    const anchors = findCallAnchors(lines, file, fileImports, combinedInits);
    allAnchors.push(...anchors);
  }

  // -------------------------------------------------------------------------
  // Pass 3: Map wrapper functions
  // -------------------------------------------------------------------------
  const wrappers = mapWrapperFunctions(allAnchors, fileContents);

  // -------------------------------------------------------------------------
  // Pass 4: Extract arguments and build TracedLLMCalls
  // -------------------------------------------------------------------------
  const tracedCalls: TracedLLMCall[] = [];
  const seen = new Set<string>(); // Dedup by file:line

  for (const anchor of allAnchors) {
    const dedupKey = `${anchor.file}:${anchor.line}`;
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);

    const fileData = fileContents.get(anchor.file);
    if (!fileData) continue;

    const args = extractCallArguments(anchor, fileData.lines);

    // Find the matching SDK import
    const matchingImport = allImports.find(i =>
      i.file === anchor.file && i.providerName === anchor.providerName
    ) || allImports.find(i => i.providerName === anchor.providerName);

    const call: TracedLLMCall = {
      id: `TRACE_${anchor.file.replace(/[^a-zA-Z0-9]/g, '_')}_L${anchor.line}`,
      name: anchor.containingFunction || `anonymous_${anchor.line}`,
      anchor: {
        file: anchor.file,
        line: anchor.line,
        code: anchor.code,
        method: anchor.method,
      },
      provider: {
        name: anchor.providerName,
        sdk: anchor.sdk,
        importLine: matchingImport?.line || 0,
        clientVariable: anchor.clientVariable,
      },
      model: args.model || { value: null, isDynamic: true, line: anchor.line },
      prompt: args.prompt || {
        type: 'variable-ref',
        hasUserTemplate: false,
        variables: [],
      },
      config: args.config || {},
      callType: anchor.callType,
      confidence: computeConfidence(anchor, matchingImport, args),
    };

    tracedCalls.push(call);
  }

  // -------------------------------------------------------------------------
  // Convert to NavGator ScanResult format
  // -------------------------------------------------------------------------
  const scanResult = convertToScanResult(tracedCalls, allImports);

  return { calls: tracedCalls, wrappers, scanResult };
}

// =============================================================================
// CONVERSION TO SCAN RESULT
// =============================================================================

function convertToScanResult(
  calls: TracedLLMCall[],
  imports: SDKImport[],
): ScanResult {
  const components: ArchitectureComponent[] = [];
  const connections: ArchitectureConnection[] = [];
  const timestamp = Date.now();

  // Create a component per unique provider
  const providerComponents = new Map<string, ArchitectureComponent>();
  for (const call of calls) {
    const providerKey = call.provider.name;
    if (!providerComponents.has(providerKey)) {
      const comp: ArchitectureComponent = {
        component_id: generateComponentId('llm', providerKey),
        name: providerKey,
        type: 'llm',
        role: {
          purpose: `${providerKey} AI API`,
          layer: 'external',
          critical: true,
        },
        source: {
          detection_method: 'auto',
          config_files: [],
          confidence: Math.max(...calls.filter(c => c.provider.name === providerKey).map(c => c.confidence)),
        },
        connects_to: [],
        connected_from: [],
        status: 'active',
        tags: ['llm', 'external', providerKey],
        timestamp,
        last_updated: timestamp,
      };
      providerComponents.set(providerKey, comp);
      components.push(comp);
    }
  }

  // Create a connection per call site
  for (const call of calls) {
    const providerComp = providerComponents.get(call.provider.name)!;

    const conn: ArchitectureConnection = {
      connection_id: generateConnectionId('service-call'),
      from: {
        component_id: `FILE:${call.anchor.file}`,
        location: {
          file: call.anchor.file,
          line: call.anchor.line,
          function: call.name,
        },
      },
      to: {
        component_id: providerComp.component_id,
      },
      connection_type: 'service-call',
      code_reference: {
        file: call.anchor.file,
        symbol: call.name,
        symbol_type: 'function',
        line_start: call.anchor.line,
        code_snippet: call.anchor.code,
      },
      description: `${call.provider.name}.${call.anchor.method}${call.model.value ? ` (${call.model.value})` : ''}`,
      detected_from: 'LLM call tracer (anchor-based)',
      confidence: call.confidence,
      timestamp,
      last_verified: timestamp,
    };
    connections.push(conn);
  }

  return { components, connections, warnings: [] };
}

// =============================================================================
// HELPERS
// =============================================================================

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractFunctionName(lines: string[], lineIndex: number): string | undefined {
  for (let i = lineIndex; i >= Math.max(0, lineIndex - 30); i--) {
    const line = lines[i];

    // JS/TS function patterns
    const funcMatch = line.match(
      /(?:async\s+)?(?:function\s+)?(\w+)\s*(?:=\s*(?:async\s*)?\(|[\(:])/
    );
    if (funcMatch && funcMatch[1] !== 'if' && funcMatch[1] !== 'for' && funcMatch[1] !== 'while') {
      return funcMatch[1];
    }

    // Arrow function assignment
    const arrowMatch = line.match(/(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\(/);
    if (arrowMatch) return arrowMatch[1];

    // Method definition
    const methodMatch = line.match(/(?:async\s+)?(\w+)\s*\([^)]*\)\s*[:{]/);
    if (methodMatch && methodMatch[1] !== 'if' && methodMatch[1] !== 'for') {
      return methodMatch[1];
    }

    // Python function
    const pyMatch = line.match(/(?:async\s+)?def\s+(\w+)\s*\(/);
    if (pyMatch) return pyMatch[1];
  }
  return undefined;
}

function detectClassName(lines: string[], lineIndex: number): string | undefined {
  for (let i = lineIndex; i >= Math.max(0, lineIndex - 100); i--) {
    const line = lines[i];
    const classMatch = line.match(/class\s+(\w+)/);
    if (classMatch) return classMatch[1];
  }
  return undefined;
}

function detectExport(lines: string[], funcName: string): string | undefined {
  for (const line of lines) {
    if (line.includes(`export`) && line.includes(funcName)) {
      return funcName;
    }
  }
  return undefined;
}

function detectTemplateVars(content: string): string[] {
  const vars: string[] = [];
  const seen = new Set<string>();

  // JS template literals: ${varName}
  const jsVars = content.matchAll(/\$\{(\w+)\}/g);
  for (const m of jsVars) {
    if (!seen.has(m[1])) { seen.add(m[1]); vars.push(m[1]); }
  }

  // Jinja/Mustache: {{varName}}
  const jinjaVars = content.matchAll(/\{\{\s*(\w+)\s*\}\}/g);
  for (const m of jinjaVars) {
    if (!seen.has(m[1])) { seen.add(m[1]); vars.push(m[1]); }
  }

  return vars;
}

function resolveVariable(lines: string[], fromLine: number, varName: string): string | null {
  // Simple resolution: look for const/let/var assignment above
  const parts = varName.split('.');
  const baseName = parts[0];

  for (let i = fromLine; i >= Math.max(0, fromLine - 50); i--) {
    const line = lines[i];
    const match = line.match(
      new RegExp(`(?:const|let|var)\\s+${escapeRegex(baseName)}\\s*=\\s*['"\`]([^'"\`]+)['"\`]`)
    );
    if (match) return match[1];
  }

  // Check for common model constant patterns
  for (let i = 0; i < Math.min(50, lines.length); i++) {
    const line = lines[i];
    const match = line.match(
      new RegExp(`(?:const|let|var)\\s+${escapeRegex(baseName)}\\s*=\\s*['"\`]([^'"\`]+)['"\`]`)
    );
    if (match) return match[1];
  }

  return null;
}

function findImportedClientVars(
  lines: string[],
  file: string,
  allInits: ClientInit[],
): ClientInit[] {
  // If file imports a module that exports a client init, track it
  const imported: ClientInit[] = [];

  for (const line of lines) {
    // Look for imports that might bring in client instances
    const importMatch = line.match(
      /import\s+\{?\s*(\w+)\s*\}?\s+from\s+['"]([^'"]+)['"]/
    );
    if (importMatch) {
      const importedName = importMatch[1];
      // Check if any file exports a client init with this name
      for (const init of allInits) {
        if (init.variableName === importedName || init.className === importedName) {
          imported.push({ ...init, file, variableName: importedName });
        }
      }
    }
  }

  return imported;
}

function findLineOffset(lines: string[], startLine: number, searchStr: string): number {
  for (let i = startLine; i < Math.min(startLine + 30, lines.length); i++) {
    if (lines[i].includes(searchStr.split(':')[0])) {
      return i + 1;
    }
  }
  return startLine + 1;
}

function computeConfidence(
  anchor: CallAnchor,
  matchingImport: SDKImport | undefined,
  args: Partial<TracedLLMCall>,
): number {
  let confidence = 0.6; // Base: we found an anchor

  // Has corroborating import
  if (matchingImport) confidence += 0.15;

  // Has resolved model
  if (args.model?.value) confidence += 0.1;

  // Has prompt content
  if (args.prompt?.content || args.prompt?.systemPrompt) confidence += 0.1;

  // Has config extracted
  if (args.config && Object.keys(args.config).length > 0) confidence += 0.05;

  return Math.min(confidence, 1.0);
}
