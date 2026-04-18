# Plan — NavGator Static Dependency + Relationship Fidelity

Linked goal: `.build-loop/scan-fidelity/goal.md`
Status: **PROPOSED**

## Executive Summary

This is a scanner-fidelity plan, not a product-feature plan.

The core issue is not that NavGator lacks commands. The issue is that the
current scan graph for the NavGator repo is incomplete in specific, fixable
ways:
- nested alias imports are missed
- `web/app/api/*` routes are not resolved from frontend fetches
- bare npm package usage is not modeled
- some rules overfit to weak heuristics
- trace defaults are too expensive on hotspot nodes

The plan keeps scope tight. It fixes the graph inputs first, then adjusts the
rules and trace behavior that depend on those inputs.

## Build-Loop Phase Alignment

### Phase 1 — Assess
Completed in this planning pass.

Evidence gathered:
- fresh self-repo scan (`scan`, `status`, `rules`, `dead`, `impact`, `trace`)
- direct source verification in `import-scanner.ts`, `trace.ts`, `rules.ts`, `architecture-insights.ts`, `mcp/tools.ts`, and `web/tsconfig.json`
- confirmation that the current graph still contains only `imports` edges on the self-repo after a fresh scan

### Phase 2 — Define
Captured in `.build-loop/scan-fidelity/goal.md`.

### Phase 3 — Plan
Detailed below.

No Phase 4 execution is included in this turn.

## Task Breakdown

### Task 1 — Add characterization coverage for current failures
**Goal**: Lock the failing behaviors before changing scanners.

**Files**:
- `src/__tests__/scanner-characterization.test.ts`
- `src/__tests__/trace.test.ts`
- add focused fixtures if needed under `src/__tests__/fixtures/`

**Add assertions for**:
- nested `web/tsconfig.json` alias resolution (`@/components/...`)
- `fetch('/api/...')` resolution into `web/app/api/*`
- bare package imports resolving to `uses-package`
- `dead` no longer treating real package imports as unused
- `rules` no longer raising the known `mcp/tools -> types` false-positive error
- `trace storage` completes under the chosen default behavior

**Dependencies**: none
**Parallel-safe**: no; these tests define the contract for the rest of the work
**Primary graders**: criteria 1-5

### Task 2 — Make alias resolution workspace-aware
**Goal**: Resolve imports using the correct config root for each file.

**Files**:
- `src/scanners/connections/import-scanner.ts`

**Changes**:
- Replace single-root alias loading with nearest-config or workspace-aware alias lookup.
- Support nested `tsconfig.json` / `jsconfig.json` roots, starting with `web/`.
- Cache resolved alias maps by config directory to avoid repeated file I/O.
- Preserve current repo-root behavior for `src/*` while correctly resolving `web/*` aliases.

**Pass condition**:
- `web/app/page.tsx` resolves imports into `web/components/*` and `web/lib/*`.

**Dependencies**: Task 1
**Parallel-safe**: no; shared write set in `import-scanner.ts`
**Primary graders**: criteria 1, 5

### Task 3 — Resolve frontend fetches into nested API route roots
**Goal**: Produce real `frontend-calls-api` edges for the self-repo.

**Files**:
- `src/scanners/connections/import-scanner.ts`

**Changes**:
- Extend `resolveApiRoute()` to search `web/app${apiPath}/route.*`, `web/src/app${apiPath}/route.*`, and `web/pages${apiPath}.*` in addition to the current roots.
- Keep current root-level route support intact.
- Add tests for known self-repo calls such as `/api/status`, `/api/scan`, `/api/graph`, `/api/rules`.

**Pass condition**:
- fresh scan yields non-zero `frontend-calls-api` edges on the NavGator repo.

**Dependencies**: Task 2 preferred, but logically only Task 1 required
**Parallel-safe**: no; same write set as Task 2
**Primary graders**: criteria 2, 5

### Task 4 — Add bare package usage edges
**Goal**: Connect source files to detected npm packages.

**Files**:
- `src/scanners/connections/import-scanner.ts`
- possibly `src/scanner.ts` if coordination is needed

**Changes**:
- Detect bare package specifiers from `import`, `export from`, `require`, and dynamic `import()`.
- Normalize subpath imports:
  - `graphology-metrics/centrality/pagerank.js` -> `graphology-metrics`
  - `node:fs` and Node built-ins -> ignore
- Emit `uses-package` edges from source files to already-detected npm components.
- Do not invent package components in this pass; only link to components already found from package scanning.

**Pass condition**:
- self-repo scan yields `uses-package` edges for `commander`, `glob`, `graphology`, `graphology-communities-louvain`, and `graphology-metrics` where applicable.

**Dependencies**: Task 1
**Parallel-safe**: no; same write set as Tasks 2-3
**Primary graders**: criteria 3, 5

### Task 5 — Tighten rule precision after graph coverage improves
**Goal**: Remove rule noise caused by weak inference, not by actual architecture.

**Files**:
- `src/rules.ts`
- `src/architecture-insights.ts`
- optionally `src/scanners/connections/import-scanner.ts` if import metadata needs to be enriched

**Changes**:
- Make orphan/dead logic treat `uses-package` edges as real connectivity.
- Narrow `layer-violation` so shared contract modules like `types` do not produce hard errors by default.
- Prefer precision over aggression: if the rule cannot confidently distinguish a value dependency from an allowed shared contract import, downgrade or suppress rather than emit an error.
- Keep real signals such as the `storage -> diff -> storage` cycle untouched.

**Pass condition**:
- `rules` no longer emits the `mcp/tools -> types` error on the self-repo.
- `dead` no longer lists the real package imports above.

**Dependencies**: Tasks 2-4
**Parallel-safe**: partial, but not worth splitting because the evaluation surface is shared
**Primary graders**: criteria 3, 4, 5

### Task 6 — Make trace safe by default on hotspot components
**Goal**: Remove the current default-path stall.

**Files**:
- `src/trace.ts`
- `src/cli/commands/trace.ts`
- `src/mcp/tools.ts`

**Changes**:
- Apply `maxPaths` and frontier pruning during traversal, not only after traversal.
- Keep path scoring, but bound the search before combinatorial blow-up happens.
- Change default direction from `both` to `forward` for CLI and MCP surfaces; keep `--direction both` as explicit opt-in.
- Add a regression test for `trace storage` on the self-repo fixture or a targeted dense fixture.

**Why this change is recommended**:
- `both` is too expensive as a default on dense graphs and is the current source of the apparent hang.
- Forward trace matches the most common user question: “what does this affect / lead to?”

**Pass condition**:
- `navgator trace storage` completes successfully under default settings on the self-repo.

**Dependencies**: Task 1
**Parallel-safe**: yes relative to Tasks 2-5, because it touches `trace.ts` and command surfaces rather than scanner logic
**Primary graders**: criteria 4, 5

### Task 7 — Validate on the self-repo and write scorecard
**Goal**: Prove the fixes changed signal quality, not just code shape.

**Validation set**:
- `npm test`
- fresh `node dist/cli/index.js scan --agent`
- `status --agent`
- `rules --agent`
- `dead --agent`
- `connections web/app/page --agent`
- `connections web/components/header --agent`
- `connections commander --agent` or equivalent package evidence
- `trace storage --agent`

**Evidence outputs**:
- `.build-loop/scan-fidelity/evals/baseline.md`
- `.build-loop/scan-fidelity/evals/final.md`

**Dependencies**: Tasks 2-6
**Parallel-safe**: no; final integration checkpoint
**Primary graders**: criteria 1-5

## Dependency Graph

```text
T1 characterization
 ├─→ T2 alias resolution
 │    └─→ T3 nested API route resolution
 │         └─→ T4 bare package usage edges
 │              └─→ T5 rule precision cleanup
 └─→ T6 trace default + pruning

T5 + T6 ──→ T7 final validation
```

## Optimization Notes

- Do not add a new parser stack in this loop. The failures are fixable inside the current regex-first scanner architecture.
- Do not split Tasks 2-4 across multiple workers if using subagents later; they share the same core file and will conflict.
- If any test needs golden scan output, store only the minimum evidence needed. Avoid large snapshot churn.
- Prefer using existing connection types over schema additions. `uses-package` and `frontend-calls-api` already exist.

## Risk Register

| Risk | Severity | Mitigation |
|---|---|---|
| Nested config lookup resolves the wrong alias root in a monorepo | High | Choose nearest config ancestor, add explicit tests for root vs `web/` separation |
| Bare package import matching creates noisy edges for Node built-ins or deep subpaths | High | Normalize package names, ignore `node:` and built-ins, test subpath imports explicitly |
| Rule cleanup hides real problems along with false positives | Medium | Only suppress targeted known-noise cases; preserve cycle, hotspot, and fan-out tests |
| Trace fix changes behavior too aggressively | Medium | Keep `--direction both` opt-in and document the default shift clearly |
| Validation relies too heavily on self-repo specifics | Medium | Use self-repo as the acceptance target, but keep at least one minimal fixture per bug class |

## Coordination Checkpoints

- **After T1**: freeze the failing examples before touching scanner logic.
- **After T4**: run a fresh scan before changing rules, so rule work is based on improved graph input.
- **After T6**: verify CLI and MCP trace defaults agree; do not fix only one surface.
- **Before T7**: compare fresh output against the concrete false positives from Phase 1, not just aggregate counts.

## Not Included In This Plan

- Generic multi-language package-use modeling beyond npm
- Broader route inference for arbitrary framework conventions outside current self-repo needs
- Full rewrite of tier inference into a richer architecture model
- UI-level presentation changes for rules, dead code, or trace output
- Any plugin-install / marketplace / hook cleanup work
