---
name: trace
description: Trace data flow through the architecture — follow a component's connections from input to output
arguments:
  - name: component
    description: "Component name, file path, or API route to trace (e.g., 'Article', '/api/cron/refresh-rss', 'kg-summaries-groq')"
    required: true
---

Trace the data flow path for: **$ARGUMENTS**

## What to do

1. Run the navgator `trace` MCP tool with the component name
2. If the component is a cron job or API route, trace forward to show the full pipeline
3. If it's a database model or queue, trace both directions to show producers AND consumers
4. Present the trace as a readable pipeline:

```
/api/cron/refresh-rss [Vercel cron]
  → route.ts [backend]
  → rss-ingestion-service [service]
  → Article [database]
  → search-enhancement-queue [queue]
  → OpenAI [LLM provider]
```

5. Flag any anomalies in the trace (dead ends, duplicate consumers, missing connections)
6. If trace returns 0 paths, suggest the component might be orphaned or the data might need refreshing

**Tips:**
- Use `--production` to filter out test/script connections
- Use `--direction forward` or `--direction backward` for one-way traces
