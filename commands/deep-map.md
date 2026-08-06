---
name: deep-map
description: Tiered repo mapping — a deterministic scan isolates component groups, you fan out parallel agents to describe them, and a final pass hunts inefficiencies with evidence
arguments:
  - name: options
    description: "Optional: --tier 1,2,3 (default 1), --max-packets N (default 12), --max-deep N (default 4), --exclude <glob> (repeatable), --include-vendored"
    required: false
---

Map this repository in tiers, escalating only where the graph says it is worth it.

**Options:** $ARGUMENTS

## How this works

NavGator does the deterministic half and never calls a model. It splits the
scanned graph into isolated groups, writes one work packet per group with a
ready-to-send prompt, and later validates whatever you hand back. **You are the
model.** You dispatch the parallel agents; NavGator builds the harness and keeps
the results honest.

The division matters: a finding you return can never create, rename, or connect
a component. Anything naming something the scan did not find is rejected and
counted. The architecture graph stays valid whether or not this ever runs.

## What to do

### 1. Make sure tier 0 is current

Run `navgator scan --agent`. A non-zero exit code is a real failure — surface
stderr and stop. Tier 0 is the source of truth for what exists; everything below
is analysis layered on top of it.

### 2. Plan the packets

```
navgator deep-map plan --tier 1 --agent
```

Note the `run_id` it prints. Every later step takes `--run <that id>` so the
whole pipeline stays in one run — otherwise each `plan` mints a fresh run and
tier 3 sees only the most recent tier's findings.

Read the manifest it prints. Before dispatching anything, check two things:

- **`path_prefix` on each packet.** If a packet's prefix names vendored,
  generated, or build-output code (`web/runtime/packages/semver`,
  `third_party/...`), do not pay to describe it. Re-run `plan` with
  `--exclude '<that prefix>/**'`. NavGator reports the prefix rather than
  guessing, because a monorepo's own `packages/` directory looks identical from
  the outside.
- **`estimated_input_tokens`.** This is what the fan-out will cost you on input.
  If it is larger than you want to spend, lower `--max-packets`.

### 3. Fan out — one agent per packet, in parallel

Read each `packets/<packet_id>.json`. Dispatch one subagent per packet **in a
single message so they run concurrently**. Give each subagent only its own
packet's `prompt` field — not the whole repo, not the other packets. That
isolation is the point: a tier-1 agent needs its group and nothing else.

Use a fast, cheap model for tier 1. It is a wide, shallow pass.

Each subagent must return JSON matching the packet's `response_schema` exactly.
Write each result to `packets/<packet_id>.result.json` next to its packet.

### 4. Ingest

```
navgator deep-map ingest --run <run_id> --agent
```

Read the rejection list. Rejections are signal, not noise: a run with many
`unknown_component` rejections means the model was inventing components, and a
run with many `missing_evidence` rejections means it was asserting without
grounding. Either is a reason to distrust that tier's output, not to retry
blindly.

### 5. Escalate — only where the graph says so

```
navgator deep-map plan --tier 2 --run <run_id> --agent
```

Escalation is computed from the graph alone: centrality, how much a component
bridges across clusters, direction and reachability faults, LLM-call surface,
and size. Every escalated component prints the numbers that escalated it, so you
can disagree with the selection on evidence.

Dispatch these with a stronger model than tier 1 — there are at most four, and
they are the components where being wrong costs the most. Ingest as before.

### 6. Synthesise

```
navgator deep-map plan --tier 3 --run <run_id> --agent
```

One packet carrying the graph statistics, the escalation table, and every
finding ingested so far. Run it once, with your strongest model. Ask it for the
issues only visible across components. Ingest, then:

```
navgator deep-map report --run <run_id> --agent
```

### 7. Report to the user

Lead with the cost: packets planned, packets returned, estimated input tokens,
measured output bytes. Then the findings, grouped by component.

**Always mark model findings as model findings.** The report carries an
attribution note for exactly this reason. "The scanner found 14 connections into
`storage`" and "an agent thinks `storage` has too many responsibilities" are
different kinds of claim, and collapsing them is the failure mode this whole
design exists to prevent.

## Checking on a run

```
navgator deep-map status --run <run_id> --agent
```

Shows which packets have results and which do not. NavGator cannot tell whether
you actually dispatched the agents — this is how an un-run fan-out becomes
visible instead of silently reporting nothing.

## Cost control

Tier 1 only, by default. Tiers 2 and 3 require asking for them. `--max-packets`
defaults to 12 and `--max-deep` to 4; both truncate rather than silently
expanding, and the manifest says how many groups were dropped.

## When to use

- Understanding an unfamiliar repository beyond what the file tree shows
- Auditing an architecture for coupling and design problems, with evidence
- Before a large refactor, to find which components carry the most risk

## When not to use

- A quick structural question — `navgator status --agent` or
  `navgator explore <component> --agent` answers it for free
- A repo NavGator has not scanned; there is nothing to partition
