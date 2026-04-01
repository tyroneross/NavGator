/**
 * LLM Use Case Deduplication
 *
 * Transforms raw LLM service-call connections (often 100+) into distinct
 * use cases (typically 5-15) by filtering noise and grouping by purpose.
 *
 * 3-layer pipeline:
 *   Layer 1 — Filter: remove test/dev, import-only, duplicates
 *   Layer 2 — Group: prompt match → function name → callType+model → file fallback
 *   Layer 3 — Merge: combine groups connected via import graph
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ArchitectureComponent, ArchitectureConnection } from './types.js';
import type { DetectedPrompt } from './scanners/prompts/types.js';

// =============================================================================
// TYPES
// =============================================================================

export interface LLMUseCase {
  name: string;
  category?: string;
  provider: string;
  model?: string;
  primaryFile: string;
  callSites: number;
  productionCallSites: number;
  groupedBy: 'prompt' | 'function' | 'calltype' | 'file';
  /** Feature domain from features.yaml or directory inference */
  feature?: string;
  /** Downstream connections — what this LLM call feeds into (for agent classification) */
  feedsInto?: string[];
}

export interface LLMDedupResult {
  useCases: LLMUseCase[];
  totalCallSites: number;
  productionCallSites: number;
  providers: string[];
}

// =============================================================================
// HELPERS
// =============================================================================

function isMeaningfulSymbol(symbol: string): boolean {
  if (!symbol || symbol.length <= 2) return false;
  if (symbol === 'default') return false;
  if (symbol.startsWith('./') || symbol.startsWith('/') || symbol.startsWith('..')) return false;
  // Generic symbols that don't indicate purpose
  if (['module', 'exports', 'require', 'import'].includes(symbol)) return false;
  // Generic method names — too common to indicate a distinct use case
  if (['create', 'call', 'invoke', 'run', 'execute', 'send', 'post', 'get', 'fetch',
       'from', 'init', 'setup', 'config', 'use', 'with', 'wrap', 'log', 'emit',
       'on', 'off', 'set', 'add', 'remove', 'update', 'delete', 'load', 'save',
       'start', 'stop', 'open', 'close', 'connect', 'disconnect',
       'enabled', 'disabled', 'model', 'capture', 'samplingRate',
       'tracing_enabled', 'langsmith_enabled',
      ].includes(symbol)) return false;
  // Provider/class names — these indicate WHO is called, not WHY
  const providerNames = [
    'openai', 'anthropic', 'groq', 'cohere', 'mistral', 'replicate',
    'chatopenai', 'chatgroq', 'chatanthropic', 'chatmistral',
    'langsmith', 'langchain',
  ];
  if (providerNames.includes(symbol.toLowerCase())) return false;
  // Anonymous/auto-generated function names
  if (/^anonymous_\d+$/.test(symbol)) return false;
  // Common wrapper names that don't indicate purpose
  if (['traceable', 'fromZodSchema', 'withRetry'].includes(symbol)) return false;
  return true;
}

const PURPOSE_PATTERNS: [RegExp, string][] = [
  [/summar/i, 'summarization'],
  [/embed/i, 'embedding'],
  [/extract/i, 'extraction'],
  [/classif|categor|label/i, 'classification'],
  [/rerank|rank/i, 'reranking'],
  [/search|query|retriev/i, 'search'],
  [/generat|creat|produc/i, 'generation'],
  [/translat/i, 'translation'],
  [/chat|convers|dialog/i, 'chat'],
  [/agent|tool|function.?call/i, 'agent'],
  [/fallback|retry|backup/i, 'fallback'],
  [/validat|verif/i, 'validation'],
  [/analyz|analys/i, 'analysis'],
  [/theme|topic|cluster/i, 'theme-extraction'],
  [/entity|ner|relation/i, 'entity-extraction'],
  [/trend|forecast/i, 'trend-analysis'],
  [/synthe[sz]/i, 'synthesis'],
  [/chunk/i, 'chunking'],
];

// Directory-to-domain mapping for purpose inference
const DIRECTORY_DOMAINS: [RegExp, string][] = [
  [/\/search\//i, 'search'],
  [/\/synthesis\//i, 'synthesis'],
  [/\/knowledge-graph\//i, 'knowledge-graph'],
  [/\/kg\//i, 'knowledge-graph'],
  [/\/queue\//i, 'queue-processing'],
  [/\/queues\//i, 'queue-processing'],
  [/\/workers?\//i, 'worker'],
  [/\/ai\//i, 'ai-core'],
  [/\/llm\//i, 'ai-core'],
  [/\/services\//i, 'service'],
  [/\/adapters?\//i, 'adapter'],
  [/\/ingestion\//i, 'ingestion'],
  [/\/aggregation\//i, 'aggregation'],
  [/\/analytics?\//i, 'analytics'],
];

function inferPurpose(functionName: string, fileName: string): string | undefined {
  // Layer 1: Check function name (strongest signal)
  for (const [pattern, purpose] of PURPOSE_PATTERNS) {
    if (pattern.test(functionName)) return purpose;
  }
  // Layer 2: Check file basename
  const basename = fileName.split('/').pop()?.replace(/\.[^.]+$/, '') || '';
  for (const [pattern, purpose] of PURPOSE_PATTERNS) {
    if (pattern.test(basename)) return purpose;
  }
  // Layer 3: Directory inference (domain-level grouping)
  for (const [pattern, domain] of DIRECTORY_DOMAINS) {
    if (pattern.test(fileName)) return domain;
  }
  return undefined;
}

/**
 * Load feature annotations from .navgator/features.yaml if present.
 * Returns a map of file glob → feature name.
 */
export function loadFeatureAnnotations(projectRoot: string): Map<string, string> | null {
  const featuresPath = path.join(projectRoot, '.navgator', 'features.yaml');
  try {
    const content = fs.readFileSync(featuresPath, 'utf-8');
    const features = new Map<string, string>();
    // Simple YAML parser for our format:
    // feature-name:
    //   files: [glob1, glob2]
    let currentFeature = '';
    let inFiles = false;
    for (const line of content.split('\n')) {
      const featureMatch = line.match(/^(\S+):\s*$/);
      if (featureMatch) {
        currentFeature = featureMatch[1];
        inFiles = false;
        continue;
      }
      if (line.trim() === 'files:' || line.trim().startsWith('files:')) {
        inFiles = true;
        // Check inline: files: [glob1, glob2]
        const inlineMatch = line.match(/files:\s*\[([^\]]+)\]/);
        if (inlineMatch) {
          for (const glob of inlineMatch[1].split(',')) {
            features.set(glob.trim().replace(/['"]/g, ''), currentFeature);
          }
          inFiles = false;
        }
        continue;
      }
      if (inFiles && line.trim().startsWith('- ')) {
        const glob = line.trim().slice(2).replace(/['"]/g, '').trim();
        if (glob && currentFeature) {
          features.set(glob, currentFeature);
        }
      } else if (inFiles && !line.trim().startsWith('-') && line.trim().length > 0) {
        inFiles = false;
      }
    }
    return features.size > 0 ? features : null;
  } catch {
    return null; // No features.yaml
  }
}

function parseDescriptionForCallType(description?: string): { method?: string; model?: string } | null {
  if (!description) return null;
  // Common formats: "OpenAI.chat.completions.create (gpt-4)", "Groq.chat (llama-3.1-70b)"
  const match = description.match(/\.(\w+(?:\.\w+)*?)(?:\s*\(([^)]+)\))?$/);
  if (!match) return null;
  const method = match[1]; // e.g., "chat.completions.create" or "chat"
  const model = match[2]?.trim();
  if (!method) return null;
  return { method, model };
}

function mostCommonFile(conns: ArchitectureConnection[]): string {
  const counts = new Map<string, number>();
  for (const c of conns) {
    const f = c.code_reference.file;
    counts.set(f, (counts.get(f) || 0) + 1);
  }
  let best = '';
  let bestCount = 0;
  for (const [f, count] of counts) {
    if (count > bestCount) { best = f; bestCount = count; }
  }
  return best || conns[0]?.code_reference.file || 'unknown';
}

function fileBasename(filepath: string): string {
  const parts = filepath.split('/');
  const file = parts[parts.length - 1] || filepath;
  return file.replace(/\.[^.]+$/, ''); // strip extension
}

// =============================================================================
// MAIN FUNCTION
// =============================================================================

export function deduplicateLLMUseCases(
  components: ArchitectureComponent[],
  connections: ArchitectureConnection[],
  prompts?: DetectedPrompt[],
): LLMDedupResult {
  // Step 1: Find LLM components
  const llmComponents = components.filter(c => c.type === 'llm');
  const llmIds = new Set(llmComponents.map(c => c.component_id));
  const llmNameById = new Map(llmComponents.map(c => [c.component_id, c.name]));

  if (llmIds.size === 0) {
    return { useCases: [], totalCallSites: 0, productionCallSites: 0, providers: [] };
  }

  // Step 2: Get all LLM connections
  const allLLMConns = connections.filter(c => llmIds.has(c.to.component_id));
  const totalCallSites = allLLMConns.length;

  if (totalCallSites === 0) {
    return { useCases: [], totalCallSites: 0, productionCallSites: 0, providers: llmComponents.map(c => c.name) };
  }

  // =========================================================================
  // LAYER 1: Filter
  // =========================================================================

  // 1a. Remove test/dev-only/migration
  let filtered = allLLMConns.filter(c => {
    const cls = c.semantic?.classification;
    return cls !== 'test' && cls !== 'dev-only' && cls !== 'migration';
  });

  // 1b. Remove import-only (import with no sibling call from same file+provider)
  const hasCallFromFileProvider = new Set<string>();
  for (const c of filtered) {
    if (c.code_reference.symbol_type !== 'import') {
      hasCallFromFileProvider.add(`${c.code_reference.file}|${c.to.component_id}`);
    }
  }
  filtered = filtered.filter(c => {
    if (c.code_reference.symbol_type !== 'import') return true;
    // Keep import only if there's a sibling call from same file to same provider
    return hasCallFromFileProvider.has(`${c.code_reference.file}|${c.to.component_id}`);
  });

  // 1c. Deduplicate same (file, symbol, target)
  const seen = new Set<string>();
  filtered = filtered.filter(c => {
    const key = `${c.code_reference.file}|${c.code_reference.symbol}|${c.to.component_id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const productionCallSites = filtered.length;

  // =========================================================================
  // LAYER 2: Group by purpose
  // =========================================================================

  interface Group {
    name: string;
    category?: string;
    model?: string;
    groupedBy: 'prompt' | 'function' | 'calltype' | 'file';
    providerIds: Set<string>;
    connections: ArchitectureConnection[];
  }

  const groups = new Map<string, Group>();

  function getOrCreateGroup(key: string, defaults: Omit<Group, 'providerIds' | 'connections'>): Group {
    if (!groups.has(key)) {
      groups.set(key, { ...defaults, providerIds: new Set(), connections: [] });
    }
    return groups.get(key)!;
  }

  for (const conn of filtered) {
    let assigned = false;

    // Priority 1: Prompt match
    if (prompts && prompts.length > 0) {
      const matchedPrompt = prompts.find(p => {
        // Match by file + line proximity
        if (p.location.file === conn.code_reference.file) {
          const connLine = conn.code_reference.line_start || 0;
          if (Math.abs(p.location.lineStart - connLine) < 30) return true;
        }
        // Match by usedBy
        if (p.usedBy.some(u => u.file === conn.code_reference.file)) return true;
        return false;
      });

      if (matchedPrompt) {
        const key = `prompt:${matchedPrompt.name}`;
        const group = getOrCreateGroup(key, {
          name: matchedPrompt.name,
          category: matchedPrompt.category,
          groupedBy: 'prompt',
        });
        group.providerIds.add(conn.to.component_id);
        group.connections.push(conn);
        assigned = true;
      }
    }

    // Priority 2: Function name (with purpose inference from name + file)
    if (!assigned && isMeaningfulSymbol(conn.code_reference.symbol)) {
      const purpose = inferPurpose(conn.code_reference.symbol, conn.code_reference.file);
      const key = `fn:${conn.code_reference.symbol}|${conn.to.component_id}`;
      const group = getOrCreateGroup(key, {
        name: conn.code_reference.symbol,
        category: purpose,
        groupedBy: 'function',
      });
      group.providerIds.add(conn.to.component_id);
      group.connections.push(conn);
      assigned = true;
    }

    // Priority 3: CallType + Model from description
    if (!assigned) {
      const parsed = parseDescriptionForCallType(conn.description);
      if (parsed?.method) {
        const providerName = llmNameById.get(conn.to.component_id) || 'unknown';
        const key = `ct:${parsed.method}|${parsed.model || ''}|${conn.to.component_id}`;
        const group = getOrCreateGroup(key, {
          name: `${parsed.method} via ${providerName}`,
          model: parsed.model,
          groupedBy: 'calltype',
        });
        group.providerIds.add(conn.to.component_id);
        group.connections.push(conn);
        assigned = true;
      }
    }

    // Priority 4: Provider fallback — try directory inference before giving up
    if (!assigned) {
      const dirPurpose = inferPurpose('', conn.code_reference.file);
      const providerName = llmNameById.get(conn.to.component_id) || 'unknown';

      if (dirPurpose) {
        // Directory inference succeeded — group by purpose + provider
        const key = `dir:${dirPurpose}|${conn.to.component_id}`;
        const group = getOrCreateGroup(key, {
          name: `${providerName} ${dirPurpose}`,
          category: dirPurpose,
          groupedBy: 'file',
        });
        group.providerIds.add(conn.to.component_id);
        group.connections.push(conn);
        assigned = true;
      }
    }

    // Priority 5: Pure provider fallback
    if (!assigned) {
      const providerName = llmNameById.get(conn.to.component_id) || 'unknown';
      const key = `provider:${conn.to.component_id}`;
      const group = getOrCreateGroup(key, {
        name: `${providerName} (uncategorized)`,
        groupedBy: 'file',
      });
      group.providerIds.add(conn.to.component_id);
      group.connections.push(conn);
    }
  }

  // =========================================================================
  // BUILD RESULT
  // =========================================================================

  const useCases: LLMUseCase[] = [];

  for (const group of groups.values()) {
    // Resolve provider name from the most common provider in group
    const providerCounts = new Map<string, number>();
    for (const pid of group.providerIds) {
      providerCounts.set(pid, (providerCounts.get(pid) || 0) + 1);
    }
    let mainProviderId = '';
    let maxCount = 0;
    for (const [pid, count] of providerCounts) {
      if (count > maxCount) { mainProviderId = pid; maxCount = count; }
    }
    const providerName = llmNameById.get(mainProviderId) || 'unknown';

    // Find what the LLM call's file connects to downstream (for agent classification)
    const primaryFileId = `FILE:${mostCommonFile(group.connections)}`;
    const downstream = connections
      .filter(c => c.from.component_id === primaryFileId && !llmIds.has(c.to.component_id))
      .map(c => {
        const target = components.find(comp => comp.component_id === c.to.component_id);
        return target ? `${target.name} (${target.type})` : c.to.component_id;
      })
      .filter((v, i, a) => a.indexOf(v) === i) // deduplicate
      .slice(0, 5); // limit to 5

    useCases.push({
      name: group.name,
      category: group.category,
      provider: providerName,
      model: group.model,
      primaryFile: mostCommonFile(group.connections),
      callSites: group.connections.length,
      productionCallSites: group.connections.length,
      groupedBy: group.groupedBy,
      feedsInto: downstream.length > 0 ? downstream : undefined,
    });
  }

  // Sort by productionCallSites descending
  useCases.sort((a, b) => b.productionCallSites - a.productionCallSites);

  // Collect unique provider names
  const providers = [...new Set(useCases.map(u => u.provider))].filter(p => p !== 'unknown');

  return { useCases, totalCallSites, productionCallSites, providers };
}
