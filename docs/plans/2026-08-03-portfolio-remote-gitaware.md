# Plan — portfolio / remote / git-aware scanning + 3 in-flight items

Run `bl-navgator-20260803-portfolio`. Rev 2 absorbs 16 scope-auditor + 11 plan-critic findings.

Baseline **measured, not assumed** — `npx vitest run` 2026-08-03 03:11 gave 50 files / 567 tests
passed; `npm run typecheck` exit 0; `npm run build:cli` produced zero `dist/` diff. `main` is 8
commits ahead of origin.

## Headline

Extend NavGator's scan surface from one local repo to a portfolio, a remote GitHub URL, and a
git-branch-aware view, and close three in-flight items — as eight MECE commits that add only
optional fields to existing contracts and reach agents through two new MCP tools.

## Constraints discovered in Assess

| # | Finding | Evidence | Consequence |
|---|---|---|---|
| 1 | `scan()` returns a discriminated `completed / noop / busy` union; busy carries `retryable: true` | `src/types.ts:560-574`, `src/scanner.ts:584-606` | every new caller branches on `status` |
| 2 | lease acquired `scanner.ts:581-583`, released in `finally` `:2227-2231`; `_scanLease` internal-only | Assess | callers invoke `scan()` per repo; **no new lock code** |
| 3 | `getConfig()` is a cached singleton; `storagePath` is relative, joined with `projectRoot` | `config.ts:110-124`, `:381-386` | multi-root is safe in **local** mode only |
| 4 | `registerProject()` is already called by the scanner | `scanner.ts:2131` | **`src/scanner.ts` needs no edit** |
| 5 | `dist/` is **tracked** (376 files); each src commit carries its rebuild | `git ls-files dist`; commit `7a30d5f` | C8 runs `npm run build:cli` and commits `dist/` |
| 6 | trace already traverses `FILE:` nodes | probe 2026-08-03: A to FILE:src/x.ts to B reached B | gap #1 **partly-fixed**; residual is an owned FILE: id rendering synthetic |
| 7 | alias merging exists, on the human output path only | `cli/commands/list.ts:50-73` | gap #2 **partly-fixed**; `--json`/`--agent` bypass it |
| 8 | FoundationModels partly wired; `LanguageModelSession()` zero-arg only | `scanners/swift/code-scanner.ts:118-137` | KNOWN-ISSUES **partly-fixed** |
| 9 | Swift LLM emission has **two orphan-id bugs** | `code-scanner.ts:465` (compId computed before the guard), `:485` (`from` is a random `COMP_other_*`) | both fixed in C2 |
| 10 | `ArchitectureConnection` has no `metadata`; `ArchitectureComponent` does | `types.ts:123` | carry FoundationModels detail on the component |
| 11 | `loadArchitectureRecords` does not read `file_map.json` | `web/lib/server/architecture-storage.ts:81-116` | C3 adds an optional `fileMap` |
| 12 | the coverage route builds the legacy path **from segments** via `path.join` | `web/app/api/coverage/route.ts:39-41` | a literal string grep never matches it — falsifier rewritten |
| 13 | `config.ts:216 LEGACY_STORAGE_PATH` is **intentional** migration code | `HANDOFF-0.9.1.md:53` | excluded from any legacy-path search |
| 14 | tsconfig sets `module: NodeNext` | `tsconfig.json:4-5` | every relative import needs an explicit `.js` extension |
| 15 | vitest uses `root:'./src'` and `include:['**/__tests__/**/*.test.ts']` | `vitest.config.ts:4-6` | nested test dirs collect; **the root `__tests__/` never does** |
| 16 | `.navgator/architecture/` is gitignored | `.gitignore:15` | C4 needs no gitignore change |
| 17 | `web/` has **no test runner**; src tests import web modules relatively | `src/__tests__/web-architecture-storage.test.ts:5` | C3 tests live in `src/__tests__/` and import a Next-free module |
| 18 | `web/app/api/{trace,subgraph}/route.ts` independently synthesize FILE: nodes | `trace/route.ts:147-152`, `subgraph/route.ts:114-119` | C1 widens CLI/dashboard drift — surfaced and filed, not fixed here |
| 19 | `web/app/api/projects/route.ts` is a **second writer** of the project registry, hardcodes `version: 1`, and adds entries without `scanCount` | `:20-30`, `:55`, `:188-193` | C6 owns and fixes it |
| 20 | Claude auto-discovers `commands/`(13), `agents/`(4), `skills/`(6); `.claude-plugin/plugin.json` declares none of them; MCP is separate via `.mcp.json` | Assess + plan-critic | see Surface decision |
| 21 | **T1 Apple docs:** `@Generable` applies to **struct and enum only**; **no zero-arg `LanguageModelSession` initializer exists**; the trailing-closure construction form is valid; `import FoundationModels` is the only reliable anchor | developer.apple.com symbol JSON, 2026-08-03 | C2 patterns corrected |

## Surface decision — revised after plan-critic

Rev 1 shipped all three features CLI-only. plan-critic showed that is a reachability failure on file
evidence: `CLAUDE.md:76` tells NavGator's primary audience to use the MCP tools rather than reading
JSON files directly, `intent.md` names "the agent reading NavGator's graph" as audience #1, slash
commands and MCP tools are disjoint delivery paths, and Codex loads no commands at all. CLI-only
would ship three capabilities that no agent on either host can invoke. The `intent.md` non-goal is
MCP **resource** exposure — a different primitive from an MCP **tool**; citing it to skip tools
would be an equivocation.

**Revised: 10 to 12 MCP tools.**

- **Add** `portfolio` and `arch_diff` (read/scan over local paths).
- **Withhold `scan_remote` deliberately:** it runs `git clone` against a caller-supplied URL, so an
  agent-invokable tool would put a network fetch on a prompt-injection-reachable path. It ships
  CLI-only (human-initiated) and the rationale goes into `AGENTS.md` rather than staying implicit.
  Revisit behind a URL allowlist.
- **No new slash commands** — the 13/4/6 counts stay correct.
- Count sites to update in C8: `README.md:17,18,79,687` and `AGENTS.md:131` plus its tool table
  (10 to 12). `README.md:48` covers commands/subagents/skills only and is unchanged. `CLAUDE.md`
  carries no numeric count; add two table rows.

## Approach lenses

**Clean sheet** — portfolio, remote, and branch-aware scanning are three views over one "scan
target": resolve, scan, project. A `ScanTarget` interface would unify them.
**Current constraints** — `scan()` is 2473 lines with an internal lease, an internal config
snapshot, and eight underscore-prefixed internal options, on an unpushed RC with a no-regression bar.
**Bridge/backcast — chosen** — build all three as *callers* of `scan()`, each written in the same
resolve-scan-project shape, so a later `ScanTarget` extraction is mechanical rather than a redesign.
**Third option rejected** — a `scanMany()` wrapper inside `scanner.ts`: it puts multi-root iteration
in the highest-blast-radius file in the repo for no capability the caller pattern lacks.

**Path A vs Path B** fires on C2 (`LLMUseCase`), C3 (`ArchitectureRecords`), and C6
(`ProjectEntry`). **Path B in all three** — optional additive fields, each citing a named future
capability: a second local-LLM detector for C2; file-to-component lookup for the `status`,
`projects`, and future `explore` routes for C3; and for C6, criterion 1's falsifier is literally
"a second registry file appears".

## MECE ownership

`src/cli/index.ts`, `src/index.ts`, and `src/mcp/tools.ts` are owned **solely by C8**; C1 through C7
make only additive, signature-compatible changes, so none of them needs to edit those files.
`src/scanner.ts` is owned by **no chunk** (finding #4) — a documented waiver.

Batch 1 runs 6 in parallel (cpu 16, cap 8): C1 C2 C3 C4 C6 C7. Then C5 (needs C4). Then C8.

**Universal implementer rules:** explicit `.js` on every relative import (NodeNext); tests only
under `src/__tests__/`; never run `git add` or `git commit`; never touch `src/cli/index.ts`,
`src/index.ts`, `src/mcp/tools.ts`, or `src/scanner.ts`; the gates before returning are
`npx vitest run` (at least 567 passing) and `npm run typecheck` (exit 0).

### C1 — remaining-gaps triage: component identity and trace FILE: resolution (criterion 6)

Owns `src/component-identity.ts` (new), `src/resolve.ts`, `src/trace.ts`,
`src/cli/commands/list.ts`, `src/cli/commands/trace.ts`, `docs/specs/remaining-gaps.md`, and tests
`component-identity.test.ts` (new), `trace-file-nodes.test.ts` (new), `resolve.test.ts`,
`trace.test.ts`.

Waived as behavior-coupled but signature-stable, since the new step fires only where resolution
previously returned `null`: `src/subgraph.ts:50` and
`src/cli/commands/{impact,connections,schema,diagram}.ts`.

Triage all 8 gaps against 0.9.1 code **before** fixing anything; each gets a verdict of
already-fixed, partly-fixed, still-open, or superseded, plus a `file:line` or test citation.
Extract `list.ts:55-59` into `componentBaseName`, `identityKey`, and `mergeComponentAliases`
(keep-higher-connection-count, per `list.ts:64-71`); `list.ts` human output must not change. Add a
base-name step to `resolveComponent()` **between steps 4 and 5** so "Railway", "Railway Config", and
"Railway (infra)" collapse to one component. In `traceDataflow()`, resolve a `FILE:` path to its
owning component via `source.config_files` before synthesizing at `trace.ts:206`; the new
`TraceOptions.resolveFileNodes` defaults to **true** and `false` restores today's behavior. Thread a
`--raw-file-nodes` flag in `cli/commands/trace.ts:47`. Add a comment in `src/trace.ts` naming the
two web mirrors from finding #18 — do not change them.

Falsifier: a gap marked fixed with no citation; or a still-valid high-priority gap left
unimplemented without an explicit still-open verdict and reason; or **any existing resolve/trace
assertion edited**.

### C2 — Apple FoundationModels llm-map detection (criterion 5)

Owns `scanners/swift/code-scanner.ts`, `llm-dedup.ts`, `cli/commands/llm-map.ts`,
`cli/commands/status.ts`, `KNOWN-ISSUES.md`, and tests `swift-foundation-models.test.ts` (new) and
`llm-dedup.test.ts`.

**Patterns corrected by T1 Apple docs (finding #21):** the required anchor is
`import FoundationModels`, because a bare `.respond(` false-positives heavily across unrelated Swift
APIs. `@Generable` attaches to **struct and enum only** — handle the bare form, the
description-argument form, and the name-plus-description form, and note the annotation may sit on
the preceding line. Match `LanguageModelSession(` with **any** arguments plus the trailing-closure
construction form, since **no zero-arg initializer exists** and today's zero-arg-only pattern at
`:134` matches nothing real. Treat `respond(to:`, `respond(generating:`, `streamResponse(`,
`SystemLanguageModel`, and `@Guide(` as confirming-only signals, never standalone.

Emit a component named `Apple Foundation Models` (`type:'llm'`, `layer:'external'`) with
`metadata` carrying `provider:'apple-on-device'`, `kind:'foundation-models'`, and
`generable_schemas: string[]` (`types.ts:123`, so no type change). **Fix both orphan-id bugs
(finding #9):** reuse the existing component id when the `:467` guard hits, and change the `from`
endpoint at `:485` to the `FILE:` form so `scanner.ts:1578-1592` resolves it. `LLMUseCase` gains
optional `providerTag`, `kind`, and `structuredOutput`; surface them at `llm-map.ts:110` and
`status.ts:322`. Move the KNOWN-ISSUES item to a Closed section, recording the partial prior state
honestly.

Falsifier: the repro shapes yield zero use cases; or a use case lacks
`providerTag:'apple-on-device'`, `kind:'foundation-models'`, or a non-empty `structuredOutput`; or
any connection endpoint dangles.

### C3 — coverage API port to consolidated storage (criterion 4)

Owns `web/app/api/coverage/route.ts`, `web/lib/server/architecture-storage.ts`,
`web/lib/server/coverage.ts` (new, Next-free), and tests `web-architecture-storage.test.ts` and
`web-coverage-route.test.ts` (new).

Add a `file_map.json` reader accepting both the wrapped shape (`storage.ts:635-639`) and a bare map,
**preserving today's `parsed.files || parsed` fallback** (`route.ts:51`) or coverage silently
reports 0%. Expose an optional `fileMap`; the six existing callers destructure only components and
connections. Put the computation in `web/lib/server/coverage.ts` importing only `fs`, `path`, and
`glob` — no `next/*`, no `@/` alias — so `src/__tests__/` can import it relatively, the pattern
proven at `web-architecture-storage.test.ts:5`; `route.ts` becomes a thin handler.

This is a **rewrite, not a path swap**: the route's `loadJsonDir` reads per-entity directories that
are opt-in-**off** since v0.9.0, so it reports zeros today. Mirror `src/coverage.ts`: normalize
paths (`:214-220`) and intersect mapped-with-source (`:54-57`) so coverage cannot exceed 100%; honor
`.navgatorignore` plus the `.navgator`, `.rally`, `.build-loop`, and `.git` ignores (`:224-235`);
and emit `unmapped-file` gaps capped at 20 (`:79-91`). Keep the 60s cache, the root resolution, and
the `CoverageApiResponse` shape (`web/lib/types.ts:253-258`).

Falsifier: `web/` still constructs a legacy architecture path — checked as **path construction**
through `path.join`, not as a literal string grep, which finding #12 shows never matches.
`src/config.ts:216` is explicitly out of scope.

### C4 — canonical main plus branch delta, slice 3 (criterion 3), risk_reason persistence contract

Owns `src/git-aware/{paths,refs,canonical}.ts` (new) and tests
`src/__tests__/git-aware/{refs,canonical}.test.ts`.

Slice 3's documented purpose is separating committed architecture from local changes
(`docs/living-architecture.md:71-72`). **Invariant:** `.navgator/architecture/` keeps its exact
layout and stays the working view; new storage is strictly additive at `canonical/snapshot.json` and
`branches/<slug>/snapshot.json`. The slug maps `/` to double-underscore and any other character
outside `[A-Za-z0-9._-]` to underscore, caps at 100 characters, and appends an 8-character hash of
the original ref **whenever sanitization or truncation changed the string**, so two refs that
sanitize alike cannot collide. `refs.ts` provides `getDefaultBranch` (try the origin symbolic ref,
then `init.defaultBranch`, then probe main, then master, then null), `isDefaultBranch`, `isWorktree`
(`.git` is a **file**), and `slugifyRef` — all using `execFile` with argv arrays and a timeout per
`git.ts:33`, never throwing on a non-git directory. `canonical.ts` builds via the existing
`buildCurrentSnapshot()` (`diff.ts:399`) — no second snapshot shape — and writes with
`atomicWriteJSON` (`storage.ts:1783`); reads return null on missing or corrupt input. Wiring is
C8's; say so in the module doc comment.

Falsifier: a feature-branch write changes `canonical/snapshot.json` (assert byte-identical).

### C5 — pre-merge architecture diff, slice 4 (criterion 3), depends on C4

Owns `src/git-aware/premerge-diff.ts`, `src/cli/commands/arch-diff.ts` (new), and tests
`src/__tests__/git-aware/premerge-diff.test.ts`.

`premergeDiff(root, {base})` reads the canonical (or named base) and current-branch snapshots and
delegates to the existing `computeArchitectureDiff()` (`diff.ts:46`) and `classifySignificance()`
(`:180`) — no second diff engine. It returns base, head, available, an optional reason, an optional
diff, and an optional significance; a missing base yields `available:false` plus an actionable
reason, **never an empty diff that reads as "no changes"**. Exports
`registerArchDiffCommand(program)` for `navgator arch-diff` with `--base`, `--record`, `--json`, and
`--agent`; `--record` writes the current ref's snapshot via C4, and without it the command is
read-only. This supplies criterion 3's invocation surface.

### C6 — multi-repo portfolio scanning (criterion 1)

Owns `src/portfolio/{types,discover,scan,cross-repo}.ts` (new), `src/cli/commands/portfolio.ts`
(new), `src/projects.ts`, `src/cli/commands/misc.ts`, `web/app/api/projects/route.ts`, and tests
`src/__tests__/portfolio/*.test.ts` (new) and `src/__tests__/projects.test.ts` (new — none exists).

`discoverRepos` returns children containing `.git` as either a directory or a file, so worktrees
count; depth 1 by default with `--depth` capped at 3; skips symlinks; never descends
`node_modules`; sorts deterministically.
`scanPortfolio` **hard-refuses shared storage mode with an explanatory message**, because shared
mode resolves one storage path for all roots (`config.ts:114-118`) so every repo would overwrite the
previous — the likeliest silent-corruption path. It scans sequentially by default with
`--concurrency` capped at 4, calls `scan(repoRoot, {mode:'auto'})` once per repo so each gets its
own lease, records stats on completed or noop, records and **continues** on busy, records failed and
continues on a throw, and never aborts the sweep. It does **not** call `registerProject()`
(finding #4).
`buildCrossRepoMap` keys shared dependencies on **`stable_id` when present**, falling back to C1's
`identityKey`, reporting per-repo version and a version-skew flag. Cross-repo service calls are
matched against the other repo's `RuntimeIdentity` (`service_name`, `endpoint.host`, `endpoint.port`
at `types.ts:170-187`); every edge carries a confidence and a basis and is labeled **heuristic
(TAG:INFERRED)** in every output mode, never rendered as a verified call graph. Status reports
counts, stale repos (older than 24h, reusing `projects.ts:170`), and failed and busy repos.
`ProjectEntry` gains an optional `origin` (kind local or remote, plus url and cachePath) and an
optional `portfolio` root; the registry version stays 2; add `updateProjectMeta(root, patch)` as a
read-modify-write that preserves unknown fields. **Fix the second registry writer (finding #19):**
make `web/app/api/projects/route.ts` write `version: 2` and `scanCount: 0`, and confirm its
read-modify-write cannot strip `origin`, `portfolio`, `stats`, or `git` from sibling entries — a
minimal fix, not a refactor. Surface origin and portfolio at `misc.ts:481`. Export
`registerPortfolioCommand(program)` for `navgator portfolio [dir]` with `--depth`, `--concurrency`,
`--json`, and `--agent`.

Falsifier: a second registry file appears; or a repo is scanned without a lease; or the cross-repo
map comes back **empty on a fixture that contains a genuine shared dependency**.

### C7 — remote GitHub scanning (criterion 2), risk_reason runtime protocol, sets riskSurfaceChange

Owns `src/remote/{github-url,clone,scan-remote}.ts` (new), `src/cli/commands/remote.ts` (new), and
tests `src/__tests__/remote/*.test.ts` (new).

`parseGitHubUrl` is a strict **allowlist**: it accepts only the https github.com owner/repo form
with an optional `.git` suffix and an optional `/tree/<ref>` suffix, the ssh `git@github.com:` form,
and the bare owner/repo shorthand. Owner and repo must match `^[A-Za-z0-9._-]+$`; ref additionally
allows `/`. It rejects parent-directory traversal, a leading dash, the `file://` scheme, and any
bare local path — a local-path clone would copy the source's `.git/hooks`. Anything else returns
null.
`ensureClone` uses the cache directory under the user's `.navgator` cache root, asserts the resolved
destination stays inside that root, and invokes `execFile('git', [...])` with a **argv array and
`shell:false`, never a template string**, with an explicit timeout and the child environment
hardened so git never prompts for credentials and ignores system config. An existing cache is
refreshed with a shallow fetch plus a hard reset; `--refresh` forces a clean re-clone.
`scanRemote` parses, clones, calls `scan(cloneDir, {mode:'auto'})`, branches on the outcome, and
records the remote origin through `updateProjectMeta`.

Tests require **no network** — the exec is injected. The parser table accepts the three valid shapes
and rejects a non-github host, a URL carrying an appended shell command separator, a
parent-traversal path, a `file://` URL, a leading-dash argument-injection payload, backtick and
command-substitution and newline payloads, and an over-long ref. The clone argv is asserted
element-by-element, cache containment holds, and a busy scan surfaces as retryable rather than a
crash. A source check confirms no shell-invoking exec form appears anywhere under `src/remote/`.

### C8 — integration: CLI, barrel, MCP tools, docs, dist — depends on C1 through C7

Owns `src/cli/index.ts`, `src/index.ts`, `src/mcp/tools.ts`, `README.md`, `CLAUDE.md`, `AGENTS.md`,
`docs/living-architecture.md`, `src/__tests__/cli-commands.test.ts`, and `dist/**`.

Register the three commands beside the existing 23 calls at `cli/index.ts:66-89`, taking the
top-level command count from 29 to 32. Barrel-export the new symbols. Add `portfolio` and
`arch_diff` to `TOOLS` (`mcp/tools.ts:47-277`) and to the `handleToolCall` switch (`:290-310`);
**do not add `scan_remote`**, and record the security rationale in `AGENTS.md`. Update the MCP count
from 10 to 12 at `README.md:17,18,79,687` and `AGENTS.md:131` plus its tool table; leave
`README.md:48` unchanged; re-verify all seven sites. Move slices 3 and 4 to built in
`docs/living-architecture.md`, leaving slice 2 not-built. Append CLI-registration assertions. Run
`npm run build:cli` and commit the `dist/` delta.

## Integration checkpoints

1. After batch 1 — `npx vitest run` (at least 567) and `npm run typecheck` (0) before C5 dispatches.
2. After C5 — the same two gates.
3. After C8 — both gates, plus `npm run build`, plus a clean `git status -- dist`, plus the seven
   doc-count sites re-verified.

## Verification tiers

| Claim | Verified by |
|---|---|
| contracts unbroken | typecheck exit 0 plus 567 tests, with **no assertion edited** |
| each criterion | its own named test file |
| no shell injection (C7) | argv element assertions plus a source scan of `src/remote/` for shell-invoking exec forms |
| no second registry (C6) | a HOME-redirected test asserting only `projects.json` is written |
| canonical not clobbered (C4) | byte-identical assertion across a branch write |
| no legacy path (C3) | a `path.join` construction search over `web/`, excluding `config.ts:216` |
| dist in sync | empty `git status -- dist` after `npm run build:cli` |
| doc counts true | re-read of the 7 sites plus `release-contract.test.ts` |

## Commit sequence

C1, C2, C3, C4, C6, C7 in parallel, committed as each returns, then C5, then C8. Eight local commits
on `main`. **No push, no tag, no publish** (`docs/HANDOFF-0.9.1.md:3`).
