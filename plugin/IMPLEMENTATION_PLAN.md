# NavGator Plugin Implementation Plan

## Implementation Sequence

Build order follows dependency chain: foundation first, then hooks that depend on it, then commands and agents that use both.

---

## Phase 1: Plugin Skeleton + CLAUDE.md (no dependencies)

**Files:**
- `plugin/.claude-plugin/plugin.json` — move and extend existing skeleton with commands, hooks, agents declarations
- `plugin/CLAUDE.md` — plugin-level instructions telling Claude how to use NavGator context

**Why first:** Everything else references plugin.json declarations and CLAUDE.md sets the behavioral contract.

**Risk:** Plugin manifest schema is not well-documented. Mitigate by keeping declarations minimal and testing each addition.

**CLAUDE.md content strategy:**
- Instruct Claude to read SUMMARY.md at session start
- Explain the tiered context model (hot/compressed/detail)
- List available commands
- Explain when to consult architecture data (before editing tracked files, after dependency changes)

---

## Phase 2: Session-Start Hook (depends on Phase 1)

**File:** `plugin/hooks/session-start.md`

**Logic:**
1. Check if `.claude/architecture/SUMMARY.md` exists in the project being worked on
2. If exists, instruct Claude to read it (the file is small, ~40 lines for current project)
3. Check `last_scan` timestamp from `index.json` — if older than 24 hours, append a staleness warning
4. If no architecture data exists, do nothing (graceful skip)

**Decision:** `{"decision": "continue"}` always — this hook only informs, never blocks.

**Speed concern:** Only two file existence checks + one file read. Sub-10ms. Safe.

**Risk:** Low. Worst case is the hook silently fails and Claude starts without context (same as today).

---

## Phase 3: Architecture-Check Hook (depends on Phase 1)

**File:** `plugin/hooks/architecture-check.md`

**Trigger:** PreToolUse on Edit, Write, MultiEdit

**Logic:**
1. Extract the file path from the tool input
2. Load `index.json` (cached after first load ideally, but plugin hooks are stateless so must read each time)
3. Scan components for matching `source.files` or `source.config_files` entries
4. If match found, surface: component name, layer, connections to/from it, and pointer to detail file
5. If no match or no architecture data, skip silently

**Decision:** `{"decision": "continue", "reason": "This file is part of [component]. Connected to: [list]. Detail: components/COMP_xxx.json"}`

**Speed concern:** Must read `index.json` + potentially scan component files. For the current 8-component project this is trivial. For 200+ components, index.json lookup by file path is O(n) unless we add a file-path index.

**Risk: Medium.** The current index does NOT have a `by_file` lookup. Components store file paths in `source.files[]` but the index only indexes by name/type/layer/status. Two options:
- **Option A (recommended):** Build a lightweight file-path map during scan, store as `file_map.json` — a flat `{filepath: component_id}` object. Fast lookup, single read.
- **Option B:** Scan all component JSON files in the hook. Too slow for large projects.

**Dependency on storage.ts:** Option A requires a new function `buildFileMap()` in storage.ts. This is the only source code change needed in the core NavGator codebase.

---

## Phase 4: Package-Change Hook (depends on Phase 1)

**File:** `plugin/hooks/package-change.md`

**Trigger:** PostToolUse on Bash

**Logic:**
1. Check if the Bash command output or input contains package manager patterns: `npm install`, `npm i`, `yarn add`, `pip install`, `cargo add`, `pnpm add`, `bun add`
2. If detected, remind: "Dependencies changed. Architecture data may be stale. Run /navgator:scan to update."

**Decision:** `{"decision": "continue", "reason": "..."}` — inform only.

**Speed concern:** String match on command text. Instant.

**Risk:** Low. False positives possible (e.g., `echo "npm install"`) but harmless since the reminder is non-blocking.

---

## Phase 5: Commands (depends on Phase 1)

**Files:**
- `plugin/commands/scan.md` — `/navgator:scan` — run `npx navgator scan` in the project root
- `plugin/commands/status.md` — `/navgator:status` — read and display SUMMARY.md
- `plugin/commands/ui.md` — `/navgator:ui` — launch `npx navgator ui` (web dashboard)
- `plugin/commands/impact.md` — `/navgator:impact <file>` — given a file path, show all components and connections that touch it

**These are markdown instruction files, not executable code.** They tell Claude what to do when the user invokes the command.

**Risk:** Low. Commands are just structured prompts.

---

## Phase 6: Architecture-Aware Agent (depends on Phases 1-5)

**File:** `plugin/agents/architecture-aware.md`

**Purpose:** A subagent that can answer architecture questions by reading the tiered context:
- Start with SUMMARY.md
- Drill into specific component/connection JSON files as needed
- Answer questions like "what calls the auth service?" or "what would break if I change this file?"

**Risk:** Medium. Agent quality depends on good instructions. Iterate based on testing.

---

## Phase 7: Summary Compression (depends on Phase 2)

**Changes to:** `src/storage.ts` — `buildSummary()` function

**Logic:**
1. After building the full summary, count lines
2. If > 150 lines (roughly 2000 tokens):
   - Write the full version to `SUMMARY_FULL.md`
   - Generate compressed version: top 10 components per layer, top 10 connections, truncated AI routing
   - Add header: `> Compressed summary. Full version: SUMMARY_FULL.md`
   - Write compressed version to `SUMMARY.md`
3. If <= 150 lines, write normally (no SUMMARY_FULL.md needed)

**Risk:** Low for current project (41 lines). Only matters for large projects. Can defer without blocking other phases.

---

## Dependency Graph

```
Phase 1 (skeleton + CLAUDE.md)
  |
  +-- Phase 2 (session-start hook)
  |     |
  |     +-- Phase 7 (compression - can defer)
  |
  +-- Phase 3 (architecture-check hook)
  |     |
  |     +-- requires file_map.json addition to storage.ts
  |
  +-- Phase 4 (package-change hook)
  |
  +-- Phase 5 (commands)
  |
  +-- Phase 6 (agent - last, depends on all above)
```

---

## Key Risks Summary

| Risk | Severity | Mitigation |
|------|----------|------------|
| No `by_file` index for architecture-check hook | High | Build `file_map.json` in Phase 3 (requires storage.ts change) |
| Plugin manifest schema undocumented | Medium | Start minimal, test incrementally |
| Hook speed on large projects | Medium | file_map.json keeps lookups O(1); compression keeps SUMMARY.md small |
| Stateless hooks re-reading files every invocation | Low | Files are small JSON; OS file cache handles this |
| Compression threshold wrong | Low | 150 lines is a starting heuristic; tune based on real projects |

---

## Source Code Changes Required

Only one file in the core NavGator codebase needs modification:

**`/Users/tyroneross/Desktop/git-folder/NavGator/src/storage.ts`**

1. **Add `buildFileMap()`** — generates `file_map.json` mapping file paths to component IDs. Called during `buildIndex()`. Enables O(1) lookup in the architecture-check hook.

2. **Add compression to `buildSummary()`** — when output exceeds 150 lines, write full to `SUMMARY_FULL.md` and compressed to `SUMMARY.md`.

3. **Add `getSummaryFullPath()` to config.ts** — path helper for `SUMMARY_FULL.md`.

Everything else is new plugin files (markdown + JSON). No existing behavior changes.

---

## Estimated Effort

| Phase | Files | Complexity | Estimate |
|-------|-------|------------|----------|
| 1 - Skeleton | 2 | Low | 30 min |
| 2 - Session hook | 1 | Low | 20 min |
| 3 - Architecture hook + file_map | 1 plugin + 1 storage.ts | Medium | 1 hr |
| 4 - Package hook | 1 | Low | 15 min |
| 5 - Commands | 4 | Low | 30 min |
| 6 - Agent | 1 | Medium | 45 min |
| 7 - Compression | 1 storage.ts | Low | 30 min |
| **Total** | **~11 files** | | **~3.5 hrs** |

---

## What to Build First

**Start with Phases 1 + 2 together.** They deliver the highest-value feature (automatic context loading on session start) with the least complexity. A working session-start hook alone solves the core problem: Claude forgetting architecture between sessions.

Then Phase 3 (architecture-check) for the most impactful runtime hook, followed by Phase 5 (commands) for user-facing features. Phases 4, 6, 7 can follow in any order.
