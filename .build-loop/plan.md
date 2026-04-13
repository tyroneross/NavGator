# Plan — NavGator Global Install + Data-Split Clarification

Linked goal: `.build-loop/goal.md`
Status: **PROPOSED**

## Executive summary

Seven tasks across three layers (manifest fixes → registration → lessons
store). Mostly sequential with one parallel-safe pair. Total surface area
is small (< 500 LOC new + ~20 manifest edits). Core install is 30 minutes of
work; the lessons store adds another hour.

## Layers at a glance

```
Layer 1: Manifest hygiene          (T1, T2, T3)
                ↓
Layer 2: Install + /reload verify  (T4, T5)
                ↓
Layer 3: Global lessons store      (T6, T7)
```

## Task breakdown

### Task 1 — Fix plugin.json duplicate paths
**File**: `.claude-plugin/plugin.json`
**Change**: Remove five path fields (`hooks`, `skills`, `agents`, `commands`, `mcpServers`). All point at standard auto-discovery locations and cause duplicate-load errors (same bug we fixed in mockup-gallery this morning).
**Surface**: -5 lines
**Dependencies**: none
**Parallel-safe**: yes
**Grader**: criterion 1

### Task 2 — Fix .mcp.json shape
**File**: `.mcp.json`
**Change**: Wrap existing content in `{ "mcpServers": { ... } }` so it's parseable as a standalone MCP config after the plugin.json reference is removed.
**Surface**: +3 lines, 0 deletions
**Dependencies**: none
**Parallel-safe**: yes
**Grader**: criterion 2

### Task 3 — Reconcile marketplace.json version (optional, Q2)
**File**: `.claude-plugin/marketplace.json`
**Change**: Update `metadata.version` and `plugins[0].version` to match `package.json` (0.6.1).
**Surface**: 2 lines changed
**Dependencies**: none
**Parallel-safe**: yes
**Grader**: manual visual (not a blocker for install)
**Skip if**: user vetoes Q2

### Task 4 — Register marketplace in ~/.claude/settings.json
**File**: `~/.claude/settings.json`
**Changes**:
1. Add `"navgator"` entry to `extraKnownMarketplaces` with `{ source: { source: "directory", path: "/Users/tyroneross/Desktop/git-folder/NavGator" } }`
2. Add `"gator@navgator": true` to `enabledPlugins` (uses existing plugin internal name per Q1)
**Surface**: ~8 lines added to settings.json
**Dependencies**: T1, T2 (otherwise `/reload-plugins` fails immediately)
**Parallel-safe**: no (sequential after T1/T2)
**Grader**: criterion 3

### Task 5 — Verify `/reload-plugins` is clean
**Action**: User runs `/reload-plugins` after T4. I verify via `/doctor`.
**Expected**: plugin count increases from 14 to 15. Zero new errors.
**Dependencies**: T4
**Grader**: criterion 4
**If fails**: Phase 6 iterate — diagnose, fix, retry up to 5x.

### Task 6 — Global lessons store scaffolding
**Files to create**:
- `~/.navgator/lessons/global-lessons.json` — seed with empty schema
- `src/cli/commands/lessons.ts` (new) OR extend existing command file — adds `navgator lessons` subcommands: `list`, `list --global`, `promote <id>`, `demote <id>`, `search <query>`
- `src/lessons-store.ts` (new) — filesystem abstraction with read/write/query helpers for both local and global stores
- `src/__tests__/lessons-store.test.ts` — vitest suite (NavGator already has vitest per package.json)

**Schema addition** to the existing lesson shape:
```json
{
  // existing fields...
  "source_project": "NavGator",         // who learned this
  "applies_to": ["llm-architecture"],   // tag-based filtering
  "promoted_at": "2026-04-11T..."       // when moved from local to global
}
```

**Surface**: ~200 LOC new + ~100 LOC tests
**Dependencies**: T1-T5 (install must be clean first so we can test the MCP path if needed)
**Parallel-safe**: can draft in parallel with T7 (docs)

**Scope if Q3 = A**: skip `list --global`, `search`, skill integration — just scaffolding + `promote`
**Scope if Q3 = B (recommended)**: full set including a new `global-lessons` skill that auto-activates when the user asks architecture questions across projects
**Scope if Q3 = C**: skip this task entirely; ship install-only

### Task 7 — Documentation
**Files modified**:
- `CLAUDE.md` (NavGator's) — add new section explaining the three-tier data model and the `lessons promote` workflow
- `commands/lessons.md` (new, if T6 chose B) — slash command wrapper for `navgator lessons`

**Surface**: ~40 lines docs
**Dependencies**: T6 complete
**Parallel-safe**: depends only on T6 API being frozen

## Dependency graph

```
T1, T2, T3 (parallel) ──→ T4 (register) ──→ T5 (verify) ──→ T6 (lessons) ──→ T7 (docs)
```

One linear critical path: T1-T5 for install, T6-T7 for lessons.

## Parallelization strategy

- **Wave 1** (parallel): T1, T2, T3 — all simple manifest edits
- **Wave 2** (serial): T4 (settings.json) → T5 (reload verification, requires user action)
- **Wave 3** (serial): T6 → T7

Waves 1-2 are the install. Wave 3 is the lessons extension. If Q3 = C, Wave 3 is skipped entirely.

## Risk register

| Risk | Severity | Mitigation |
|---|---|---|
| `/reload-plugins` errors after register | High | Waves 1-2 are atomic; rollback = remove enabledPlugins entry. Test suite runs manifest validators before registration. |
| Global lessons store mutates per-project files | **High** | `promote` must be copy-then-mark, never move. Local file stays in place with a `promoted: true` flag. |
| Plugin internal name "gator" confuses user | Low | Document both names in CLAUDE.md. Flag for future rename. |
| Lessons schema evolves and breaks old data | Medium | Version field on every lessons.json file. Validator enforces schema version match. |
| `navgator lessons search` is slow at scale | Low | Grep-based for now; add index if >1000 lessons. |

## Coordination checkpoints

- **After Wave 1**: diff `plugin.json`, `.mcp.json`, `marketplace.json` and confirm changes are surgical before touching settings.json
- **After Wave 2 (T4)**: before claiming install success, confirm via `/reload-plugins` + `/doctor`
- **Before T6**: freeze the schema addition for global lessons. All subsequent code reads that schema as the contract.

## Not included in this plan (deferred)

- Hook type rewrite (5 prompt hooks → command hooks per feedback_hook_design.md)
- Plugin name rename (`gator` → `navgator`)
- Version reconciliation beyond marketplace.json
- CLI publish to npm registry (it's installed via `npm link`, not published)
- Web UI changes
- MCP tool additions beyond the existing tools
- Auto-application of global lessons to new projects
- Lesson quality scoring / deduplication
