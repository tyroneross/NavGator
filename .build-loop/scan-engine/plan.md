# Plan — NavGator Scan Engine Upgrade

## Context from Phase 1 ASSESS

Four parallel agents mapped (A) scanner internals, (B) graph layer, (C) tests, and (D) library landscape. Three findings force scope cuts:

1. **Most scanners don't benefit from tree-sitter.** env/deploy/cron are JSON/TOML; Prisma's custom parser already correctly handles `@default({})` and `tree-sitter-prisma` is an inactive community grammar; Swift has no grammar; Python imports are trivial. **AST wins concentrate in TS/JS import resolution and call-chain tracing.**
2. **PageRank/Louvain have a blocker.** NavGator regenerates component IDs per scan. Scores computed once and stored become meaningless on the next scan. **Stable IDs are a prerequisite.**
3. **Local embeddings cost 90MB on first run.** `@huggingface/transformers` v4 downloads the MiniLM model from HF Hub on first use. That breaks "no network required" unless we bundle (big package) or accept first-run network. **Recommend cutting embeddings from Move 2 and deferring Move 3 entirely.**

Library research confirmed: `web-tree-sitter` (WASM, zero toolchain), `@ast-grep/napi` (prebuilt binaries), `graphology` + Louvain (pure JS, 50K nodes/1s). No install-story regressions if we stay away from `hnswlib-node` and native tree-sitter bindings.

## Scoped plan (Moves 1 + 2; Move 3 deferred)

### Move 1 — tree-sitter + ast-grep, targeted migration

Migrate **only** the scanners where AST beats regex materially and where we can safely write characterization tests first:

- `src/scanners/import-scanner.ts` — imports, exports, re-exports, dynamic imports
- `src/scanners/service-calls.ts` — cross-file service invocations
- `src/scanners/llm-call-tracer.ts` — LLM provider calls
- `src/scanners/ast-scanner.ts` — upgrade existing optional ts-morph fallback to tree-sitter primary

**Keep regex for:** env, deploy, cron, Prisma schema, Swift, field-usage, typespec, infrastructure-presence.

**Pre-req:** characterization tests for the 4 targets (they have zero coverage today — migrating without tests is reckless).

**Libraries:** `web-tree-sitter` + `@ast-grep/napi`. Bundle TS/JS/TSX/JSX grammars (4 `.wasm` files, ~4MB total) in `dist/grammars/`.

### Move 2 — stable IDs + graphology PageRank/Louvain + edge confidence

Do NOT ship embeddings in Move 2 (first-run network cost breaks the install invariant). Add embeddings later as a separate `--semantic` opt-in.

**Pre-req:** Add `stable_id` field on `ArchitectureComponent` derived from `(type, canonical_path_or_name)` only (no content hash). Persist to `graph.json`. Legacy graph.json generates stable IDs on load. Non-breaking.

**Then:**
- `graphology` + `graphology-metrics` + `graphology-communities-louvain`
- Compute PR + Louvain after dedup, before persist
- Store `pagerank_score` + `community_id` as optional fields on `GraphNode`
- Propagate connection `confidence` to `GraphEdge.confidence`; use as PR weight
- Update `impact` (rank by PR), `trace` (`--min-confidence` flag), `rules` (cycles prioritized by centrality), `status`/`NAVSUMMARY.md` (top-N by PR, Louvain cluster summary)

### Move 3 — DEFERRED

Reopen as a separate design doc after Moves 1+2 ship and we measure real-world accuracy gains. Needs answers for: bundled vs on-demand model, local inference vs API, opt-in UX.

## Dependency graph

```
T1 (baseline bench) ┐
T2 (char tests)     ├─► T4,T5,T6 (parallel scanner migrations) ─► T7 (new-catch tests) ─► T8 (bench rerun)
T3 (install libs)   ┘

T9 (stable IDs) ─► T10 (graphology PR/Louvain)   ┐
              \─► T11 (edge confidence)           ├─► T12 (consumer updates: impact/trace/rules/status) ─► T13 (NAVSUMMARY)
```

## Tasks (with parallel-safety)

| # | Task | Parallel-safe | Blocked by |
|---|---|---|---|
| T1 | Add `scripts/bench-scan.ts` + bench fixture repo `__tests__/fixtures/bench-repo/` (~1000 LOC covering Prisma + BullMQ + routes + LLM calls). Record baseline. | no | — |
| T2 | Characterization tests: `__tests__/characterization/{import-scanner,service-calls,llm-call-tracer}.test.ts` | par | — |
| T3 | `npm i web-tree-sitter @ast-grep/napi`. Add grammar loader `src/parsers/tree-sitter-init.ts`. Add ast-grep wrapper `src/parsers/ast-grep-runner.ts`. Bundle `.wasm` via build script. | par | — |
| T4 | Migrate `import-scanner.ts` → tree-sitter. Preserve output shape. | par | T2, T3 |
| T5 | Migrate `service-calls.ts` + `llm-call-tracer.ts` → ast-grep `findInFiles`. | par | T2, T3 |
| T6 | Upgrade `ast-scanner.ts` — tree-sitter primary, regex fallback. | par | T2, T3 |
| T7 | Add `__tests__/scanner-new-catches.test.ts` — assert old misses, new catches ≥3/5 new cases | seq | T4, T5, T6 |
| T8 | Re-run bench. Accept if ≤ baseline. | seq | T4, T5, T6 |
| T9 | Stable IDs — add `stable_id` field, migrate `storage.ts`, `buildGraph()`, `buildFileMap()`. Legacy graph.json auto-generates on load. | par | — |
| T10 | `npm i graphology graphology-metrics graphology-communities-louvain graphology-types`. Compute PR + Louvain in `buildGraph()` after dedup. Fixed random seed for reproducibility. | par | T9 |
| T11 | Propagate `connection.confidence` → `GraphEdge.confidence`. Use as PR weight. | par | T9 |
| T12 | Update `impact`/`trace`/`rules`/`status`/`explore` to consume PR + confidence. `trace --min-confidence N` flag. | seq | T10, T11 |
| T13 | Update NAVSUMMARY generator with "High-impact components" (top-10 PR) + "Subsystem clusters" (Louvain partitions). | par | T10 |

## Subagent coordination

- **WS-A (Move 1 migration):** 3 subagents for T4, T5, T6. Each gets characterization test as contract. Sync on shared bench fixture.
- **WS-B (Move 2 metrics):** 2 subagents for T10, T11. Both modify `buildGraph()`; hand-merge conflicts at end.
- **WS-C (consumer sweep):** 1 subagent sweeps T12 across multiple files. Sequential after WS-B closes.

## Risks + kill switches

| Risk | Kill switch |
|---|---|
| Tree-sitter slower than regex on fixture | Keep regex for imports (volume path); apply tree-sitter only to service-calls + llm-call-tracer where accuracy matters |
| Grammar gaps on edge-case TS syntax | Fall back to regex per-file (pattern already used in `ast-scanner.ts`) |
| PageRank meaningless on small graphs (<20 nodes) | Suppress PR display with "graph too small for centrality ranking" |
| Louvain non-deterministic | Fixed random seed; `randomWalk: false` |
| Stable IDs break consumers that match by the old ID | Grep for `COMP_` string concatenation; none found in consumers during ASSESS, but verify |

## Evaluation wire-up

- Each scanner migration task closes by running full vitest + benchmark
- WS-B closes with assertion that `graph.json` has new fields populated
- WS-C closes when `navgator status` on the fixture shows the new sections

## Files

**New:** `scripts/bench-scan.ts`, `__tests__/fixtures/bench-repo/**`, `__tests__/characterization/{import-scanner,service-calls,llm-call-tracer}.test.ts`, `__tests__/scanner-new-catches.test.ts`, `src/parsers/tree-sitter-init.ts`, `src/parsers/ast-grep-runner.ts`, `dist/grammars/*.wasm`

**Modified:** 4 scanner files + `scanner.ts` + `impact.ts` + `trace.ts` + `rules.ts` + `cli/*.ts` + `storage/*.ts` + `classify.ts` + `architecture-insights.ts` + `package.json`

**Unchanged:** `hooks/`, `commands/`, `agents/`, MCP tool signatures, CLI command names

## Open decisions (CHECKPOINT)

1. Cut Move 3 entirely, or keep as a stretch? **Recommendation: cut; reopen as a separate design.**
2. Cut embeddings from Move 2 (keep "no network" invariant), or accept 90MB first-run for `--semantic`? **Recommendation: cut; ship Move 2 without embeddings.**
3. WS-A scope — migrate all 4 scanner files, or only the 2 with biggest expected win (import + llm-call-tracer)? **Recommendation: all 4, since characterization tests are the expensive part and they apply to all.**
4. Bench fixture — synthetic ~1000 LOC, or use a real copy of `atomize` / `travel-planner`? **Recommendation: synthetic. Real repos drift over time and muddy the benchmark.**
