# Architecture

<!-- GENERATED FILE - do not hand-edit. -->
<!-- Regenerate: `npm run architecture` (or `navgator arch-index --write`). -->
<!-- Curated input (responsibilities, boundaries): docs/architecture/modules.json -->
<!-- Machine-readable index: docs/architecture/index.json -->

**Start here if you are new to this repo.** This file answers four questions without
running a scan: what the major components are, what depends on what, what a change to a
given file can break, and which boundaries must not be crossed.

| Question | Where to look |
|---|---|
| What are the major components, and what is each responsible for? | [Modules](#modules) |
| What depends on what? | [Module dependencies](#module-dependencies) |
| If I change file X, what else is affected? | [Blast radius](#blast-radius), then the per-file lookup in `docs/architecture/index.json` |
| Which boundaries must I not cross? | [Boundaries](#boundaries) |

## Coverage and blind spots

**Coverage: PARTIAL** — part of this tree was not analyzed. Read the blind spots below before treating any absence of edges as evidence.

365 files analyzed, 1049 internal import edges.

| Language | Files | Analyzed | Internal edges |
|---|---:|---|---:|
| JavaScript | 8 | yes | 0 |
| Python | 7 | **no** | n/a |
| Shell | 8 | **no** | n/a |
| TypeScript | 358 | yes | 1049 |

What this index cannot see:

- 7 Python file(s) are present but NOT analyzed. NavGator's import scanner is TypeScript/JavaScript only, so zero Python edges here means "not measured", never "not coupled".
- 8 JavaScript file(s) were analyzed but produced zero internal edges. Either those files genuinely import nothing local, or the scanner missed them — this index cannot tell the two apart, so do not read the absence as low coupling.
- 8 Shell file(s) are present but NOT analyzed. NavGator's import scanner is TypeScript/JavaScript only, so zero Shell edges here means "not measured", never "not coupled".
- Edges come from matching import syntax in raw file text, not from a compiler, so a specifier inside a comment or a string literal counts as an edge. The error runs in the safe direction — blast radius over-reports dependents rather than hiding them — but a listed dependent may be a commented-out import or a test fixture string.
- Only static import/require/re-export edges are indexed. Runtime wiring — dependency injection, string-keyed registries, HTTP calls, queue topics — is not.

## Modules

A module is a curated directory from `docs/architecture/modules.json`, or — where nobody
has curated one — the file's first two path segments. Uncurated rows are marked; give
them a responsibility in `docs/architecture/modules.json`.

| Module | Files | Responsibility | Start reading at |
|---|---:|---|---|
| `.` | 1 | Repo-root configuration only (tsconfig, vitest config, package manifests). `.` claims top-level files and nothing below them. | - |
| `scripts` | 5 | Release and install tooling run from npm scripts and CI — the release verifier, web-runtime packaging, benchmarks, and host-plugin installers. | - |
| `src` | 37 | Core library and the published npm surface: scan orchestration, storage, graph queries (impact/trace/rules/review), and the shared type system. | `src/types.ts`<br>`src/config.ts`<br>`src/storage.ts` |
| `src/__tests__` | 102 | Vitest suite for the core library, CLI, and scanners. Imports production modules freely; nothing in production may import it. | `src/__tests__/helpers.ts` |
| `src/audit` | 4 | Dependency-free statistical sampling and process-control math used to audit scan accuracy. | `src/audit/sampler.ts`<br>`src/audit/spc.ts`<br>`src/audit/verifiers.ts` |
| `src/cli` | 30 | The `navgator` binary. One module per subcommand, all registered in `src/cli/index.ts`; owns the five-value exit-code contract in `exit-codes.ts`. | `src/cli/exit-codes.ts`<br>`src/cli/commands/helpers.ts`<br>`src/cli/commands/portfolio.ts` |
| `src/deep-map` | 9 | Tiered semantic mapping: emits LLM work packets for the calling agent to run, then validates and attributes the findings. Findings never enter the graph. | `src/deep-map/types.ts`<br>`src/deep-map/store.ts`<br>`src/deep-map/filter.ts` |
| `src/enrich` | 4 | External-boundary enrichment: resolves npm/pip/cargo identities and versions against registries, cached machine-wide in `~/.navgator/`. | `src/enrich/cache.ts`<br>`src/enrich/external-enrichment.types.ts`<br>`src/enrich/external-resolver.ts` |
| `src/freshness` | 5 | Concurrency-safe dirty ledger and drainer that decide whether stored architecture data is stale enough to rescan. | `src/freshness/paths.ts`<br>`src/freshness/dirty-ledger.ts`<br>`src/freshness/drainer.ts` |
| `src/git-aware` | 4 | Canonical-main plus branch-delta snapshots, so an agent can separate committed architecture from uncommitted local change (`arch-diff`). | `src/git-aware/refs.ts`<br>`src/git-aware/canonical.ts`<br>`src/git-aware/premerge-diff.ts` |
| `src/mcp` | 2 | Opt-in MCP server. Deprecated as a default surface — the CLI is the agent interface; this ships only for consumers that cannot spawn a subprocess. | `src/mcp/tools.ts` |
| `src/memory` | 3 | gator-memory: the durable cross-session narrative in `~/.navgator/memory/` (which projects exist, when, and what materially changed). | `src/memory/store.ts`<br>`src/memory/mirror.ts`<br>`src/memory/health.ts` |
| `src/metrics` | 1 | PageRank and Louvain community detection over the component graph; writes `metrics.json` and back-writes scores onto components. | `src/metrics/pagerank-louvain.ts` |
| `src/parsers` | 1 | SCIP overlay: shells out to scip-typescript for compiler-accurate cross-file edges the regex scanner cannot resolve. | `src/parsers/scip-runner.ts` |
| `src/portfolio` | 4 | Cross-repo sweep: runs the single-repo scan pipeline over a folder of repositories and joins the results into one dependency map. | `src/portfolio/types.ts`<br>`src/portfolio/scan.ts`<br>`src/portfolio/cross-repo.ts` |
| `src/remote` | 3 | Shallow-clones a GitHub URL into a cache and scans it. This is the untrusted-input path — every scanner cap in `src/scanners/scan-limits.ts` exists because of it. | `src/remote/clone.ts`<br>`src/remote/github-url.ts`<br>`src/remote/scan-remote.ts` |
| `src/scanners` | 28 | Language and infrastructure scanners that turn source files into components and connections (TS/JS imports, Swift, Rust, Prisma, queues, cron, env, LLM calls). | `src/scanners/connections/import-scanner.ts`<br>`src/scanners/prompts/types.ts`<br>`src/scanners/connections/llm-call-tracer.ts` |
| `src/storage` | 1 | Markdown projection of stored components. Pure derivative — the JSON store stays canonical. | `src/storage/markdown-view.ts` |
| `src/temporal` | 1 | Nested git repository inside `.navgator/` that gives architecture snapshots a history without touching the parent repo's git. | `src/temporal/git-store.ts` |
| `web` | 4 | Next.js dashboard (`navgator ui`), built and packaged separately from the CLI. Talks to stored architecture data through its own API routes, never by importing `src/`. | `web/proxy.ts` |
| `web/app` | 14 | Dashboard routes and the loopback read-only HTTP API under `web/app/api/`. | `web/app/page.tsx`<br>`web/app/api/components/route.ts`<br>`web/app/api/connections/route.ts` |
| `web/components` | 73 | Dashboard React components, including the vendored shadcn/ui primitives in `web/components/ui/`. | `web/components/ui/button.tsx`<br>`web/components/ui/card.tsx`<br>`web/components/ui/input.tsx` |
| `web/hooks` | 2 | Dashboard React hooks shared across components. | `web/hooks/use-mobile.ts`<br>`web/hooks/use-toast.ts` |
| `web/lib` | 27 | Dashboard client and server helpers: API client, types, project-path resolution, and request guards. | `web/lib/utils.ts`<br>`web/lib/types.ts`<br>`web/lib/api-client.ts` |

## Module dependencies

Read as "the module on the left imports from the modules on the right"; the number is how
many file-level import edges cross that pair.

- `src` imports `src/scanners` (28), `src/memory` (5), `src/portfolio` (4), `src/enrich` (3), `src/git-aware` (3), `src/freshness` (2), `src/remote` (2), `src/audit` (1), `src/metrics` (1), `src/parsers` (1), `src/storage` (1), `src/temporal` (1)
- `src/__tests__` imports `src` (113), `src/cli` (34), `src/scanners` (32), `src/freshness` (19), `web/lib` (18), `src/deep-map` (15), `web/app` (11), `src/git-aware` (7), `src/memory` (7), `src/portfolio` (5), `src/remote` (5), `src/audit` (3), `src/mcp` (3), `src/parsers` (2), `src/storage` (2), `src/metrics` (1), `web` (1)
- `src/audit` imports `src` (3)
- `src/cli` imports `src` (100), `src/deep-map` (8), `src/freshness` (3), `src/memory` (3), `src/portfolio` (3), `src/enrich` (2), `src/git-aware` (2), `src/scanners` (2), `src/remote` (1), `src/temporal` (1)
- `src/deep-map` imports `src` (18), `src/metrics` (3)
- `src/enrich` imports `src` (2)
- `src/freshness` imports `src` (4)
- `src/git-aware` imports `src` (7)
- `src/mcp` imports `src` (16), `src/portfolio` (3), `src/git-aware` (2), `src/remote` (1)
- `src/memory` imports `src` (5)
- `src/metrics` imports `src` (3)
- `src/portfolio` imports `src` (5), `src/remote` (1)
- `src/remote` imports `src` (2)
- `src/scanners` imports `src` (24)
- `src/storage` imports `src` (1)
- `web` imports `web/lib` (1)
- `web/app` imports `web/lib` (38), `web/components` (15)
- `web/components` imports `web/lib` (85), `web/app` (2), `web/hooks` (2)
- `web/hooks` imports `web/components` (1)

Leaf modules (they import nothing internal): `.`, `scripts`, `src/parsers`, `src/temporal`, `web/lib`

## Blast radius

Highest-fan-in files. Changing one of these can affect every file listed as its dependent.

| File | Module | Direct dependents |
|---|---|---:|
| `src/types.ts` | `src` | 99 |
| `web/lib/utils.ts` | `web/lib` | 57 |
| `src/config.ts` | `src` | 44 |
| `src/storage.ts` | `src` | 38 |
| `src/agent-output.ts` | `src` | 28 |
| `src/cli/exit-codes.ts` | `src/cli` | 27 |
| `web/lib/types.ts` | `web/lib` | 26 |
| `src/scanner.ts` | `src` | 24 |
| `src/__tests__/helpers.ts` | `src/__tests__` | 19 |
| `src/projects.ts` | `src` | 19 |
| `src/cli/commands/helpers.ts` | `src/cli` | 17 |
| `web/components/ui/button.tsx` | `web/components` | 17 |
| `web/lib/api-client.ts` | `web/lib` | 15 |
| `src/deep-map/types.ts` | `src/deep-map` | 12 |
| `src/rules.ts` | `src` | 12 |
| `web/components/ui/card.tsx` | `web/components` | 12 |
| `web/lib/project-context.tsx` | `web/lib` | 12 |
| `src/resolve.ts` | `src` | 11 |
| `web/lib/hooks/index.ts` | `web/lib` | 11 |
| `web/lib/server/project-path.ts` | `web/lib` | 11 |

For any file, not just these, look it up in `docs/architecture/index.json`:

```bash
# What does src/storage.ts import, and who imports it?
jq '.files["src/storage.ts"]' docs/architecture/index.json

# Direct dependents only (the first ring of blast radius)
jq -r '.files["src/storage.ts"].imported_by[]' docs/architecture/index.json
```

For the transitive ring, or for edges this static index does not carry, run the live tool:
`navgator impact <component>` and `navgator trace <component>`.

## Boundaries

| Rule | Constraint | Status | Why |
|---|---|---|---|
| core-not-cli | `src` must not depend on `src/cli` | held | `src` is the published library (`main`/`exports` in package.json). If it imported the CLI, every library consumer would pull in commander and the whole command surface. |
| core-not-dashboard | `src` must not depend on `web`, `web/app`, `web/components`, `web/hooks`, `web/lib` | held | The CLI and the dashboard are separate build units with separate tsconfigs. `src` importing `web` would put React and Next.js in the CLI's dependency path. |
| core-not-tests | `src` must not depend on `src/__tests__` | held | Test helpers are not shipped in the `files` list, so a production import of one breaks the published package while passing locally. |
| dashboard-app-not-core | `web/app` must not depend on `src`, `src/cli`, `src/scanners` | held | Same separation as `dashboard-not-core`, enforced at the route layer where the temptation to import the scanner directly is highest. |
| dashboard-not-core | `web/lib` must not depend on `src`, `src/cli`, `src/scanners` | held | The dashboard reads architecture data over its own loopback API, not by importing the scanner. Importing `src` would make the Next.js build depend on the CLI's compile output. |
| scanners-not-cli | `src/scanners` must not depend on `src/cli` | held | Scanners must stay callable as plain functions from the library, the MCP server, and tests. A dependency on the CLI layer would couple them to process state and exit codes. |

---

Generated by `navgator arch-index`, schema v1. Carries no timestamp by
design: the artifact is byte-stable across runs, so its diff only ever shows real
architecture change. CI regenerates it and fails if the committed copy differs.
