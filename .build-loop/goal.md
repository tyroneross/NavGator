# Goal — deep-map: tiered escalation mapping

<!-- run_id: bl-navgator-20260805-deep-map -->

> Supersedes the gator-memory goal (archived at
> `.build-loop/plans/2026-08-03-gator-memory-CLOSED.md`).

Add a tiered repo-mapping pipeline on top of NavGator's deterministic scan:
wide cheap pass over isolated component groups → selective deep pass over
escalated components → one frontier-tier synthesis that hunts inefficiencies.
NavGator owns the deterministic harness (partitioning, prompt construction,
schema validation, attribution, cost accounting); the calling agent owns every
LLM call.

## Success criteria

1. **G1 — Deterministic tier 0 stays the only source of truth for what exists.**
   No LLM SDK enters `dependencies`. No ingested finding can create, rename, or
   connect a component. Every finding referencing an unknown `component_id` is
   rejected and counted. Verified by: a hallucination probe test that feeds a
   fabricated component id and asserts rejection, shown failing with the guard
   disabled.

2. **G2 — The graph is valid with the LLM layer absent.** Deleting
   `.navgator/deep-map/` leaves every existing command working, and
   `deep-map report` returns `NO_DATA` (exit 2) rather than an error. Findings
   are never merged into `components.full.jsonl`, `connections.full.jsonl`, or
   `graph.json`. Verified by: a test that asserts byte-identical canonical
   records before and after a full plan → ingest → report cycle.

3. **G3 — Partitioning and escalation are deterministic and explainable.** The
   same graph produces the same packets and the same escalation set on repeat
   runs, and every escalated component carries the raw signal values that
   escalated it. Verified by: a repeat-run equality test over packet ids and a
   test asserting each escalation reason cites its numeric input.

4. **G4 — Cost is capped and reported, and nothing escalates silently.** Tier 1
   is capped at `--max-packets` (default 12), tier 2 at `--max-deep` (default 4),
   tier 2 and 3 require an explicit `--tier` flag, and the manifest reports
   estimated input tokens per packet and in total. Verified by: a cap-enforcement
   test on a graph that exceeds both caps, shown failing with the cap removed.

5. **G5 — Ingested LLM output is treated as data, never as instruction.**
   Strict schema validation, bounded string lengths, control-character
   stripping, no path escape from the run directory, and a remote-origin
   provenance warning carried into packets and report output. Verified by:
   malformed/oversized/path-escaping ingest tests.

6. **G6 — The surface is wired end to end.** `navgator deep-map
   plan|ingest|report|status` follows the existing `--json`/`--agent` envelope
   and exit-code contract; a `/navgator:deep-map` command tells the host agent
   how to fan out. Verified by: CLI exit-code tests plus a real demo run on this
   repo with measured cost.

## Non-goals

- Adding Python (or any other language) code-structure scanning. Assessed and
  deferred — see the plan's "multiple python scripts" section.
- Embedding, bundling, or shelling out to any LLM runtime.
- Re-wiring MCP. Re-pinning plugin manifest versions. Tagging or publishing.
