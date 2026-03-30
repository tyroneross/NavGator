# LLM Use Case Deduplication — Design Spec

## Problem

NavGator counts every `import` or `new OpenAI()` call as a separate "service call." A real project showed 154 connections but only ~8 distinct LLM use cases. The overcounting happens because:
- Same service imported in 5 script files = 5 connections
- Test files import the same services = more connections
- Scripts/ has standalone runners that re-import everything
- Some services are imported but never actively called

**Goal:** Show distinct LLM use cases grouped by purpose, not raw import/call counts.

## What Exists

NavGator already has all the data needed:

| Data Source | What It Provides |
|-------------|-----------------|
| `DetectedPrompt` (prompts.json) | name, category, messages, provider, location, usedBy[] |
| `TracedLLMCall` (llm-call-tracer) | callType, model, anchor (file/line/code), provider, prompt content |
| `service-call` connections | from (file/function), to (LLM component), semantic classification |
| `prompt-location` connections | where prompts are defined |
| Import scanner | file A imports from file B (local files only) |
| `semantic.classification` | production, test, dev-only, admin, analytics |

## Design: 3-Layer Dedup

### Layer 1: Filter (remove noise)

Before any grouping, filter out connections that aren't production LLM usage:

1. **Classification filter:** Remove connections with `semantic.classification` in `['test', 'dev-only', 'migration']`
2. **Import-only filter:** Remove connections where `code_reference.symbol_type === 'import'` and there's no corresponding call-site connection from the same file. An import without a call is not a use case.
3. **Duplicate file filter:** If the same function in the same file creates multiple connections to the same provider (e.g., re-scanning found it twice), keep only one.

### Layer 2: Group by Purpose (the core dedup)

Group remaining connections into "use cases" using this priority:

**Priority 1: Prompt-based grouping (strongest signal)**
- If a `service-call` connection is linked to a `DetectedPrompt` (matched by file + line proximity, or by the prompt scanner's `usedBy[]` field):
  - Use the prompt's `name` as the use case identifier
  - Use the prompt's `category` (summarization, extraction, embedding, etc.) as the use case type
  - Multiple files calling the same prompt = 1 use case

**Priority 2: Function-based grouping (good signal)**
- If no prompt is linked, group by `code_reference.symbol` (the function name)
- Same function called from different files = 1 use case
- Use case name = function name (e.g., `summarizeArticle`, `extractEntities`)

**Priority 3: CallType + Model grouping (fallback)**
- If no prompt and no named function, group by `(callType, model, provider)`
- E.g., all `embedding` calls to `text-embedding-3-small` on OpenAI = 1 use case
- Use case name = `{callType} via {provider}` (e.g., "embedding via OpenAI")

**Priority 4: File-based (last resort)**
- If nothing else works, each unique `(file, provider)` pair = 1 use case
- This is the current Layer 1 behavior — kept as fallback

### Layer 3: Merge via Import Graph

After Layer 2 grouping, check if any use cases should be merged:

- If use case A calls function `summarize()` from `src/services/ai.ts`
- And use case B is the `summarize()` function itself in `src/services/ai.ts`
- Merge them — they're the same use case viewed from caller vs callee

Implementation: for each Layer 2 group, check if its `from.component_id` (`FILE:src/api/route.ts`) has an import connection to another group's file. If the imported symbol matches the other group's function name, merge.

This only works for local imports (import scanner doesn't follow node_modules), which is fine — the interesting dedup is always within the project.

## Output

### Status Command (navgator status)

Replace current `(caller, provider)` pair counting with the 3-layer dedup:

```
AI/LLM:
  8 use cases across 3 providers (42 call sites filtered to production)
  Providers: OpenAI, Groq, LangChain

  Use Cases:
    summarization      Groq       src/services/summarize.ts
    entity-extraction  OpenAI     src/services/extract.ts
    embeddings         OpenAI     src/services/embed.ts
    search-routing     OpenAI     src/engines/search.ts
    theme-extraction   Groq       src/services/themes.ts
    relationship-map   LangChain  src/services/relations.ts
    trend-headlines    Groq       src/services/trends.ts
    tracing            LangSmith  src/lib/observability.ts
```

The use case table is only shown when `--verbose` is passed or there are ≤15 use cases. Otherwise just the summary line.

### JSON Output (navgator scan --json)

Add to the scan output stats:

```json
{
  "llm": {
    "total_call_sites": 154,
    "production_call_sites": 42,
    "distinct_use_cases": 8,
    "providers": ["OpenAI", "Groq", "LangChain"],
    "use_cases": [
      {
        "name": "summarization",
        "category": "summarization",
        "provider": "Groq",
        "model": "llama-3.1-70b",
        "primary_file": "src/services/summarize.ts",
        "call_sites": 3,
        "production_call_sites": 2,
        "grouped_by": "prompt"
      }
    ]
  }
}
```

## Implementation

### New file: `src/llm-dedup.ts`

Single module, ~150-200 lines. Exports one function:

```typescript
export interface LLMUseCase {
  name: string;
  category?: string;            // from prompt category or callType
  provider: string;             // provider name
  model?: string;               // model if known
  primaryFile: string;          // main file where this use case lives
  callSites: number;            // total connections (before filter)
  productionCallSites: number;  // after test/dev filter
  groupedBy: 'prompt' | 'function' | 'calltype' | 'file';  // which layer matched
}

export function deduplicateLLMUseCases(
  components: ArchitectureComponent[],
  connections: ArchitectureConnection[],
  prompts?: DetectedPrompt[]      // from prompts.json if available
): {
  useCases: LLMUseCase[];
  totalCallSites: number;
  productionCallSites: number;
  providers: string[];
}
```

**Algorithm:**

```
1. Filter connections to LLM targets only (to.component_id matches type='llm')
2. Layer 1: Remove test/dev-only, import-only, duplicates
3. Layer 2: For each remaining connection:
   a. Check if it matches a prompt (by file + line proximity to a DetectedPrompt)
      → Yes: assign to prompt's use case group
   b. Check if code_reference.symbol is a named function
      → Yes: assign to function-name use case group
   c. Check TracedLLMCall data for callType + model
      → Yes: assign to callType+model group
   d. Fallback: assign to file+provider group
4. Layer 3: Check import graph for merge opportunities
5. Return deduplicated use cases
```

### Changes to existing files

**`src/cli/index.ts`** — Replace current AI/LLM section (lines ~720-788) with call to `deduplicateLLMUseCases()`. Show summary line always, use case table with `--verbose`.

**`src/scanner.ts`** — After scan completes, if prompts were scanned, pass them to `deduplicateLLMUseCases()` and include results in scan output stats.

**No changes to:** connection creation, prompt detection, import scanning. The dedup is purely a presentation/analysis layer on top of existing data.

## Testing

### `src/__tests__/llm-dedup.test.ts`

```
describe('deduplicateLLMUseCases', () => {
  // Layer 1 tests
  it('filters out test-classified connections')
  it('filters out import-only connections (no call site)')
  it('deduplicates same file+provider connections')

  // Layer 2 tests
  it('groups by prompt name when prompt data available')
  it('groups by function name when no prompt linked')
  it('groups by callType+model as fallback')
  it('uses file+provider as last resort')

  // Layer 3 tests
  it('merges use cases connected via import graph')

  // Integration
  it('handles project with 0 LLM connections')
  it('handles project with prompts but no traced calls')
  it('correctly counts production vs total call sites')
})
```

## Verification

```bash
npm test
npx tsc --noEmit

# Run on a project with LLM usage
cd ~/Desktop/git-folder/some-llm-project
navgator scan --prompts --json | jq '.stats.llm'
navgator status  # should show use case summary
```
