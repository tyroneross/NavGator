---
name: lessons
description: List, search, promote, and manage NavGator architecture lessons. Use when the user asks about project or cross-project architectural patterns, lesson management, or promoting a lesson from one project to global scope.
---

# /navgator:lessons

NavGator lessons are architectural patterns recorded when a project hits a
notable issue or discovers a reusable approach. They live in two places:

- **Per-project** at `<project>/.navgator/lessons/lessons.json`
- **Global** at `~/.navgator/lessons/global-lessons.json`

Promotion moves a pattern from project-scoped to cross-project without deleting
the original — the local entry is marked `promoted: true` for traceability.

## What to do

Parse the user's intent, then run the matching `navgator lessons` CLI
subcommand and format the output. Always prefer the JSON/agent envelope for
downstream processing:

```bash
navgator lessons list --global --agent
navgator lessons search <query> --scope all --agent
navgator lessons show <id> --agent
navgator lessons promote <id> --tag <tag1> --tag <tag2>
navgator lessons demote <id>
```

## Common requests

| User says | Run |
|---|---|
| "show me cross-project lessons" | `lessons list --global` |
| "what did we learn about prisma" | `lessons search prisma --scope all` |
| "promote the BullMQ lesson to global" | `lessons promote <id> --tag bullmq` |
| "tell me about this specific lesson" | `lessons show <id>` |
| "list lessons for this project" | `lessons list` (current project) |
| "un-promote a lesson" | `lessons demote <id>` |

## Lesson categories

`api-contract`, `data-flow`, `component-communication`, `llm-architecture`,
`infrastructure`, `typespec`, `database-structure`

## Severity

`critical`, `important`, `minor`

## Tags (applies_to)

Free-form strings that describe which stacks/tools a global lesson applies to.
Common tags: `nextjs`, `prisma`, `bullmq`, `vercel`, `swiftui`, `openai`,
`anthropic`, `postgres`. Tags are searchable with `--tag`.

## When promoting

Always ask the user for `--tag` values if not given — tags are what make global
lessons discoverable later. A lesson with no tags becomes a needle in a
haystack at 50+ lessons.
