---
name: navgator
description: Main navgator entry. Dispatches to a subcommand based on your request, or lists options if unclear. Use `navgator:<subcommand>` to target a specific action directly.
argument-hint: "[what you want to do]"
---

# /navgator — Router

Route this request to the appropriate navgator subcommand or skill based on the user's intent.

**Raw user input**: $ARGUMENTS

## Routing logic

1. If `$ARGUMENTS` is empty or only whitespace: list the available subcommands below and ask the user what they want to do.
2. Otherwise: match the user's natural-language request against the subcommand intents below and invoke the best match.
3. If the request clearly doesn't fit any subcommand but matches a `navgator` skill (listed in your available skills), load the skill and follow its guidance instead.
4. If nothing fits, say so and list the subcommands. Do NOT guess.

## Available subcommands

- **`/navgator:dead`** — Find dead code — orphaned components with no connections, unused packages, unuse
- **`/navgator:impact`** — Check what breaks if you change a component — blast radius analysis before modif
- **`/navgator:lessons`** — List, search, promote, and manage NavGator architecture lessons. Use when the us
- **`/navgator:llm-map`** — Map all LLM use cases — shows what each AI call does, which provider, and what i
- **`/navgator:map`** — Map the full architecture of this repository — components, connections, runtime 
- **`/navgator:review`** — Run architectural integrity review — checks system flow, component connections, 
- **`/navgator:scan`** — Quick architecture scan — refresh component and connection tracking
- **`/navgator:schema`** — Show which files read from and write to database models
- **`/navgator:test`** — End-to-end architecture test — verify that all components connect correctly, no 
- **`/navgator:trace`** — Trace data flow through the architecture — follow a component's connections from


## Examples

- User types `/navgator` alone → list subcommands, ask for direction
- User types `/navgator <free-form request>` → match intent, invoke subcommand
- User types `/navgator:<specific>` → bypass this router entirely (direct invocation)

## Rules

- Prefer the most specific subcommand match. If two could fit, ask which.
- Never invent a new subcommand. Only route to ones listed above.
- If the user is describing a workflow that spans multiple subcommands, outline the sequence and ask whether to proceed.
