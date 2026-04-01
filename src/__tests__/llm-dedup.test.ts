import { describe, it, expect } from 'vitest';
import { deduplicateLLMUseCases } from '../llm-dedup.js';
import { createMockComponent, createMockConnection } from './helpers.js';
import type { DetectedPrompt } from '../scanners/prompts/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function llmComp(name: string) {
  return createMockComponent({
    name,
    type: 'llm',
    component_id: `COMP_llm_${name.toLowerCase()}_test`,
    role: { purpose: `${name} AI API`, layer: 'external', critical: true },
  });
}

function llmConn(
  fromFile: string,
  symbol: string,
  toId: string,
  opts: {
    classification?: string;
    symbolType?: 'import' | 'function' | 'method' | 'variable';
    description?: string;
    lineStart?: number;
  } = {},
) {
  return createMockConnection(`FILE:${fromFile}`, toId, {
    connection_type: 'service-call',
    from: { component_id: `FILE:${fromFile}`, location: { file: fromFile, line: opts.lineStart || 10 } },
    code_reference: {
      file: fromFile,
      symbol,
      symbol_type: opts.symbolType || 'function',
      line_start: opts.lineStart || 10,
    },
    semantic: opts.classification
      ? { classification: opts.classification as any, confidence: 0.9 }
      : undefined,
    description: opts.description,
  });
}

function minimalPrompt(name: string, file: string, lineStart: number, opts: { category?: string } = {}): DetectedPrompt {
  return {
    id: `PROMPT_${name}`,
    name,
    location: { file, lineStart, lineEnd: lineStart + 5 },
    messages: [{ role: 'system', content: 'test' }],
    rawContent: 'test',
    isTemplate: false,
    variables: [],
    usedBy: [],
    tags: [],
    category: opts.category as any,
    confidence: 0.9,
    detectionMethod: 'regex',
    timestamp: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('deduplicateLLMUseCases', () => {
  const openai = llmComp('OpenAI');
  const groq = llmComp('Groq');

  // Layer 1: Filtering

  it('filters out test-classified connections', () => {
    const conns = [
      llmConn('src/api.ts', 'callAI', openai.component_id),
      llmConn('src/test.ts', 'callAI', openai.component_id, { classification: 'test' }),
      llmConn('src/dev.ts', 'callAI', openai.component_id, { classification: 'dev-only' }),
    ];
    const result = deduplicateLLMUseCases([openai], conns);
    expect(result.totalCallSites).toBe(3);
    expect(result.productionCallSites).toBe(1);
    expect(result.useCases).toHaveLength(1);
  });

  it('filters out import-only connections without sibling call', () => {
    const conns = [
      // Import only — no call from this file → should be removed
      llmConn('src/unused.ts', 'openai', openai.component_id, { symbolType: 'import' }),
      // Import + call from same file → import filtered, call kept
      llmConn('src/used.ts', 'openai', openai.component_id, { symbolType: 'import' }),
      llmConn('src/used.ts', 'generateText', openai.component_id),
    ];
    const result = deduplicateLLMUseCases([openai], conns);
    expect(result.productionCallSites).toBe(2); // import kept (has sibling) + call
    expect(result.useCases.length).toBeGreaterThanOrEqual(1);
  });

  it('deduplicates same file+symbol+provider', () => {
    const conns = [
      llmConn('src/ai.ts', 'summarize', openai.component_id),
      llmConn('src/ai.ts', 'summarize', openai.component_id), // exact duplicate
    ];
    const result = deduplicateLLMUseCases([openai], conns);
    expect(result.totalCallSites).toBe(2);
    expect(result.productionCallSites).toBe(1);
  });

  // Layer 2: Grouping

  it('groups by prompt name when prompt matches by file proximity', () => {
    const conns = [
      llmConn('src/services/summarize.ts', 'x', openai.component_id, { lineStart: 50 }),
      llmConn('src/workers/batch.ts', 'y', openai.component_id, { lineStart: 20 }),
    ];
    const prompt1 = minimalPrompt('summarize_article', 'src/services/summarize.ts', 45, { category: 'summarization' });
    // batch.ts is in prompt's usedBy
    prompt1.usedBy = [{ file: 'src/workers/batch.ts', line: 20, callPattern: 'openai.chat', isAsync: true, hasStreaming: false }];

    const result = deduplicateLLMUseCases([openai], conns, [prompt1]);
    expect(result.useCases).toHaveLength(1);
    expect(result.useCases[0].name).toBe('summarize_article');
    expect(result.useCases[0].groupedBy).toBe('prompt');
    expect(result.useCases[0].category).toBe('summarization');
  });

  it('groups by function name when no prompt linked', () => {
    const conns = [
      llmConn('src/api/route1.ts', 'extractEntities', openai.component_id),
      llmConn('src/api/route2.ts', 'extractEntities', openai.component_id),
      llmConn('src/workers/batch.ts', 'extractEntities', openai.component_id),
    ];
    const result = deduplicateLLMUseCases([openai], conns);
    expect(result.useCases).toHaveLength(1);
    expect(result.useCases[0].name).toBe('extractEntities');
    expect(result.useCases[0].groupedBy).toBe('function');
    expect(result.useCases[0].productionCallSites).toBe(3);
  });

  it('uses provider as fallback for generic symbols', () => {
    const conns = [
      llmConn('src/lib/ai.ts', 'x', openai.component_id), // symbol too short
      llmConn('src/lib/other.ts', 'y', openai.component_id), // also too short
    ];
    const result = deduplicateLLMUseCases([openai], conns);
    // Both should merge into one provider-level group
    expect(result.useCases).toHaveLength(1);
    expect(result.useCases[0].groupedBy).toBe('file');
    expect(result.useCases[0].name).toContain('OpenAI');
  });

  // Edge cases

  it('handles 0 LLM connections', () => {
    const result = deduplicateLLMUseCases([openai], []);
    expect(result.useCases).toHaveLength(0);
    expect(result.totalCallSites).toBe(0);
    expect(result.productionCallSites).toBe(0);
  });

  it('handles connections with no LLM components', () => {
    const nonLLM = createMockComponent({ name: 'react', type: 'npm' });
    const conns = [llmConn('src/app.ts', 'render', nonLLM.component_id)];
    const result = deduplicateLLMUseCases([nonLLM], conns);
    expect(result.useCases).toHaveLength(0);
  });

  it('returns correct totalCallSites vs productionCallSites', () => {
    const conns = [
      llmConn('src/a.ts', 'callA', openai.component_id),
      llmConn('src/b.ts', 'callB', openai.component_id),
      llmConn('src/c.ts', 'callC', openai.component_id, { classification: 'test' }),
      llmConn('src/d.ts', 'callD', openai.component_id, { classification: 'dev-only' }),
    ];
    const result = deduplicateLLMUseCases([openai], conns);
    expect(result.totalCallSites).toBe(4);
    expect(result.productionCallSites).toBe(2);
  });

  it('sorts use cases by productionCallSites descending', () => {
    const conns = [
      llmConn('src/a.ts', 'smallUseCase', openai.component_id),
      llmConn('src/b.ts', 'bigUseCase', groq.component_id),
      llmConn('src/c.ts', 'bigUseCase', groq.component_id),
      llmConn('src/d.ts', 'bigUseCase', groq.component_id),
    ];
    const result = deduplicateLLMUseCases([openai, groq], conns);
    expect(result.useCases.length).toBe(2);
    expect(result.useCases[0].name).toBe('bigUseCase');
    expect(result.useCases[0].productionCallSites).toBe(3);
    expect(result.useCases[1].name).toBe('smallUseCase');
  });
});
