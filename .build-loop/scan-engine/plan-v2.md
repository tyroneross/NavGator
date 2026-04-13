# Plan v2 — NavGator Scan Engine Upgrade

Supersedes `plan.md`. Same goal; architecture revised after Phase-1 research + user feedback.

## What changed from v1

| Topic | v1 | v2 |
|---|---|---|
| Call chain tracing | tree-sitter + ast-grep (ceiling: no resolution) | **SCIP via `scip-typescript`** (compiler-accurate, cross-file, Apache-2.0, npm pkg). Tree-sitter kept only for JS-without-tsconfig fallback. |
| Graph storage | in-memory graphology + JSON | **Flat files** — markdown per component + CSV edges + JSONL timeline. In-memory graphology built on-demand. DuckDB optional, never required. |
| Temporal tracking | `timeline.json` diffs | **Git-backed** — `.navgator/` committed on each scan; `navgator at <sha>`, `navgator first-seen <id>`, `navgator changes --since <sha>`. |
| Embeddings | cut for install cost | **Cut — confirmed** (Cody dropped, Cline refuses, Claude Code prefers grep). Replaced by `navgator find` = ripgrep over node metadata + fuzzy match; calling LLM does the semantic step. |
| LLM synthesis | separate Move 3, deferred | **No embedded LLM.** NavGator is always called from Claude Code / Codex — synthesis happens at the caller, for free. NavGator's job is to serve structured, readable data. |

## Revised storage layout

```
.navgator/
├── NAVSUMMARY.md              # hot context + inline Mermaid
├── components/
│   └── <type>/<slug>.md       # one md per node; frontmatter + body with [[wikilinks]]
├── connections.jsonl            # from_id, to_id, type, file, line, confidence, valid_from
├── timeline.jsonl             # append-only event log
├── metrics.json               # PageRank + Louvain per latest scan
├── file_map.jsonl               # file_path → component_id
├── INDEX.md                   # generated table of contents
└── (committed via git — parent repo or `.navgator-history` orphan branch)
```

### Why this works at scale
- Obsidian/Foam/Logseq prove markdown+wikilinks scales to 100K nodes.
- JSONL edge list reads in <50ms via `fs.readFileSync + split('\n') + JSON.parse` for 100K rows.
- Types are preserved (confidence stays number 0.95, not string "0.95"); schema-evolvable (new fields added without breaking readers).
- graphology builds from JSONL+frontmatter in ~200ms for 1K nodes, ~2s for 100K.
- Git pack files compress repeated JSON/markdown aggressively; weekly scans for a year of a 200K-node graph ≤ ~150 MB packed.
- DuckDB can query the JSONL directly with `read_json_auto` when analytical queries are needed — the "DB" is ephemeral, files are source of truth.
- NAVSUMMARY.md presents a human-readable projection (top-N edges as markdown tables, Mermaid cluster diagram); the JSONL is the canonical source for machines.

### What the caller (Claude/Codex) sees
- NAVSUMMARY.md loaded at session start (hot context, ~6KB)
- Tools expose `navgator explore <id>` → returns that component's `.md` file verbatim + adjacent nodes
- `navgator trace <id>` → walks `connections.jsonl` in memory, returns ordered paths
- `navgator find <query>` → ripgrep across component bodies + frontmatter, returns ranked candidates
- Caller reasons over the data — no embedded LLM, no model download, no API keys

## Scoring criteria (unchanged from goal.md)

1. Speed — scan time ≤ baseline on fixture repo
2. Accuracy-parity — all existing tests + new characterization tests pass
3. Accuracy-new-catches — ≥3/5 new cases: re-exports, string-templated routes, destructured Prisma, dynamic imports, decorator stacks
4. Efficiency — no new subprocess/network/model-load in default path
5. Install — fresh clone → `npm install && npm run build && npm test` green on macOS ARM + Linux x64

## Execution waves

### Wave 1 — foundation (this session)

Goal: storage migration + stable IDs + benchmark + git-backed temporal land and pass. No SCIP, no new scanners yet. This alone gives: time-travel queries, diffable architecture, LLM-ingestible outputs.

1. **T1** — Benchmark harness (`scripts/bench-scan.ts`) + synthetic fixture (`__tests__/fixtures/bench-repo/`, ~1000 LOC Prisma+BullMQ+routes+LLM). Record baseline.
2. **T2** — Stable IDs: add `stable_id` field to `ArchitectureComponent`, persist everywhere, legacy-scan migration. Unblocks PageRank persistence.
3. **T3** — Flat-file writer: migrate `storage.ts` to emit `components/<type>/<slug>.md`, `connections.jsonl`, `timeline.jsonl`, `metrics.json`, `file_map.jsonl`. Deprecate `components/COMP_*.json` + `connections/CONN_*.json` (keep read-back compat for legacy scans). Update `buildGraph()` + `buildSummary()` accordingly.
4. **T4** — graphology PR + Louvain at end of scan; write scores into each component's frontmatter + `metrics.json`. Fixed seed for reproducibility.
5. **T5** — Git-backed temporal: `scripts/commit-scan.ts` that atomically `git add .navgator/ && git commit -m "scan @ <sha-of-repo-head>"` on orphan branch or `.navgator/.git`. New CLI: `navgator at <sha|date>`, `navgator first-seen <id>`, `navgator changes --since <sha|date>`.
6. **T6** — NAVSUMMARY.md generator includes top-10 PageRank + Mermaid cluster diagram.
7. **T7** — Re-run bench; assert ≤ baseline and verify T3 outputs exist.
8. **T8** — `navgator find <query>`: ripgrep over `components/**/*.md` + fuzzy score; returns ranked candidate IDs + 1-line context.

### Wave 2 — resolved call chains (next session)

9. **T9** — Characterization tests for `import-scanner.ts`, `service-calls.ts`, `llm-call-tracer.ts` (currently ZERO coverage). Capture current behavior including known imperfections as the contract.
10. **T10** — `@sourcegraph/scip-typescript` + `@sourcegraph/scip`. Add `src/parsers/scip-runner.ts`: detect tsconfig, shell out (or in-process if a Node API exists), parse protobuf, build resolved call edges with `valid_from = scan_timestamp`.
11. **T11** — Merge SCIP output into the import-scanner path as primary, regex as fallback. Tree-sitter NOT required — SCIP already uses tsserver.
12. **T12** — New-catch tests: re-exports / decorators / string-templated routes / destructured / dynamic imports. Assert ≥3/5 catches.
13. **T13** — Re-bench with SCIP enabled; measure cold and warm scan.

### Wave 3 — deferred, revisit after Wave 2 data

- tree-sitter for JS-without-tsconfig / polyglot support
- `navgator find --semantic` optional flag with externally-configured embedding provider (OpenAI text-embedding-3-small or Voyage voyage-code-3), strictly opt-in, `.navgator/embeddings.csv` with merkle-invalidation. Only if users demand it.

## Subagent coordination (Wave 1)

Three parallel workstreams after T1 (bench) + T2 (stable IDs) land:

- **WS-A — storage migration (T3 + T4):** one subagent owns `storage.ts` + `buildGraph()` rewrite end-to-end (don't split; they share state)
- **WS-B — temporal + CLI (T5 + T6 + T8):** one subagent adds git-commit + three new CLI commands; reads from files WS-A produces
- **WS-C — bench rerun (T7):** sequential after WS-A + WS-B close

## Risks + kill switches

| Risk | Kill switch |
|---|---|
| Markdown+CSV parse slower than JSON at load | Fallback: keep `index.json` as compact dense cache alongside markdown (generated from `.md` sources; markdown is source of truth) |
| Git commits pollute user's repo | Default: commit to isolated `.navgator-history` orphan branch OR nested `.navgator/.git`. User opt-in to commit to main. |
| scip-typescript indexer fails on exotic tsconfig | Fall back to current regex import-scanner for that file. Already pattern NavGator uses. |
| Stable IDs break downstream consumers that match by legacy ID | Phase 1 grep showed no consumers match by string-concat of ID. Verified. |
| PageRank meaningless on tiny graphs | Suppress display below 20 nodes |
| Louvain non-deterministic | Fixed seed, `randomWalk: false` |

## Files (Wave 1)

**New:**
- `scripts/bench-scan.ts`
- `scripts/commit-scan.ts`
- `__tests__/fixtures/bench-repo/**`
- `src/storage/markdown-writer.ts`
- `src/storage/markdown-reader.ts`
- `src/storage/jsonl-edges.ts`
- `src/storage/timeline.ts`
- `src/metrics/pagerank-louvain.ts`
- `src/cli/at.ts`
- `src/cli/first-seen.ts`
- `src/cli/changes.ts`
- `src/cli/find.ts`

**Modified:**
- `src/storage/index.ts` / `src/storage.ts`
- `src/scanner.ts` (buildGraph, clearStorage)
- `src/types.ts` (add `stable_id`, `pagerank_score`, `community_id` to ArchitectureComponent and GraphNode)
- `src/architecture-insights.ts`
- `src/index.ts` (register new commands)
- `package.json` (graphology, graphology-metrics, graphology-communities-louvain, js-yaml)

**Unchanged in Wave 1:** `hooks/`, scanners, classify.ts, llm-dedup.ts, impact.ts, trace.ts (consumers updated in Wave 2 to use PageRank)

## Open questions for user — none required before Wave 1

User has granted permission to proceed, compact, snapshot, auto-continue. Wave 1 will execute in this session with subagents. Wave 2 blocks on Wave 1 evidence.
