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

- **`/navgator:scan`** — Refresh component and connection tracking.
- **`/navgator:plan`** — Delegate architecture-aware change planning to the planner agent.
- **`/navgator:feedback`** — Report a bug or send feedback about NavGator.

## Capability routing — no subcommand, load the skill

These capabilities have no slash command. Load the named skill and follow it.

- **Map components, connections, runtime topology, or LLM use cases; find outdated packages; show project structure** → load `architecture-scan`
- **Calculate blast radius before changing a component; trace data flow forward and backward** → load `impact-analysis`
- **Run an architectural integrity review; check drift on changes already made** → load `code-review`
- **Find orphaned components, unused packages, models, queues, or infrastructure; show database readers and writers** → load `infrastructure-scanning`
- **Show or export an architecture diagram** → load `architecture-export`
- **Install, update, or set up navgator; launch the dashboard; run the end-to-end integrity workflow** → load `navgator-setup`
- **List, search, promote, or manage architecture lessons** → run the `navgator` CLI directly (`navgator lessons`, `navgator lessons promote`)

## Examples

- User types `/navgator:gator` alone → list subcommands, ask for direction
- User types `/navgator:gator <free-form request>` → match intent, invoke subcommand
- User types `/navgator:<specific>` → bypass this router entirely (direct invocation)

## Rules

- Prefer the most specific subcommand match. If two could fit, ask which.
- Never invent a new subcommand. Only route to ones listed above.
- If the user is describing a workflow that spans multiple subcommands, outline the sequence and ask whether to proceed.
