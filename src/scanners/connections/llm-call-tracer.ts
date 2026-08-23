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
  /**
   * When true, an anchor is still emitted even if the receiver variable
   * cannot be resolved to a known `new ClassName()` client init — gated on
   * the file having *any* import from this SDK's packageNames. Needed for
   * SDK shapes where the method-call receiver is a value derived from the
   * client (e.g. `genAI.getGenerativeModel(...)` returns `model`, and
   * `model.generateContent(...)` is the actual call site — `model` is never
   * registered as a ClientInit). Loosens precision in exchange for recall;
   * only set this for SDKs whose call-pattern method names are distinctive
   * enough that a false positive is unlikely (see LangChain / legacy Google
   * precedent below).
   */
  allowImportFallback?: boolean;
  /**
   * When true, a bare default-imported binding of this package (e.g.
   * `import ollama from 'ollama'`) is registered as an already-initialized
   * client, without requiring a `new ClassName(...)` call. Needed for SDKs
   * that ship a ready-to-use singleton instance as their default export.
   */
  implicitSingletonClient?: boolean;
}

interface CallPattern {
  pattern: RegExp;
  method: string;
  callType: TracedLLMCall['callType'];
  requiresClientVar: boolean;  // true for OOP SDKs, false for functional (Vercel AI)
}

/**
 * KNOWN GAPS in the receiver-derivation scheme (getReceiverRegex, below in
 * PASS 2). Each is scoped out rather than guessed at; consolidated here so
 * a future audit doesn't have to re-derive them from the call-pattern table.
 *
 * 1. Computed receiver — `clients[0].chat.completions.create(...)`. Not
 *    matched. `clientVars` is keyed on plain identifiers, so a computed
 *    member expression could never resolve to a ClientInit even if captured.
 * 2. Call-expression receiver — `getClient().chat.completions.create(...)`.
 *    Same reasoning: the receiver isn't a variable, so there's nothing to
 *    look up.
 * 3. Namespaced/multi-segment receiver narrowing (independent-audit finding
 *    f3) — `deps.openai.chat.completions.create(...)` captures the bare
 *    trailing identifier `"openai"`, not the full `"deps.openai"` path (the
 *    pre-c76b9d8 hand-written regex captured up to two segments, so it
 *    produced `"deps.openai"` — which never matched `clientVars` either,
 *    since ClientInit variable names are always simple identifiers or
 *    `"this.<prop>"`; that shape was a silent miss both before and after).
 *    This is a **pinned, intentional** choice, not an accident:
 *      - Recall: a bare trailing identifier is far more likely to match a
 *        registered client than a dotted path is (`openai` is normally the
 *        registered ClientInit; `deps.openai` normally isn't, and a change
 *        that requires full-path matching would just reintroduce the miss).
 *      - Precision risk: if a *different*, unrelated object happens to have
 *        a property with the same trailing name as a real registered client
 *        in the same file (e.g. `this.deps.openai` where `deps.openai` is a
 *        duck-typed stand-in, while a genuine `const openai = new OpenAI()`
 *        also exists at module scope), the anchor gets attributed to the
 *        real client even though it isn't the actual receiver.
 *    Judged acceptable because the common real-world shape for a namespaced
 *    receiver is dependency injection re-exposing the *same* client under a
 *    namespace (so the trailing name is usually correct, not misleading),
 *    and because closing the residual collision case needs alias/property
 *    tracking across assignments (`this.deps = { openai }`) — the same class
 *    of multi-line variable-tracking work already deferred for Bedrock's
 *    two-line `new Command(...)` form above. Pinned by the
 *    `openai-namespaced-receiver.ts` fixture in
 *    `__tests__/fixtures/llm-providers/` — if this behavior ever needs to
 *    change, that test should fail loudly rather than silently pass.
 */
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
  // Verified against official SDK api.md (github.com/anthropics/anthropic-sdk-typescript,
  // main branch, checked 2026-08-05): client.messages.{create,stream,countTokens},
  // client.beta.messages.{create,stream,countTokens}. The prior /\.beta\./ pattern
  // was too loose — api.md also lists dozens of non-LLM beta admin endpoints
  // (client.beta.agents.*, client.beta.sessions.*, client.beta.environments.*,
  // client.beta.models.*) that are not model-invocation calls; tightened to the
  // messages-specific beta methods only.
  {
    packageNames: ['@anthropic-ai/sdk'],
    providerName: 'anthropic',
    classNames: ['Anthropic'],
    callPatterns: [
      { pattern: /\.messages\.create\s*\(/, method: 'messages.create', callType: 'chat', requiresClientVar: true },
      { pattern: /\.messages\.stream\s*\(/, method: 'messages.stream', callType: 'chat', requiresClientVar: true },
      { pattern: /\.messages\.countTokens\s*\(/, method: 'messages.countTokens', callType: 'chat', requiresClientVar: true },
      { pattern: /\.completions\.create\s*\(/, method: 'completions.create', callType: 'completion', requiresClientVar: true },
      { pattern: /\.beta\.messages\.create\s*\(/, method: 'beta.messages.create', callType: 'chat', requiresClientVar: true },
      { pattern: /\.beta\.messages\.stream\s*\(/, method: 'beta.messages.stream', callType: 'chat', requiresClientVar: true },
      { pattern: /\.beta\.messages\.countTokens\s*\(/, method: 'beta.messages.countTokens', callType: 'chat', requiresClientVar: true },
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
  // v1.x (`@mistralai/mistralai` >=1.0, class `Mistral`) moved to
  // `client.chat.complete(...)` / `client.chat.stream(...)`; the old v0.x
  // `client.chat({...})` / `client.chatStream({...})` shape (class
  // `MistralClient`) is kept for back-compat. Verified against
  // github.com/mistralai/client-ts README + docs/sdks/chat/README.md
  // (main branch, checked 2026-08-05): "complete" and "stream" are the two
  // documented Chat operations.
  {
    packageNames: ['@mistralai/mistralai'],
    providerName: 'mistral',
    classNames: ['MistralClient', 'Mistral'],
    callPatterns: [
      { pattern: /\.chat\.complete\s*\(/, method: 'chat.complete', callType: 'chat', requiresClientVar: true },
      { pattern: /\.chat\.stream\s*\(/, method: 'chat.stream', callType: 'chat', requiresClientVar: true },
      { pattern: /\.chat\s*\(/, method: 'chat', callType: 'chat', requiresClientVar: true },
      { pattern: /\.chatStream\s*\(/, method: 'chatStream', callType: 'chat', requiresClientVar: true },
    ],
  },
  // Google — current SDK (@google/genai, class GoogleGenAI). Verified against
  // github.com/googleapis/js-genai README (main branch, checked 2026-08-05):
  // `const ai = new GoogleGenAI({...}); ai.models.generateContent({...})` /
  // `.generateContentStream(...)`. The receiver of `.models.generateContent`
  // IS the top-level client variable, so this resolves through the standard
  // clientVar mechanism — no import-fallback needed.
  {
    packageNames: ['@google/genai'],
    providerName: 'google',
    classNames: ['GoogleGenAI'],
    callPatterns: [
      { pattern: /\.models\.generateContent\s*\(/, method: 'models.generateContent', callType: 'chat', requiresClientVar: true },
      { pattern: /\.models\.generateContentStream\s*\(/, method: 'models.generateContentStream', callType: 'chat', requiresClientVar: true },
      { pattern: /\.models\.embedContent\s*\(/, method: 'models.embedContent', callType: 'embedding', requiresClientVar: true },
    ],
  },
  // Google — legacy SDK (@google/generative-ai, class GoogleGenerativeAI).
  // Verified against github.com/google-gemini/generative-ai-js README +
  // samples/text_generation.js (main branch, checked 2026-08-05). Repo is
  // now marked deprecated/legacy by Google (EOL 2025-11-30) but still widely
  // deployed, so still tracked. Structurally two-hop:
  // `const model = genAI.getGenerativeModel({model:...}); model.generateContent(prompt)`
  // — the call receiver (`model`) is never the registered client variable
  // (`genAI`), so this needs allowImportFallback like LangChain below.
  // `.startChat().sendMessage(...)` deliberately NOT added: `sendMessage` is
  // too generic a method name (chat UIs, websockets, workers all use it) to
  // gate on file-level import presence alone without a real false-positive
  // risk — known remaining gap.
  {
    packageNames: ['@google/generative-ai'],
    providerName: 'google',
    classNames: ['GoogleGenerativeAI'],
    allowImportFallback: true,
    callPatterns: [
      { pattern: /\.generateContent\s*\(/, method: 'generateContent', callType: 'chat', requiresClientVar: true },
      { pattern: /\.generateContentStream\s*\(/, method: 'generateContentStream', callType: 'chat', requiresClientVar: true },
      { pattern: /\.embedContent\s*\(/, method: 'embedContent', callType: 'embedding', requiresClientVar: true },
    ],
  },
  // Ollama. Verified against github.com/ollama/ollama-js README (main
  // branch, checked 2026-08-05): `ollama.chat/generate/embed(...)` via the
  // default-exported singleton (`import ollama from 'ollama'`, no `new`
  // required), or `new Ollama({...})` for a configured instance (both
  // classNames-based `new` and implicitSingletonClient-based default-import
  // paths are covered). Method is `.embed(`, not `.embeddings(` (older name
  // in some docs/blog posts, not current npm README).
  // Bare `fetch('http://localhost:11434/api/generate')` deliberately NOT
  // added: this is an anchor-based tracer keyed on SDK receiver+method
  // shapes, and a literal URL string match is a structurally different
  // detection strategy (would need a URL-pattern pass, not a call-pattern
  // one) — out of scope for this fix, known remaining gap.
  {
    packageNames: ['ollama'],
    providerName: 'ollama',
    classNames: ['Ollama'],
    implicitSingletonClient: true,
    callPatterns: [
      { pattern: /\.chat\s*\(/, method: 'chat', callType: 'chat', requiresClientVar: true },
      { pattern: /\.generate\s*\(/, method: 'generate', callType: 'completion', requiresClientVar: true },
      { pattern: /\.embed\s*\(/, method: 'embed', callType: 'embedding', requiresClientVar: true },
    ],
  },
  // AWS Bedrock Runtime. Verified against github.com/aws/aws-sdk-js-v3
  // clients/client-bedrock-runtime README + src/commands directory listing
  // (main branch, checked 2026-08-05): command-object shape, not a
  // `.method(` path — `client.send(new InvokeModelCommand({...}))`. The
  // existing requiresClientVar machinery keys on `.method(` patterns, so
  // rather than extending that machinery to a generic `.send(` (far too
  // generic a method name — used by event emitters, sockets, queues —
  // would produce false positives), the pattern folds the distinguishing
  // Command constructor into the same regex: `.send(new XCommand(`. This
  // only catches the single-line `client.send(new XCommand({...}))` form;
  // the equally common two-line form
  // (`const cmd = new XCommand(p); ... client.send(cmd)`) requires tracking
  // a command-object variable across lines, which the current architecture
  // doesn't support — known remaining gap, documented rather than guessed at.
  // Covers the 5 inference-invoking commands (Invoke/Converse + stream
  // variants); excludes CountTokensCommand, ApplyGuardrailCommand,
  // GetAsyncInvokeCommand, ListAsyncInvokesCommand, StartAsyncInvokeCommand
  // (utility/admin, not confirmed as direct model-invocation call sites).
  {
    packageNames: ['@aws-sdk/client-bedrock-runtime'],
    providerName: 'bedrock',
    classNames: ['BedrockRuntimeClient', 'BedrockRuntime'],
    callPatterns: [
      { pattern: /\.send\s*\(\s*new\s+InvokeModelCommand\s*\(/, method: 'send(InvokeModelCommand)', callType: 'chat', requiresClientVar: true },
      { pattern: /\.send\s*\(\s*new\s+InvokeModelWithResponseStreamCommand\s*\(/, method: 'send(InvokeModelWithResponseStreamCommand)', callType: 'chat', requiresClientVar: true },
      { pattern: /\.send\s*\(\s*new\s+InvokeModelWithBidirectionalStreamCommand\s*\(/, method: 'send(InvokeModelWithBidirectionalStreamCommand)', callType: 'chat', requiresClientVar: true },
      { pattern: /\.send\s*\(\s*new\s+ConverseCommand\s*\(/, method: 'send(ConverseCommand)', callType: 'chat', requiresClientVar: true },
      { pattern: /\.send\s*\(\s*new\s+ConverseStreamCommand\s*\(/, method: 'send(ConverseStreamCommand)', callType: 'chat', requiresClientVar: true },
    ],
  },
  // Vercel AI SDK (functional, no client var). Provider packages verified to
  // exist on the npm registry (registry.npmjs.org, checked 2026-08-05):
  // @ai-sdk/groq@4.0.22, @ai-sdk/mistral@4.0.23, @ai-sdk/amazon-bedrock@5.0.43,
  // @ai-sdk/google-vertex@5.0.41, @ai-sdk/cohere@4.0.21, @ai-sdk/xai@4.0.28,
  // @ai-sdk/deepseek@3.0.22 — descriptions confirm each is the AI SDK
  // provider package for that vendor. These only widen import attribution
  // (which package a file's generateText/streamText call is backed by);
  // the actual call site is always generateText/streamText/etc. from the
  // 'ai' package itself, already covered below.
  {
    packageNames: [
      'ai', '@ai-sdk/openai', '@ai-sdk/anthropic', '@ai-sdk/google',
      '@ai-sdk/groq', '@ai-sdk/mistral', '@ai-sdk/amazon-bedrock',
      '@ai-sdk/google-vertex', '@ai-sdk/cohere', '@ai-sdk/xai', '@ai-sdk/deepseek',
    ],
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
    allowImportFallback: true,
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

// Resource-exhaustion caps for untrusted source trees (SEC-012). A repo
// reached via `navgator scan-remote` controls its own file contents; without
// caps a single huge or single-line file can hang or OOM the scan.
export const MAX_FILE_SIZE_BYTES = 1_048_576; // 1 MiB
export const MAX_LINE_LENGTH = 4_096;

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
          // `\{([^}]+)\}`, not `\{\s*([^}]+)\s*\}`: since \s ⊂ [^}] the
          // variants match the same lines (consumers trim the capture), but
          // the \s*/[^}]+ overlap backtracks super-linearly on `{`+spaces
          // runs — measured 247s on ONE 8KB line (SEC-012).
          new RegExp(`import\\s+(?:(?:\\{([^}]+)\\})|(?:(\\w+)))\\s+from\\s+['"]${escapeRegex(pkg)}['"]`)
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
          // Same de-overlap as the static-import pattern above (SEC-012).
          new RegExp(`(?:const|let|var)\\s+(?:\\{([^}]+)\\}|(\\w+))\\s*=\\s*(?:await\\s+)?import\\s*\\(\\s*['"]${escapeRegex(pkg)}['"]`)
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

  // Implicit singleton clients: SDKs that ship an already-usable default
  // export (e.g. `import ollama from 'ollama'`) with no `new ClassName()`
  // step. Register the imported binding itself as a client, skipping names
  // that are actually the `new`-able class (those are handled above).
  for (const imp of imports) {
    const sdk = SDK_DEFINITIONS.find(s => s.providerName === imp.providerName && s.packageNames.includes(imp.sdk));
    if (!sdk?.implicitSingletonClient) continue;
    for (const name of imp.importedNames) {
      if (sdk.classNames.includes(name)) continue;
      inits.push({
        file,
        line: imp.line,
        variableName: name,
        sdk: imp.sdk,
        providerName: imp.providerName,
        className: name,
      });
    }
  }

  return inits;
}

// =============================================================================
// PASS 2: FIND API CALL ANCHORS
// =============================================================================

/**
 * Derives the receiver-matching regex for a CallPattern from the pattern
 * itself, instead of a hand-written regex that can silently drift out of
 * sync with the call-pattern table (the root cause of the OpenAI/Groq
 * `chat.completions.create` miss: the old hand-written alternation greedily
 * consumed `.chat` as the "one optional segment", leaving `completions` as
 * the captured receiver's method — `openai.chat` was captured instead of
 * `openai`).
 *
 * Every `requiresClientVar` pattern's source begins with `\.` (it matches
 * `.method(` on the *receiver's* trailing edge), so prefixing a receiver
 * capture group reproduces the exact per-pattern receiver: leftmost-match
 * regex semantics give `openai` for `openai.chat.completions.create(` and
 * `this.client` for `this.client.chat.completions.create(`, because the
 * capture group is greedy but the fixed suffix anchors where it must stop.
 *
 * Compiled once per CallPattern and cached — this runs per line per pattern
 * over an entire repo scan, so must not be compiled inside the inner loop.
 *
 * `\??` between the receiver capture and the pattern handles optional
 * chaining (`openai?.chat.completions.create(`) without widening the
 * capture group itself — `openai` is still what gets captured, the `?.` is
 * just consumed and discarded. A computed (`clients[0].chat...`) or
 * call-expression (`getClient().chat...`) receiver is deliberately left
 * unmatched: neither can ever resolve against `clientVars` (which is keyed
 * on plain identifiers and `this.<prop>`), so matching them would only
 * produce an anchor with an unresolvable receiver — see the KNOWN GAPS note
 * above SDK_DEFINITIONS.
 */
const receiverRegexCache = new Map<CallPattern, RegExp>();
function getReceiverRegex(cp: CallPattern): RegExp {
  let re = receiverRegexCache.get(cp);
  if (!re) {
    re = new RegExp(`((?:this\\.)?[A-Za-z_$][\\w$]*)\\??${cp.pattern.source}`);
    receiverRegexCache.set(cp, re);
  }
  return re;
}

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
          // OOP style: find the variable calling the method. Receiver regex
          // is derived from this exact cp.pattern (see getReceiverRegex) so
          // it can never disagree with the pattern that just matched.
          const receiverRe = getReceiverRegex(cp);
          const varMatch = line.match(receiverRe);
          if (!varMatch) continue;

          const callerVar = varMatch[1];

          // Check if this variable is a known client (also handles the
          // implicit-singleton-client case: e.g. `ollama` from
          // `import ollama from 'ollama'` is pre-registered as a ClientInit)
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

          // Import-gate fallback: some SDK shapes call the method on a value
          // *derived* from the client (LangChain chains; the legacy Google
          // SDK's `genAI.getGenerativeModel(...)` → `model.generateContent()`),
          // so the receiver is never a registered ClientInit. Gate on the
          // file having an import from this SDK to keep the false-positive
          // rate bounded — same trade-off the original LangChain-only
          // special case made, generalized to any SDKDefinition that opts in.
          if (sdk.allowImportFallback) {
            const hasSdkImport = imports.some(imp => imp.providerName === sdk.providerName);
            if (hasSdkImport) {
              const funcName = extractFunctionName(lines, i);
              anchors.push({
                file,
                line: i + 1,
                code: line.trim().slice(0, 120),
                method: cp.method,
                clientVariable: callerVar,
                providerName: sdk.providerName,
                sdk: imports.find(imp => imp.providerName === sdk.providerName)?.sdk || sdk.packageNames[0],
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

export async function traceLLMCalls(
  projectRoot: string,
  walkSet?: Set<string>
): Promise<LLMTraceResult> {
  const allSourceFiles = await glob('**/*.{ts,tsx,js,jsx,mjs,cjs,py}', {
    cwd: projectRoot,
    ignore: [
      'node_modules/**', 'dist/**', 'build/**', '.next/**',
      '__pycache__/**', 'venv/**', '**/node_modules/**', '**/.git/**',
    ],
  });
  // Walk-set restriction (incremental mode). Bit-identical when undefined.
  const sourceFiles = walkSet
    ? allSourceFiles.filter(f => walkSet.has(f))
    : allSourceFiles;

  // Read all source files
  const fileContents = new Map<string, { content: string; lines: string[] }>();
  for (const file of sourceFiles) {
    if (shouldExcludeFile(file)) continue;
    const filePath = path.join(projectRoot, file);
    try {
      const stat = await fs.promises.stat(filePath);
      if (!stat.isFile() || stat.size > MAX_FILE_SIZE_BYTES) continue;
      const content = await fs.promises.readFile(filePath, 'utf-8');
      // Blank (don't drop) over-long lines so indexes still map to real line
      // numbers; a >4KB single line is generated or hostile, never a
      // hand-written import site, and the per-line regexes below must never
      // see it.
      const lines = content
        .split('\n')
        .map(line => (line.length > MAX_LINE_LENGTH ? '' : line));
      fileContents.set(file, { content, lines });
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
