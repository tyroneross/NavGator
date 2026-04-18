# Goal — NavGator Static Dependency + Relationship Fidelity

Status: **PROPOSED** — planning only, no execution in this loop yet
Created: 2026-04-15

## Problem

NavGator's self-scan still under-models its own static architecture.

Fresh scan evidence from 2026-04-15:
- `228` components
- `341` connections
- `connections_by_type = { imports: 341 }`
- `frontend-calls-api = 0`
- `uses-package = 0`

That incomplete graph creates false architectural findings:
- Web app modules such as `web/app/page` and `web/components/header` are reported as orphaned even though they clearly import each other.
- Core packages such as `commander`, `glob`, `graphology`, `graphology-communities-louvain`, and `graphology-metrics` are reported as dead/unconnected even though they are imported in production code.
- `mcp/tools -> types` is flagged as a layer violation even though this is currently a non-actionable precision failure, not a meaningful architectural breach.
- `trace storage` is unsafe at default settings on the self-repo because traversal cost is controlled after search, not during search.

## Current State (Phase 1 findings)

### 1. Nested workspace alias resolution is broken
- `import-scanner` loads aliases only from repo-root `tsconfig.json` / `jsconfig.json`.
- The web app's `@/*` alias lives in `web/tsconfig.json`, so imports like `@/components/header` in `web/app/page.tsx` are not resolved.
- Result: valid web imports are missing from the graph.

### 2. Frontend-to-API resolution is incomplete
- `resolveApiRoute()` checks `app/*`, `src/app/*`, and `pages/*` patterns.
- The self-repo's API routes live under `web/app/api/*`.
- Result: fetch calls in the web UI do not produce `frontend-calls-api` edges.

### 3. Bare package imports are not modeled
- The current import scanner matches relative imports and path-alias imports, not bare npm specifiers.
- Package components are detected from `package.json`, but there are no `uses-package` edges connecting source files to those package nodes.
- Result: `dead` and package orphan output are noisy and often wrong.

### 4. Rule precision is lower than it should be
- `layer-violation` relies on a coarse path-segment tier heuristic.
- Shared modules such as `types` are treated as low-tier targets even when the import should be allowed.
- Result: some errors look architectural but are actually modeling mistakes.

### 5. Trace defaults are too expensive on dense nodes
- CLI default is `direction=both`, `depth=5`.
- `maxPaths` is applied after BFS traversal, not during frontier expansion.
- Result: hotspot nodes can stall even when the user only needs the first few useful paths.

## Desired Outcome

1. NavGator self-scan captures internal web imports, frontend API fetches, and npm package usage on the NavGator repo itself.
2. `rules` and `dead` become materially more trustworthy by removing scanner-caused false positives.
3. `trace` becomes safe to run with default settings on hotspot components.
4. Existing real signals remain intact: real import cycles, real hotspots, and real fan-out should still surface.
5. The loop stays lightweight: no mandatory new parser stack, no install-complexity regression, and no breaking graph schema rewrite.

## Non-Goals

- No new mandatory AST / SCIP dependency in this loop.
- No UI redesign of the web dashboard.
- No re-architecture of service-call, runtime-binding, or LLM tracing.
- No plugin / hook / marketplace work.
- No attempt to solve every monorepo edge case generically; this loop targets the concrete self-repo failures first.

## Scoring Criteria

Five code-based graders. No LLM judge needed.

| # | Criterion | Grader | Pass condition | Evidence required |
|---|---|---|---|---|
| 1 | Web static import fidelity | Characterization tests + fresh self-repo scan | `web/app/page` has resolved outgoing import edges and imported dashboard components are no longer flagged as orphaned | test output + `connections web/app/page` + `rules` diff |
| 2 | Frontend API coverage | Fresh self-repo scan | Graph contains non-zero `frontend-calls-api` edges for real web fetch calls into `web/app/api/*` | `status --agent` / `graph.json` / `connections` evidence |
| 3 | Package usage coverage | Fresh self-repo scan | Graph contains `uses-package` edges for real production imports of `commander`, `glob`, and `graphology*`; `dead` no longer lists those packages | `connections` / `dead --agent` output |
| 4 | Rule precision + trace UX | Rule regression tests + command timing | `rules` no longer emits the `mcp/tools -> types` layer error; `navgator trace storage` returns successfully under default settings within an agreed local threshold | rule output + timed trace command |
| 5 | Regression safety | Full vitest suite + scan smoke test | Existing tests pass, new characterization tests pass, and fresh `navgator scan` completes without reducing valid self-repo coverage | test output + scan output |

## Assumptions

- This loop optimizes for correctness of the NavGator self-repo first; broader generalization comes after these failures are fixed.
- Reusing existing connection types (`imports`, `frontend-calls-api`, `uses-package`) is preferred over inventing new schema.
- A small CLI behavior change is acceptable if it removes a default-path hang and remains opt-out / configurable.
