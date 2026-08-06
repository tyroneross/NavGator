# Plan — deep-map: tiered escalation mapping

<!-- run_id: bl-navgator-20260805-deep-map -->
<!-- supersedes: .build-loop/plans/2026-08-03-gator-memory-CLOSED.md -->

## Headline

Add `navgator deep-map`, a four-tier repo-mapping pipeline that partitions the
deterministic graph into isolated work packets, lets the calling agent fan out
LLM analysis over them in parallel, and folds the returned findings back as an
attributed side-car layer that can never alter what the scanner found.

## Context

NavGator's scanner answers *what exists*: 507 components and 1465 connections on
this repo, plus PageRank centrality, Louvain communities, and fourteen rule
checks — all offline, reproducible, and free. It cannot answer *what a component
is for*, *whether a design is inefficient*, or *where the risky coupling is*.
That is a semantic question, and the regex/AST layer will never reach it.

The pipeline this adds is deterministic-first: tier 0 is the existing scan and
stays the sole authority on what exists. Tiers 1–3 are LLM passes whose output
lands in a separate store, attributed, schema-validated, and rejected outright
when it names anything tier 0 did not find.

## Architectural decision — how agents are spawned (RESOLVED, not deferred)

NavGator is a CLI with no Agent tool and no LLM SDK, and adding one is
prohibited. Three mechanisms were available:

| Option | Verdict |
|---|---|
| **A. Work-packet manifest; the calling agent fans out** | **Chosen.** NavGator emits deterministic packets with a ready-to-send prompt and a response schema; Claude Code / Codex dispatches its own subagents; NavGator ingests and validates. |
| B. Shell out to a local model (ollama) | Rejected for v1. Puts a nondeterministic process inside a deterministic engine, adds a runtime dependency, and duplicates a fan-out capability the host already has. |
| C. Embed an LLM SDK | Rejected outright — violates the offline-engine invariant. |

Option A is the only one that keeps the engine offline while still letting the
LLM tier exist, and it matches the standing "host agent is the LLM" preference:
NavGator builds the harness, the host supplies the intelligence. Because the
constraint and the preference both point the same way, this is a settled design
choice and not a decision needing the user.

The consequence worth naming: NavGator cannot *guarantee* the fan-out happens or
that any model was actually used. It can only guarantee that whatever comes back
is validated, attributed, and separable. `deep-map status` reports which packets
have results, so an un-run fan-out is visible rather than silent.

## Tier design (settled)

### Tier 0 — deterministic, always, free

The existing `navgator scan`. Produces components, connections, `file_map.json`,
`metrics.json` (PageRank + Louvain, fixed seed), and the fourteen `rules.ts`
checks. Nothing in this build changes it. It is the source of truth for what
exists and the only input to partitioning and escalation.

### Tier 1 — wide and cheap, parallel over isolated groups

**Isolation unit = Louvain community, internal components only.** This is the
graph's own answer to "what clusters together", it is already computed, and it
is reproducible under the fixed seed.

Real-data check on this repo drove two corrections to the naive design:

- 48 communities exist, but ~35 are singletons and six hold 442 of 507 nodes. A
  packet-per-community would emit mostly-empty work. **Fix:** communities below
  `--min-group` (default 3) are bundled into one `residual` packet.
- 70 of 507 nodes are external packages (`react`, `vitest`, `semver`) that no
  LLM needs to describe. **Fix:** packets carry internal `component`-type nodes
  only, matching what `getTopHotspots` already restricts to. Communities of 108
  and 91 internal nodes still exceed a cheap model's useful window, so a
  community above `--max-nodes-per-packet` (default 60) splits into parts
  ordered by PageRank descending, `stable_id` as tie-break.

On this repo that yields ~11 packets covering 437 internal components.

Fallback when `metrics.suppressed` (graphs under 20 nodes): partition by
`role.layer`.

**Packet input:** the component's own group — id, name, type, layer, file paths
from `file_map.json`, and the induced subgraph edges via `extractSubgraph`.
Never the whole repo, never file contents.

**Packet output (schema-enforced):** per component, a one-sentence `purpose`, up
to three `responsibilities`, up to three `concerns`, and a `confidence` in
`[0,1]`. Bounded lengths, no free-form essay.

### Tier 2 — deep, selective, parallel

Escalation is a pure function of tier 0, so it is cheap, reproducible, and
explainable.

**The signals must not double-count degree.** The obvious set — PageRank, plus
raw fan-in/fan-out, plus rule-violation count — is three measurements of one
quantity: PageRank is a degree-family centrality, and four of the fourteen
builtin rules (`hotspot-module` at fan-in ≥5, `high-fan-out` at fan-out ≥8,
`shallow-module` at fanOut/(fanIn+1), `single-point-of-failure` at >5 dependents)
are thresholded degree. Weighting all three would let one property carry 80% of
the score while the table claims it carries 30%. That would make the weights a
fiction.

So: degree is represented **once**, by PageRank. Raw fan-in/fan-out is
deliberately not a separate signal, and the degree-derived rules are excluded
from the violations count via an explicit `DEGREE_DERIVED_RULE_IDS` constant.
The remaining signals measure genuinely different properties:

| Signal | What it measures (distinct from the others) | Source | Weight |
|---|---|---|---|
| `centrality` | magnitude of structural importance | PageRank percentile, `metrics.json` | 0.30 |
| `bridge` | *shape*: share of a component's edges crossing a Louvain community boundary — a low-degree node joining two clusters is architecturally critical and invisible to centrality | `community_id` + connections | 0.20 |
| `violations` | *direction and reachability* faults: `layer-violation`, `circular-dependency`, `frontend-direct-db`, `database-no-backend`, `duplicate-resource-creation`, `transitively-dead` | `checkRules`, degree-derived ids excluded | 0.25 |
| `llm_density` | semantic surface, orthogonal to topology | outgoing `service-call` edges to `llm`-type nodes | 0.10 |
| `size` | mass — a large module with few edges is real and invisible to every signal above | distinct files via `file_map.json`, percentile | 0.15 |

Components scoring above `--escalate-threshold` (default 0.60) are escalated,
capped at `--max-deep` (default 4). Every escalated component carries its raw
signal values, so "why was this escalated" is answerable from numbers rather
than from the model's say-so. Weights are printed in the manifest.

Tier 2 packets add the component's full connection list with `file:symbol`
references and a wider `extractSubgraph` depth, and ask a different question:
specific inefficiencies and coupling risks with `file:symbol` evidence.

### Tier 3 — frontier synthesis, one packet

Requires ingested tier 1/2 findings; returns `NO_DATA` otherwise. One packet
carrying graph statistics, the rule-violation set, the escalation table with its
raw signals, and every ingested finding. Asks for issues that are only visible
across components.

**Falsifiability is enforced structurally, not requested politely.** Every tier-3
finding must carry a `component_id` present in tier 0 and at least one
`evidence[]` entry; findings failing either check are rejected at ingest and
counted. A model cannot land a vibe.

## Cost control

- Tiers 2 and 3 require an explicit `--tier`; the default is tier 1 only.
- `--max-packets` (default 12) and `--max-deep` (default 4) are hard caps; the
  planner truncates and reports the truncation rather than silently expanding.
- Every packet carries `estimated_input_tokens` (serialized prompt chars / 4);
  the manifest totals them. Ingest records returned output size.
- `deep-map report` prints packets planned, packets returned, estimated input
  tokens, measured output bytes, and rejection counts.

No dollar figures anywhere — token counts are measured, prices are not ours to
assert.

## "Multiple python scripts" — assessed, deferred

The user's phrasing most plausibly means *many parallel workers*, which is what
tiers 1–2 deliver. Read literally as *pluggable external structure-mappers*, it
is a genuine gap and a genuine hazard: Python code structure is not scanned today
(`src/scanners/packages/pip.ts` reads manifests only), so tier 0 is thin for a
Python repo — but a pluggable-script mechanism means executing arbitrary code
found near a scanned repo, which is a severe escalation of the `scan-remote`
threat model.

Recommendation: **not in this build.** Language coverage is a scanner feature
with its own security design, not a rider on the tiering feature. Logged as a
finding.

## Depends-on (reads-from)

Every path and contract the new code reads. Status is `verified` where this run
read the identifier or file directly, `unverified` where it was reported but not
re-read.

| Dependency | Contract used | Status |
|---|---|---|
| `.navgator/architecture/components.full.jsonl` | one `ArchitectureComponent` JSON per line | verified — read 507 records |
| `.navgator/architecture/connections.full.jsonl` | one `ArchitectureConnection` JSON per line | verified |
| `.navgator/architecture/metrics.json` | `MetricsReport { suppressed, metrics: ComponentMetric[] }`, `ComponentMetric { stable_id, component_id, name, pagerank_score, community_id }` | verified — read live file |
| `.navgator/architecture/file_map.json` | `{ schema_version, generated_at, files: Record<path, component_id> }` | unverified — reported shape, not re-read |
| `src/storage.ts` `loadAllComponents` / `loadAllConnections` | `(config?, projectRoot?) => Promise<T[]>` | verified — export signatures read |
| `src/subgraph.ts` `extractSubgraph` | `(components, connections, SubgraphOptions) => SubgraphResult` | verified — read source |
| `src/rules.ts` `checkRules` | `(components, connections, rules?) => RuleViolation[]`; `RuleViolation.component` is a component **name**, not an id | verified — export signatures read |
| `src/agent-output.ts` `wrapInEnvelope` | `(command, data, metadata?) => string`, sorted keys, `schema_version` from `config.ts` | verified — read source |
| `src/cli/exit-codes.ts` `EXIT_CODES` | `{SUCCESS:0, OPERATIONAL:1, NO_DATA:2, NOT_FOUND:3, USAGE:4}` | verified — read source |
| `src/config.ts` `getStoragePath` / `sanitizePath` | path resolution + path-escape guard | verified — export signatures read |
| `src/projects.ts` project registry `origin` | `{ kind: 'remote' \| ..., url }` for the provenance warning | unverified — reported by `scan-remote` mapping, not re-read |

`RuleViolation.component` carrying a **name** rather than an id is the one
join that can silently mismatch; the escalation code resolves it through the
component name index and counts unresolvable violations rather than dropping
them silently.

## Approach lenses

**Clean-sheet best answer.** A mapping pipeline of this shape would own its own
model calls, pick a model per tier, and measure real token spend — the escalation
loop closes tighter when the planner knows what each pass actually cost.

**Current-constraints answer.** NavGator must stay offline and dependency-free,
and the host already has a fan-out mechanism far better than anything shipped
here. So NavGator builds packets and validates returns; the host spends. Cost
reporting degrades from measured to estimated input tokens plus measured output
bytes.

**Bridge.** The packet/ingest boundary is a stable seam. If a local-model runner
is ever wanted, it becomes a separate opt-in executor that fills the same
`*.result.json` files — no change to partitioning, escalation, ingest, or report.

## Chunks

1. **Escalation scoring + partitioner** (`src/deep-map/partition.ts`,
   `src/deep-map/escalate.ts`, types). Pure functions over loaded graph data.
2. **Packet builder + prompt construction + run store**
   (`src/deep-map/packets.ts`, `src/deep-map/store.ts`).
3. **Ingest with validation, attribution, and rejection**
   (`src/deep-map/ingest.ts`).
4. **Report + cost accounting + CLI wiring** (`src/deep-map/report.ts`,
   `src/cli/commands/deep-map.ts`).
5. **Host-side fan-out surface**: `commands/deep-map.md`, docs, `dist` rebuild.

Chunks 1–4 are sequential (each consumes the prior's types); chunk 5 is
independent of 1–3 but needs 4's flag names.

## Risks

- **Cheap-tier output quality.** A weak model returns confident nonsense.
  Mitigated by schema bounds, unknown-id rejection, and per-finding attribution
  so a bad tier is identifiable and droppable, not baked in.
- **Prompt injection via a remote-scanned repo.** Component names and file paths
  from a `scan-remote` clone flow into packet prompts. Mitigated by carrying the
  existing untrusted-source warning into packets and report output when the
  project origin is remote, and by treating ingest input as pure data.
- **dist drift.** CI runs `git diff --exit-code -- dist`. Rebuild before commit.
