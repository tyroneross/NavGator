---
description: Plan an architecture change or investigation using NavGator (delegates to architecture-planner agent)
argument-hint: ["<intent>"]
allowed-tools: Read, Bash, Grep, Glob
---

<!--
Usage: /navgator:plan "<intent>"
Examples:
  /navgator:plan "review my auth flow"
  /navgator:plan "what breaks if I change checkout-handler"
  /navgator:plan "is the graph still fresh"
Requires: NavGator installed, .navgator/architecture/ exists (run /navgator:scan first if not)
-->

The user's intent: $ARGUMENTS

Dispatch the `architecture-planner` agent (defined in `agents/architecture-planner.md`) using the Task tool. Pass the user's intent verbatim as the agent's task. The planner will:

1. Check whether `.navgator/architecture/index.json` exists. If not, stop and recommend `/navgator:scan`.
2. Inspect `last_full_scan` and `incrementals_since_full` to decide whether the graph is fresh enough.
3. Run `navgator scan --incremental --json` if the graph is stale (no `--full`, no `--clear`).
4. Dispatch the right read-only NavGator MCP tools (`impact`, `trace`, `connections`, `review`, `dead`, `rules`, `llm-map`) based on the intent.
5. Aggregate findings into a structured report.

Do NOT run NavGator commands directly from this command — delegate to the agent. The agent has the full freshness-decision and tool-dispatch protocol.

If `$ARGUMENTS` is empty, ask the user what they want to plan or investigate, then re-invoke the agent with their answer.
