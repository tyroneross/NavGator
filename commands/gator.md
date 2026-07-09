---
name: gator
description: Main NavGator router. Dispatches to a subcommand based on your request, or lists options if unclear. Use `/navgator:<subcommand>` to target a specific action directly.
argument-hint: "[what you want to do]"
---

# /navgator:gator — Router

Route this request to the appropriate NavGator subcommand or skill based on the user's intent.

**Raw user input**: $ARGUMENTS

## Routing logic

1. If `$ARGUMENTS` is empty or only whitespace: list the available subcommands below and ask the user what they want to do.
2. Otherwise: match the user's natural-language request against the subcommand intents below and invoke the best match.
3. If the request clearly doesn't fit any subcommand but matches a NavGator skill (listed in your available skills), load the skill and follow its guidance instead.
4. If nothing fits, say so and list the subcommands. Do NOT guess.

## Available subcommands

- **`/navgator:dead`** — Find orphaned components and unused packages, models, queues, or infrastructure.
- **`/navgator:impact`** — Calculate blast radius before changing a component.
- **`/navgator:lessons`** — List, search, promote, and manage architecture lessons.
- **`/navgator:llm-map`** — Map LLM use cases by provider, purpose, and downstream connection.
- **`/navgator:map`** — Map components, connections, runtime topology, and LLM use cases.
- **`/navgator:plan`** — Delegate architecture-aware change planning to the planner agent.
- **`/navgator:promote-lesson`** — Find recurring cross-project lessons for promotion.
- **`/navgator:review`** — Run an architectural integrity review.
- **`/navgator:scan`** — Refresh component and connection tracking.
- **`/navgator:schema`** — Show database readers and writers.
- **`/navgator:test`** — Run the end-to-end architecture integrity workflow.
- **`/navgator:trace`** — Trace data flow forward and backward.


## Examples

- User types `/navgator:gator` alone → list subcommands, ask for direction
- User types `/navgator:gator <free-form request>` → match intent, invoke subcommand
- User types `/navgator:<specific>` → bypass this router entirely (direct invocation)

## Rules

- Prefer the most specific subcommand match. If two could fit, ask which.
- Never invent a new subcommand. Only route to ones listed above.
- If the user is describing a workflow that spans multiple subcommands, outline the sequence and ask whether to proceed.
