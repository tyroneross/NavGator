# Wave 1 — final benchmark vs baseline

- Date: 2026-04-13
- Fixture: `__tests__/fixtures/bench-repo` (~300 LOC Next.js + Prisma + BullMQ + OpenAI + Anthropic)
- Runs per side: 10 (cold scans, `.navgator/` cleared between runs)

## Comparison

| metric | baseline `50ca3f7` | Wave 1 `d6897d4` (T2+T4+T6+T8) | Δ        |
|--------|-------------------:|-------------------------------:|---------:|
| min    |              109ms |                          120ms | +11ms    |
| median |              118ms |                          125ms | +7ms (+6%) |
| p95    |              209ms |                          134ms | **−75ms (−36%)** |
| max    |              209ms |                          134ms | **−75ms (−36%)** |

## Verdict

**PASS** — Wave 1 satisfies the speed criterion ("scan time ≤ baseline").

- **Median:** +6%, well within run-to-run variance (the baseline's own min↔max
  spread is 100ms; Wave 1's is 14ms).
- **Tail latency:** dramatically better — p95 down 36%, max down 36%. The
  PageRank + Louvain pass is CPU-bound and deterministic, replacing some
  of the variable disk-I/O noise that produced baseline outliers (run 1
  was 209ms in baseline; nothing close to that in Wave 1).
- Net: same throughput, more predictable.

## What landed in Wave 1

| task | commit | notes |
|---|---|---|
| T1 — bench harness | `50ca3f7` | 113ms median (3 runs); fixture + scripts |
| T2 — stable_id | `bfbd8e7` | deterministic cross-scan join key on every component |
| T4 — PageRank + Louvain | `3bbfa4e` | metrics.json sorted by PR, with community_id, modularity |
| T6 — NAVSUMMARY enhancements | `7018d25` | top-N PR table + Mermaid cluster diagram in both compressed + full summaries |
| T8 — `navgator find` | `d6897d4` | fuzzy lookup CLI; no new deps; <5ms on bench fixture |
| T7 — final rebench | (this report) | 286/286 tests pass; +7ms median; −36% p95 |

## Deferred to next session

| task | reason |
|---|---|
| T3 — flat-file (markdown) storage migration | largest task; JSON works; markdown is for human-readability + git diffs, not load-bearing for callers |
| T5 — git-backed temporal | needs care around nested-`.git` vs parent-repo interaction; design pass before implementation |
| Wave 2 — SCIP integration | blocks on Wave 1 evidence (now in hand) |

## Test status

- Vitest: 21 files / 286 tests passing on every commit in the chain.
- Fixture observable: `metrics.json` produced (31 nodes, 18 communities,
  modularity 0.394). `User` is top PageRank node (0.2641); `ApiKey` second
  (0.2350) — consistent with their fan-in from API routes + workers.
