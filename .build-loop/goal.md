# Goal + acceptance criteria — portfolio / remote / git-aware scanning

> Supersedes the 0.9.1 release-gate goal (that run closed; see docs/HANDOFF-0.9.1.md).

## Goal

Ship six work items into NavGator 0.9.1 locally, preserving every 0.9.1 contract
and the green 567-test / 0-error-typecheck baseline.

## Acceptance criteria (scored at Review-G)

1. **Portfolio scanning works end to end.** `navgator portfolio scan <dir>`
   discovers git repos under `<dir>`, scans each through the existing `scan()`
   pipeline under its own lease, registers each in `~/.navgator/projects.json`
   via `registerProject()`, and emits a cross-repo map with shared dependencies,
   candidate cross-repo service calls, and portfolio-level status.
   *Falsifier:* a second project registry file appears, or a repo is scanned
   without acquiring its lease.

2. **Remote scanning works end to end.** `navgator scan-remote <github-url>`
   shallow-clones to a cache dir, runs the existing pipeline, reports, and
   registers. URL parsing rejects non-GitHub and shell-metacharacter input; git
   is invoked with argv arrays, never a shell string.
   *Falsifier:* any code path passes a URL into a shell, or the clone runs
   without validation.

3. **Git-aware storage + pre-merge diff.** A canonical main-branch graph and a
   branch/worktree delta coexist without either clobbering the other, and a
   pre-merge architecture diff reports component/connection deltas between the
   current branch and canonical main.
   *Falsifier:* scanning on a feature branch overwrites the canonical main graph.

4. **Coverage API reads current storage.** `web/app/api/coverage/route.ts` reads
   `.navgator/architecture/{components.full.jsonl, connections.full.jsonl,
   file_map.json}` (wrapped shape) through the shared web loader and returns a
   `CoverageApiResponse` whose numbers match `src/coverage.ts` semantics on the
   same input.
   *Falsifier:* any remaining reference to `.claude/architecture`.

5. **FoundationModels use cases detected.** A Swift file with
   `import FoundationModels` + a `@Generable` type, a `LanguageModelSession(...)`
   construction, or a `.respond(...)` call registers an LLM use case tagged
   `provider: apple-on-device`, `kind: foundation-models`, surfacing the
   `@Generable` schema name as the structured-output contract.
   *Falsifier:* a fixture with those shapes yields zero LLM use cases.

6. **remaining-gaps triage is evidence-based.** Every gap in
   `docs/specs/remaining-gaps.md` carries a verified verdict against 0.9.1 code
   (already-fixed | still-open | superseded), and the still-valid high-priority
   items (trace `FILE:` pass-through, component naming aliases) are either
   implemented or shown already-satisfied by a test.
   *Falsifier:* a gap is marked fixed with no test or code citation.

## Global gates (all must hold)

- `npx vitest run` — 567 baseline tests still pass, plus new tests.
- `npm run typecheck` — exit 0 across root, tests, and web.
- Dual-host manifests and the counts quoted in README.md / CLAUDE.md are updated
  together if any command or MCP tool is added.
- No push, no tag, no publish. Local commits on `main` only.

## Synthesis dimensions

scan-lease concurrency · storage layout (canonical vs delta) · cross-repo
identity inference · CLI + MCP + dual-host manifest surface · Swift scanner
heuristics · web dashboard data contract · git worktree/branch semantics
= **7 → thinking-tier routing for plan synthesis and verification verdicts.**
