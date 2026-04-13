# Scorecard — NavGator Global Install + Global Lessons

**Build:** NavGator Global Install + Data-Split Clarification
**Date:** 2026-04-12
**Goal:** `.build-loop/goal.md`
**Plan:** `.build-loop/plan.md`
**Status:** ✅ **ALL CRITERIA PASS** (pending T5 `/reload-plugins` verification by user)

## Summary

NavGator is now registered as a Claude Code plugin alongside the existing CLI
install. All five manifest-level latent bugs fixed. Global lessons store
implemented with 18 new tests + 3 new CLI subcommands + new slash command +
three-tier data model documented in CLAUDE.md. Build-loop → plugin-dev
bridge memory captured for future plugin work.

## Scorecard

| # | Criterion | Grader | Result | Evidence |
|---|---|---|---|---|
| 1 | plugin.json has no duplicate paths | grep + parse | ✅ PASS | Only 8 metadata keys remain; none of `hooks`, `skills`, `agents`, `commands`, `mcpServers` present |
| 2 | .mcp.json correct shape | JSON parse + skill reference | ✅ PASS | Unwrapped format per `mcp-integration` skill Method 1 (dedicated .mcp.json); top-level key is `navgator` (server name) |
| 3 | Registered in Claude Code settings | settings.json parse | ✅ PASS | `extraKnownMarketplaces.navgator` → directory pointing at repo; `enabledPlugins["gator@navgator"]` = true |
| 4 | `/reload-plugins` clean | Manual | ⏳ PENDING — user runs after this commit | Predicted clean: mirrors mockup-gallery fix pattern exactly; manifest validates identically |
| 5 | Global lessons store functional | CLI + tests | ✅ PASS | `~/.navgator/lessons/global-lessons.json` seeded; `navgator lessons list --global` returns `Global Lessons (0)`; 18/18 new tests pass in-suite with 286/286 total |

## Artifacts

### Files modified (5)
| Path | Change |
|---|---|
| `.claude-plugin/plugin.json` | Removed 5 duplicate-path fields, kept 8 metadata keys |
| `.claude-plugin/marketplace.json` | Versions reconciled to 0.6.1 (metadata + plugins[0]) |
| `src/cli/index.ts` | +2 lines: import + `registerLessonsCommand(program)` |
| `CLAUDE.md` | +40 lines: three-tier data model, lessons CLI table |
| `~/.claude/settings.json` | Added `gator@navgator: true` + `navgator` marketplace entry |

### Files created (5)
| Path | LOC | Purpose |
|---|---|---|
| `src/lessons-store.ts` | 305 | Global/local lessons filesystem abstraction |
| `src/cli/commands/lessons.ts` | 241 | CLI: list/show/search/promote/demote |
| `src/__tests__/lessons-store.test.ts` | 207 | 18 vitest tests |
| `commands/lessons.md` | ~60 | `/gator:lessons` slash command |
| `~/.navgator/lessons/global-lessons.json` | seed | Global lessons JSON, empty array |

### Memory (1 file + 1 index update)
| Path | Purpose |
|---|---|
| `~/.claude/projects/-Users-tyroneross/memory/feedback_build_loop_plugin_dev.md` | Build-loop → plugin-dev bridge: load plugin-dev skills before any manifest/hook/MCP edit |
| `~/.claude/projects/-Users-tyroneross/memory/MEMORY.md` | Added entry pointing at the new feedback memory |

## Test totals

```
Test files  21 passed (21)
Tests       286 passed (286)
Duration    1.66s
```

- **Before**: 268 tests
- **After**: 286 tests (+18 new lessons tests)
- **Existing test regressions**: 0

## Assumptions noted during build

From subagent report on T6:

1. **TAG:ASSUMED** — Repo template `.navgator/lessons/lessons.json` has a `_template` field not in the documented schema. `readLessons` preserves it to avoid clobbering; not typed or validated. Behavior unchanged.
2. **TAG:ASSUMED** — `demote --keep-local` flag is a no-op (local is always preserved; demote never touches local). Matches spec intent without adding destructive path.
3. **TAG:ASSUMED** — Malformed global-lessons.json is treated as empty so callers can recover. Non-ENOENT/non-SyntaxError failures still throw.

From my own Phase 1 analysis:

4. **TAG:ASSUMED** — `.mcp.json` unwrapped format is correct for dedicated files. The `mcp-integration` skill explicitly says Method 1 has server-name at top level (no `mcpServers` wrapper). NavGator's current unwrapped format retained unchanged. (Contrast: earlier mockup-gallery fix wrapped it — may also work due to parser leniency.)

## ⚠️ Findings — not build failures

### F1. Plugin internal name inconsistency
Plugin internal name is `gator`. CLI is `navgator`. Package is `@tyroneross/navgator`. Marketplace is `navgator`. User-facing enabledPlugins key is `gator@navgator`.

**Impact:** Low. Everything works. Could confuse users reading the manifest.
**Deferred per Q1** (user rec: keep `gator`).

### F2. Hooks are `type: "prompt"` (5 of 5)
All hooks use prompt-type, which `feedback_hook_design.md` memory explicitly flags as anti-pattern ("always noisy, use command-type with silent exit").

**Impact:** Medium. Hooks will produce unsolicited reminders on every session start / edit / bash call.
**Deferred per Q4** (user rec: out of scope).

### F3. Existing per-project lessons.json has `_template` field
The repo's own `.navgator/lessons/lessons.json` carries a `_template` object that's not in the documented schema. Harmless; preserved on read/write.

**Impact:** Low.
**Action:** Flag only. Schema spec may need updating to document it, or the template should be deleted.

## Phase 7 — FACT CHECK & MOCK SCAN (compressed)

**Gate A — Fact Checker.** No rendered metrics or user-facing percentages. N/A.
**Gate B — Mock Data Scanner.** Grepped production paths for mock patterns. No hits. ✅

## Phase 8 — REPORT

### ✅ Known working (verified)
- Plugin manifest clean (no duplicate paths, versions consistent)
- settings.json registered correctly
- 286 tests pass
- `navgator lessons` CLI end-to-end (promote + list + search round-trip verified via subagent smoke test in a scratch project)
- `~/.navgator/lessons/global-lessons.json` seeded
- CLAUDE.md + new slash command documented
- Build-loop → plugin-dev memory bridge indexed and available for future sessions

### ⏳ Pending (user action required)
- `/reload-plugins` + `/doctor` — confirm plugin count goes from 14 → 15 with zero new errors. Predicted clean based on mirror-of-mockup-gallery fix pattern.

### ⚠️ Flagged (deferred by design)
- F1 (plugin name inconsistency)
- F2 (prompt-type hooks)
- F3 (`_template` field in lessons.json)

## Followups recommended

1. After `/reload-plugins` is clean: commit the NavGator repo changes as a scoped commit
2. Commit `~/.claude/settings.json` addition (already live; git doesn't track it — no action)
3. Consider hook rewrite (F2) as its own build-loop — 5 prompt → command conversions with its own test matrix
4. Consider plugin name rename (F1) as a separate breaking-change build-loop if consistency matters more than stability

## Feedback entry

```
2026-04-12 | NavGator install + global lessons shipped in one pass | Loading plugin-dev skills (plugin-structure, plugin-settings, mcp-integration) during Phase 1 correctly flagged the wrapped-vs-unwrapped .mcp.json ambiguity. Subagent delivered 750 LOC across T6 with 18 new tests passing + zero regressions on 268 existing. Memory bridge (feedback_build_loop_plugin_dev.md) captured so future plugin work auto-loads these skills.
```
