# Goal — NavGator Scan Engine Upgrade

**Target state:** NavGator's scan produces more accurate architecture data, faster, with optional LLM synthesis — without breaking the "simple install, no API key required" promise.

## Scoring criteria (5, with code-based graders)

| # | Criterion | Grader | Pass condition |
|---|---|---|---|
| 1 | **Speed** | Benchmark harness (new) — time `navgator scan` on a fixture repo (~1000 LOC, Prisma + BullMQ + API routes + LLM calls), 3 runs, take median | Median ≤ baseline × 1.0 (ideally ≤ 0.7×). Regression fails. |
| 2 | **Accuracy — parity** | Full vitest suite + new characterization tests for previously-untested scanners (import, llm-call-tracer, service-calls) | All existing + new tests pass. Zero regressions in index.json/graph.json shape vs baseline snapshot. |
| 3 | **Accuracy — new catches** | New fixture cases covering: (a) re-exports `export * from './foo'`, (b) nested decorators, (c) string-templated routes `` app.get(`/api/${seg}`) ``, (d) destructured Prisma calls, (e) dynamic imports | At least 3 of 5 new cases detected by upgraded scanner that current scanner misses. |
| 4 | **Efficiency — opt-in cost** | Fresh scan with no flags on fixture repo. No new subprocess spawns, no new network calls, no new >50MB dependencies loaded. | Default `navgator scan` does not download models, does not spawn ast-grep CLI, does not call any LLM. |
| 5 | **Install simplicity** | Fresh `git clone` → `npm install && npm run build && npm test` on macOS ARM + Linux x64 | Green on both without user installing Python, Xcode CLT, or any native toolchain. |

## Non-goals

- Replacing regex Prisma schema parser (`tree-sitter-prisma` community grammar is inactive — regex stays).
- Replacing env/deploy/cron config parsers (JSON/TOML, not code).
- Adding a route scanner from scratch (deferred).
- Changing `.navgator/architecture/` output schema in breaking ways. New fields optional.
- Re-enabling the gator plugin. User decides post-merge.
