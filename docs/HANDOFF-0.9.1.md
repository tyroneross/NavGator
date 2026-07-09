# NavGator 0.9.1 implementation handoff

Status: **local release candidate; do not push, tag, or publish without user authorization**

Updated: 2026-07-09

Branch: `bl/run-487183`

Build Loop run: `bl-20260709T190008Z-codex-487183`

## Outcome

NavGator 0.9.1 now has one package contract for Claude Code and Codex, a race-safe scanner boundary, a portable loopback dashboard, and an exact-artifact release pipeline. The implementation has passed the source, type, build, package, dashboard, Claude, and Codex checks listed below.

Nothing from this run has been pushed, tagged, published, or installed into the user's real Claude/Codex configuration.

## Assessment

The release approach is sound:

- scans return typed `completed | noop | busy` outcomes and use one owner-safe writer lease;
- lease ownership covers legacy migration, setup scans, MCP scans, and freshness reconciliation;
- the default graph uses complete consolidated records while derived compact views stay explicitly lossy;
- Claude receives 13 commands, 4 subagents, 6 skills, and 10 MCP tools;
- Codex receives the portable intersection: 6 skills and 10 MCP tools;
- Codex executes its versioned installed cache, not a mutable registration source, while scanning the active task workspace;
- the packaged dashboard reads consolidated data, bounds graph traversal, rejects cross-origin/host attacks, denies framing, and forces loopback binding even when launched directly;
- CI and publishing audit production dependencies, pin Actions by commit, verify one tarball, hash it, and pass only that artifact into the credentialed publish job.

## Commits on the run branch

| Commit | Outcome |
|---|---|
| `2546f73` | Added the typed top-level scan outcome contract. |
| `1d2f395` | Corrected directed reachability, nested aliases, and coverage arithmetic. |
| `75a1cde` | Added bounded, rule-aware agent output and truthful CLI/MCP boundaries. |
| `550af2f` | Made scan freshness, lease publication, dirty reconciliation, and stamp ordering race-safe. |
| `4b55830` | Integrated dual-host packaging, dashboard runtime, installers, documentation, and release gates. |
| `41a4845` | Closed final review findings for setup phase, atomic ignore writes, and direct-launch loopback enforcement. |

The final review follow-up is committed in `41a4845`; this document is the remaining local handoff record.

## Implemented behavior

### Scanner and storage trust

- Default incremental results match a subsequent full scan after removals.
- One `.navgator/scan.lock` lease uses complete atomic publication, owner tokens, heartbeat, process identity, and owner-safe release.
- Storage creation and legacy migration occur only after lease acquisition.
- Each scan receives an isolated config snapshot; a busy contender cannot mutate the winner's settings.
- Dirty events are immutable and reconciled by exact generation so late edits survive a drain.
- MCP scans use automatic mode, allowing manifest and nested config changes to promote to full scans.
- Setup forces its deep scan, records `fast | deep` in the canonical index under the lease, and creates no legacy `.claude/architecture` state.
- Freshness/lease files are ignored through the project `.gitignore` or Git's private exclude file. Symlinked ignore targets are not followed; updates use an exclusive temporary file plus atomic rename.

### Claude and Codex host surfaces

- Package identity is `navgator` / `@tyroneross/navgator` version `0.9.1`, Apache-2.0.
- Claude installation uses the Claude marketplace/install/update/enable lifecycle and verifies the exact enabled version plus cached MCP dependencies.
- Codex registration materializes a non-empty marketplace source and points the MCP executable at the deterministic versioned Codex cache.
- User and workspace installers reject symlinked destination components and keep marketplace/config writes inside the selected root.
- Codex cache tests mutate and delete the registration source, then prove the installed MCP still initializes and scans a new active workspace.
- Hooks remain empty on both hosts.

### Dashboard and package

- Next.js is pinned to `16.2.10`; root and web production audits report zero vulnerabilities.
- Dashboard APIs share one consolidated storage loader with complete JSONL and compact fallbacks.
- `/api/scan` parses typed `--json` output and preserves `completed`, `noop`, and retryable `busy` states.
- Trace and subgraph traversal have bounded depth, queue/expansion, path, and node limits.
- The package contains a platform-neutral standalone runtime without nested `node_modules`, symlinks, native binaries, compiled tests, or local build paths.
- The direct package launcher forces `127.0.0.1`; request guards reject DNS-rebinding hosts and unsafe mutations; CSP and `X-Frame-Options` prevent framing.

### Release pipeline

- Pull-request/push CI runs the full suite, root/web typechecks, production audits, build, and packed verifier.
- Host CI installs pinned Claude/Codex CLI versions and requires both lifecycle checks.
- Publish builds and verifies without write credentials, packs once, verifies that exact tarball, hashes/uploads it, then publishes only the downloaded hash-checked artifact.
- GitHub Actions are pinned to commit SHAs.
- Tag/package version mismatch blocks publishing.

## Verification evidence

Final post-mutation evidence:

| Check | Result |
|---|---|
| Focused release/storage/scan/setup/ignore tests | 7 files, 75 tests passed before the final hardening; final focused setup/ignore/release set: 3 files, 22 passed |
| Setup/scanner/boundary regression set | 3 files, 54 tests passed |
| TypeScript | `npm run typecheck` passed for root, tests, and web |
| Final full suite | 49 files, 558 tests passed after all setup, launcher, and gitignore hardening |
| Production dependency audit | Root: 0 vulnerabilities; web: 0 vulnerabilities |
| Clean production build | Passed with Next 16.2.10; one non-fatal dynamic file-tracing warning remains because dashboard routes read user-selected project paths |
| Required host verifier | Final run passed with Claude plus bundled Codex 0.144, including user/workspace registration, cache independence, 6 Codex skills, 10 tools, direct-launch loopback, dashboard security, and runtime probes |
| Self-scan | 339 components, 820 connections, 0 warnings |
| Bounded agent output | Summary 53,059 bytes; rules returned 50 of 386; coverage returned 50 of 222 with explicit truncation metadata |
| Build Loop advisory contracts | Skill resolution, manifest, trigger, and bridge tests passed; MCP tests skipped where the Build Loop manifest intentionally declares no inline server |
| Build Loop learn pass | Accruing: 1 of 3 recorded runs; recurrence detector found no patterns and created no experimental artifacts |
| Independent review | Cross-vendor Claude Opus approved conditionally; final whole-diff code review is clean; final security review is clean with no critical/high findings |

One full-suite attempt during simultaneous independent audit scans hit six five-second high-load timeouts. The isolated post-review rerun passed all 558 tests and is the release evidence.

## Reproducible closeout sequence

The following sequence passed from the repository root after the final code mutation:

```bash
npm test
npm run typecheck
npm audit --omit=dev --audit-level=moderate
npm --prefix web audit --omit=dev --audit-level=moderate
npm run clean
npm run build

PATH=/Applications/Codex.app/Contents/Resources:$PATH \
REQUIRE_CLAUDE_VALIDATION=1 \
REQUIRE_CODEX_VALIDATION=1 \
npm run verify:release

git diff --check
```

Remaining handoff actions:

1. Keep the branch local until the user explicitly requests push, PR, tag, or publish.
2. Let clean CI prove pinned Codex `0.130.0`; local validation used the healthy bundled Codex `0.144.0-alpha.4`.
3. After an authorized 0.9.1 publication, update the external RossLabs marketplace as a separate action.

## Residual and deferred work

- Whole-generation transactional storage is deferred. Individual files are atomic and one writer is enforced, but an interrupted multi-file generation can still require a full refresh.
- A hung but live scan owner can retain the lease indefinitely. This favors split-brain prevention over automatic recovery.
- The dashboard exposes a documented six-rule subset; the CLI/MCP rule engine remains authoritative for all fourteen rules.
- Codex's deterministic cache layout is a host contract. Bundled 0.144 passed locally; pinned 0.130 remains a clean-CI gate.
- Workspace installers intentionally create `.claude/`, `.codex/`, or `.agents/` runtime metadata in the selected workspace.
- The dashboard has no authentication because it is forced to loopback. Any tunnel or reverse proxy requires a separate authentication boundary.

## Local Codex CLI incident

The Homebrew wrapper at `/opt/homebrew/bin/codex` currently lacks its expected native 0.130 executable. During the review, a temporary pinned binary was hard-linked to that global native file; later temporary cleanup and timeout experiments correlated with the global file disappearing. That coupling is the leading cause, although exact causality was not proven.

No repair was attempted because global tool repair was outside the repository task and requires user authorization. The healthy bundled Codex executable under the Codex application was used for all final local host checks. The next owner should ask the user before reinstalling or repairing the Homebrew Codex CLI.

## Agents loaded and why

| Agent | Why loaded | Result |
|---|---|---|
| Root Build Loop orchestrator | Own scope, integration, verification, commits, and handoff | Active through closeout |
| Graph trust implementer/reviewer | Correct direction, alias, and coverage semantics | Landed in `1d2f395` |
| Scan correctness implementer/reviewers | Break and repair incremental, lease, dirty-ledger, and setup behavior | Landed through `550af2f` plus final setup follow-up |
| Host parity implementer/reviewer | Separate Claude and Codex discovery/process contracts | Integrated in `4b55830` |
| Plan critic and scope auditor | Find missing callers, activation gaps, and ownership conflicts before edits | Plan accepted after findings were absorbed |
| Whole-diff auditor | Independently test the combined implementation | Code contract clean; required this handoff rewrite |
| Security auditor | Review dependency, host, installer, dashboard, and publish boundaries | Clean; no critical/high findings |
| Fact/mock/privacy auditor | Check package claims, mock labeling, and local-path leakage | Findings closed in docs/runtime verifier |
| Installer-security implementer | Make Codex cache source-independent and installers symlink-safe | Required-host verifier passed |
| Documentation accuracy implementer | Align storage schema, scanner claims, and non-repo install instructions | Completed |
| Claude Opus cross-vendor reviewer | Review the same diff with another vendor/model | Approved subject to executable gates |

## Plugins and skills loaded and why

| Capability | Why loaded | Action taken |
|---|---|---|
| `build-loop:build-loop` | Explicit user request; multi-step implementation needed gated planning, delegated review, and proof | Used the isolated run branch, phase gates, independent reviews, and closeout records |
| `build-loop:self-improve` | Mandatory Build Loop learn phase | Run-record and recurrence scan at closeout; no cross-project promotion without user approval |
| Claude plugin lifecycle | Validate Claude's actual registry/cache behavior | Used only inside isolated temporary homes |
| Codex plugin lifecycle | Validate marketplace, install, new-task skills, cache MCP, and active-workspace behavior | Used only inside isolated temporary homes with the bundled Codex binary |
| NavGator CLI/MCP/dashboard | Test the product from its packed artifact | Self-scan, bounded output, 10-tool MCP initialization, and dashboard HTTP/security probes |

No connector app plugin was relevant, and none was installed. NavGator itself was tested as the plugin under construction; the user's real global Claude/Codex plugin state was not changed.
