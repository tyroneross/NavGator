# NavGator Knowledge Base — Cross-Project Architectural Intelligence

## Purpose

Accumulate reusable architectural knowledge across projects so NavGator can answer:
- "Which LLM should I use for reranking?" → answer with evidence and confidence
- "Is BullMQ the right queue for this scale?" → answer with thresholds and alternatives
- "What prompt pattern works for entity extraction?" → answer with tested templates

## Design Principles

1. **Cross-project** — lives at `~/.navgator/knowledge/`, not per-project
2. **Version-controlled** — every entry has a created date, last validated date, and source tier
3. **Periodically validated** — entries >6 months old flagged for re-research
4. **Queryable** — CLI command and MCP tool to search by topic
5. **Updatable** — new model releases invalidate old entries, user can override

## Storage Structure

```
~/.navgator/knowledge/
├── index.json                    ← Master index with categories and entry counts
├── llm/
│   ├── reranking.json           ← LLM selection for reranking
│   ├── embeddings.json          ← LLM selection for embeddings
│   ├── summarization.json       ← LLM selection for summarization
│   ├── extraction.json          ← Entity/data extraction
│   └── code-generation.json     ← Code generation
├── prompts/
│   ├── extraction-patterns.json ← Prompt patterns for extraction
│   ├── summarization-patterns.json
│   └── system-prompt-structure.json
├── architecture/
│   ├── queue-patterns.json      ← BullMQ vs SQS vs RabbitMQ
│   ├── database-patterns.json   ← Prisma vs Drizzle, Postgres vs Mongo
│   ├── deploy-patterns.json     ← Vercel vs Railway vs Docker
│   └── auth-patterns.json       ← NextAuth vs Clerk vs Auth0
├── anti-patterns/
│   ├── duplicate-consumers.json ← From atomize-ai: 2 workers on same queue
│   ├── orphaned-code.json       ← From atomize-ai: chart-spec-generator unused
│   └── raw-sql-blind-spots.json ← From atomize-ai: $queryRaw not detected
└── validations.json             ← Last validation run timestamps
```

## Entry Schema

```typescript
interface KnowledgeEntry {
  id: string;                     // e.g., "llm/reranking"
  title: string;                  // "LLM Selection for Search Reranking"
  category: 'llm' | 'prompts' | 'architecture' | 'anti-patterns';
  
  // The actual knowledge
  recommendation: string;         // What to do
  reasoning: string;              // Why
  alternatives: string[];         // Other options considered
  thresholds?: Record<string, string>; // When to use vs not use
  
  // Example
  example?: {
    project: string;              // "atomize-ai"
    implementation: string;       // How it was done
    result: string;               // What happened
  };
  
  // Provenance
  source: {
    tier: 'T1' | 'T2' | 'T3' | 'T4' | 'experience';
    reference?: string;           // URL or citation
    projects: string[];           // Projects this was learned from
  };
  
  // Lifecycle
  created: string;                // ISO date
  lastValidated: string;          // ISO date
  validationStatus: 'current' | 'stale' | 'superseded';
  supersededBy?: string;          // ID of replacement entry
  
  // Confidence
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  evidenceCount: number;          // How many projects confirmed this
}
```

## Example Entries

### llm/reranking.json
```json
{
  "id": "llm/reranking",
  "title": "LLM Selection for Search Reranking",
  "category": "llm",
  "recommendation": "Use Groq with Llama 3.1 70B for reranking. 3-5x faster than OpenAI GPT-4 for ranking tasks, comparable accuracy for top-10 reranking.",
  "reasoning": "Reranking is latency-sensitive (user waiting for search results). Groq's inference speed (300+ tokens/sec) makes it viable for real-time reranking. Accuracy difference vs GPT-4 is <5% for top-10 list reranking, which is acceptable for most search UIs.",
  "alternatives": [
    "OpenAI GPT-4o — higher accuracy but 5-10x slower, better for offline batch reranking",
    "Cohere Rerank API — purpose-built, no prompt engineering needed, but vendor lock-in",
    "Cross-encoder model (local) — fastest, no API cost, but requires GPU and model hosting"
  ],
  "thresholds": {
    "use_when": "Real-time search with <500ms latency requirement, top-10 to top-100 reranking",
    "dont_use_when": "Need highest possible accuracy (legal, medical), batch processing where latency doesn't matter"
  },
  "example": {
    "project": "atomize-ai",
    "implementation": "lib/search/groq-reranker.ts — Groq reranks search results from vector similarity search",
    "result": "Search latency reduced from 2.5s (OpenAI) to 0.8s (Groq) with <3% relevance score difference"
  },
  "source": {
    "tier": "experience",
    "projects": ["atomize-ai"]
  },
  "created": "2026-04-02",
  "lastValidated": "2026-04-02",
  "validationStatus": "current",
  "confidence": "MEDIUM",
  "evidenceCount": 1
}
```

### anti-patterns/duplicate-consumers.json
```json
{
  "id": "anti-patterns/duplicate-consumers",
  "title": "Multiple Workers Consuming Same Queue",
  "category": "anti-patterns",
  "recommendation": "Never have two independent worker processes consuming the same BullMQ queue unless explicitly designed for parallel processing with idempotent handlers.",
  "reasoning": "BullMQ distributes jobs round-robin to workers. Two workers = each gets ~50% of jobs. If both workers have different code (e.g., one is a legacy worker), jobs route unpredictably. If one worker crashes, the other silently picks up all traffic — looks fine until the crashed worker recovers and both compete again.",
  "alternatives": [
    "Use a single worker with concurrency setting for parallel processing",
    "Use separate queues if different processing logic is needed",
    "Use BullMQ's named processors for different job types on the same queue"
  ],
  "example": {
    "project": "atomize-ai",
    "implementation": "kg-summaries-groq consumed by both bullmq-summary-worker.ts and hybrid-queue-manager.ts",
    "result": "Railway resources wasted, jobs processed inconsistently. NavGator detected this via anomaly detection."
  },
  "source": {
    "tier": "experience",
    "projects": ["atomize-ai"]
  },
  "created": "2026-04-02",
  "lastValidated": "2026-04-02",
  "validationStatus": "current",
  "confidence": "HIGH",
  "evidenceCount": 1
}
```

## CLI Commands

### `navgator knowledge [topic]`
- Without topic: shows index of all knowledge entries by category
- With topic: searches entries and returns the best match
- `--add` flag: create new entry interactively (or from scan findings)
- `--validate` flag: check entries for staleness, trigger re-research

### `/gator:knowledge [topic]`
Slash command that queries the knowledge base and returns recommendations.

## How Knowledge Accumulates

### Automatic (from scans)
When NavGator scans a project and detects patterns:
1. Check if the pattern matches an existing knowledge entry
2. If yes: increment `evidenceCount`, add project to `source.projects`
3. If no and the pattern is novel: flag for user review ("NavGator detected a new pattern — want to save it?")

### From lessons
When a project lesson (`/gator:review learn "..."`) matches patterns seen in 3+ projects, promote it to the knowledge base automatically.

### Manual
User creates entries via `navgator knowledge --add` or directly edits the JSON files.

## Validation Cycle

### Automatic (on `/gator:review --validate`)
1. Check all entries with `lastValidated` > 6 months ago
2. For each stale entry: use WebSearch to verify the recommendation is still current
3. Update `validationStatus` to 'current' or 'superseded'
4. If superseded: create a new entry with updated recommendation

### Triggered by model releases
When a major model release is detected (new entry in knowledge base about a model), flag all entries referencing the old model for re-validation.

## Integration with NavGator Scan

### Pre-scan check
Before scanning a new project, read `index.json` to know what patterns to look for.

### Post-scan comparison
After scanning, compare detected patterns against knowledge base:
- "This project uses OpenAI for reranking — knowledge base suggests Groq would be 3x faster"
- "This project has 2 workers on the same queue — known anti-pattern"

### In `/gator:review`
Phase 2 (Connection Integrity) checks architecture against knowledge base patterns.

## Migration Path

Start with entries seeded from this session's findings on atomize-ai. As more projects are scanned, the knowledge base grows. After 5+ projects, patterns with `evidenceCount >= 3` are considered validated.
