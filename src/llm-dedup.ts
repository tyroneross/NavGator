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
  return true;
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

    // Priority 2: Function name
    if (!assigned && isMeaningfulSymbol(conn.code_reference.symbol)) {
      const key = `fn:${conn.code_reference.symbol}|${conn.to.component_id}`;
      const group = getOrCreateGroup(key, {
        name: conn.code_reference.symbol,
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

    // Priority 4: File fallback
    if (!assigned) {
      const key = `file:${conn.code_reference.file}|${conn.to.component_id}`;
      const group = getOrCreateGroup(key, {
        name: fileBasename(conn.code_reference.file),
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

    useCases.push({
      name: group.name,
      category: group.category,
      provider: providerName,
      model: group.model,
      primaryFile: mostCommonFile(group.connections),
      callSites: group.connections.length, // within this group's filtered connections
      productionCallSites: group.connections.length,
      groupedBy: group.groupedBy,
    });
  }

  // Sort by productionCallSites descending
  useCases.sort((a, b) => b.productionCallSites - a.productionCallSites);

  // Collect unique provider names
  const providers = [...new Set(useCases.map(u => u.provider))].filter(p => p !== 'unknown');

  return { useCases, totalCallSites, productionCallSites, providers };
}
