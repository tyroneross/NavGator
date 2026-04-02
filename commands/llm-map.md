---
name: llm-map
description: Map all LLM use cases — shows what each AI call does, which provider, and what it connects to
arguments:
  - name: options
    description: "Optional: --provider groq (filter by provider), --category search (filter by purpose), --classify (show uncategorized for AI classification)"
    required: false
---

Map LLM use cases for this project.

**Options:** $ARGUMENTS

## What to do

1. Run `navgator llm-map` CLI command with any specified filters
2. Present the use case map grouped by purpose category (search, summarization, extraction, etc.)
3. For each use case, show: provider, primary file, what it feeds into downstream
4. If `--classify` was requested, read each uncategorized file and classify its purpose
5. Record any new classifications as lessons in `.navgator/lessons/lessons.json`

**Example output:**
```
SEARCH (3):
  Groq    lib/search/groq-reranker.ts → Article, search results
  OpenAI  lib/queue/search-enhancement-queue.ts → ArticleEmbedding

SUMMARIZATION (4):
  Groq    lib/ai/groq-summary-service.ts → Summary, Article
```
