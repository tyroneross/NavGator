---
description: "Export architecture to markdown or JSON"
allowed-tools: ["Bash", "Read", "Write"]
---

# NavGator Export

Export your project's architecture documentation to markdown or JSON format.

## Usage

```bash
npx @tyroneross/navgator export [format] [output-file]
```

## Formats

**Markdown (default):**
```bash
npx @tyroneross/navgator export md ARCHITECTURE.md
```

**JSON:**
```bash
npx @tyroneross/navgator export json architecture.json
```

## Markdown Output Example

```markdown
# Project Architecture

## Components

### Packages (npm)
- react (18.2.0) - UI framework
- next (14.0.0) - React framework
- @supabase/supabase-js (2.39.0) - Database client

### Infrastructure
- Railway - Deployment platform
- Docker - Containerization

### External Services
- Stripe - Payment processing
- OpenAI - AI/LLM integration

## Connections

### API → Database
| Endpoint | Table | File | Line |
|----------|-------|------|------|
| POST /api/users | users | src/api/users.ts | 45 |
| GET /api/orders | orders | src/api/orders.ts | 23 |

### Frontend → API
| Component | Endpoint | File | Line |
|-----------|----------|------|------|
| UserForm | POST /api/users | src/components/UserForm.tsx | 67 |

### AI Prompts
| Name | File | Line |
|------|------|------|
| summarize-article | src/prompts/summarize.ts | 12 |
```

## Options

- `--components-only`: Export only components, skip connections
- `--connections-only`: Export only connections
- `--graph`: Include mermaid diagram of connections
