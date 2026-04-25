# Goal — NavGator Global Install + Data-Split Clarification

Status: **PROPOSED** — awaiting approval before Phase 4 execution
Created: 2026-04-11

## Problem

NavGator is installed as a global CLI (`navgator` binary via `npm link`) but
is NOT registered as a Claude Code plugin in `~/.claude/settings.json`. Users
cannot invoke `/scan`, `/impact`, `/map`, `/trace`, etc. from Claude Code
sessions. The plugin manifest also has several latent issues that would
prevent a clean `/reload-plugins` even if it were enabled.

Separately, NavGator already has a per-project data model (`.navgator/` at
each project root with `architecture/`, `lessons/`, `features.yaml`) and a
global projects registry at `~/.navgator/projects.json`. The user wants to
confirm this split is correct and extend it with a **global lessons store**
so architectural patterns discovered in one project (approaches,
cross-system connections, configuration insights) can be recalled in others.

## Current State (Phase 1 findings)

### Plugin assets
- **Location**: `/Users/tyroneross/Desktop/git-folder/NavGator`
- **Components**: 9 commands, 2 agents, 6 skills, 5 hooks, MCP server
- **CLI**: `navgator` binary globally available via `npm link`, runs from live repo
- **Plugin internal name**: `gator` (legacy — inconsistent with CLI `navgator`, marketplace `navgator`, package `@tyroneross/navgator`)

### Installation status
- ✅ CLI: installed globally (`@tyroneross/navgator@0.6.1 -> ./Desktop/git-folder/NavGator`)
- ❌ Claude Code plugin: NOT in `enabledPlugins`, NOT in `extraKnownMarketplaces`

### Manifest problems (blockers for `/reload-plugins`)
All five component-path fields in `plugin.json` reference standard auto-discovery paths — same bug we just fixed in mockup-gallery:

```json
"hooks": "./hooks/hooks.json",      // duplicate — auto-loaded
"skills": "./skills",                // duplicate
"agents": "./agents",                // duplicate
"commands": "./commands",            // duplicate
"mcpServers": "./.mcp.json"          // duplicate
```

`.mcp.json` is also missing the required `mcpServers` wrapper key — same shape bug mockup-gallery had.

### Version drift
- `package.json` → 0.6.1
- `plugin.json` → 0.6.1
- `marketplace.json` metadata → 1.0.0
- `marketplace.json` plugins[0] → 0.2.2

Three different versions in three places.

### Data split — current state
- **Global**: `~/.navgator/projects.json` (24 projects tracked, components/connections stats)
- **Per-project**: `<project>/.navgator/architecture/` (scan data, rules.json, index.json)
- **Per-project**: `<project>/.navgator/lessons/lessons.json` (schema v1.0, structured lesson entries by category)
- **Per-project**: `<project>/.navgator/features.yaml` (classification data)
- **NOT present**: global lessons store across projects

### Hook design
All 5 hooks use `type: "prompt"`. Per `memory/feedback_hook_design.md`:
*"Never use prompt-type hooks for conditional logic (always noisy). Use command-type with silent exit."* This is a pre-existing issue flagged for triage.

## Desired Outcome

1. **Plugin installed globally in Claude Code** — registered in
   `~/.claude/settings.json` so all slash commands, agents, skills, hooks, and
   MCP tools are available in every session.
2. **Clean `/reload-plugins`** — zero load errors after enabling.
3. **Per-project data stays local** — `.navgator/` continues to hold
   architecture scans, rules, features, and per-project lessons. No change
   required; already correct.
4. **Global lessons store** — new `~/.navgator/lessons/` directory holds
   cross-project lessons that the user promotes manually. Schema mirrors
   per-project lessons.json but with a `source_project` field and an
   `applies_to` array for filtering. CLI gains a `navgator lessons promote
   <id>` command and a `navgator lessons list --global` view.
5. **Documentation** — `CLAUDE.md` in NavGator explains the three-tier data
   model (project ↔ lessons local ↔ lessons global) and how to promote.

## Non-Goals

- **No CLI rename.** Keep `navgator` as the command name. Don't touch the
  legacy `gator` internal plugin name unless it blocks registration.
- **No hook rewrite.** The prompt→command hook fix is real tech debt but
  out of scope for this task. Flag only.
- **No version bump.** Reconciling the three conflicting versions is a
  release concern, not an install concern. Flag only.
- **No automatic lesson promotion.** Global lessons are opt-in via explicit
  promotion. No LLM-driven auto-lift from local to global.
- **No cross-project lesson application.** The global store is for recall
  and reference; auto-applying a global lesson to a new project is out of
  scope.

## Scoring Criteria

Five code-based graders. No LLM judges (feature is infrastructure + install).

| # | Criterion | Grader | Pass condition |
|---|---|---|---|
| 1 | Plugin.json has no duplicate paths | `grep` + parse | None of `hooks`, `skills`, `agents`, `commands`, `mcpServers` appear as path fields; plugin.json parses clean |
| 2 | .mcp.json has correct shape | JSON parse + key check | Top-level key is `mcpServers`; inner key is the server name |
| 3 | Registered in Claude Code settings | `~/.claude/settings.json` parse | `extraKnownMarketplaces.navgator` exists pointing at the repo; `enabledPlugins["gator@navgator"]` or `enabledPlugins["navgator@navgator"]` is `true` |
| 4 | `/reload-plugins` clean | Manual check after edit + reload | Previous 14-plugin load becomes 15 plugins with **zero additional errors** |
| 5 | Global lessons store functional | CLI + filesystem | `~/.navgator/lessons/global-lessons.json` exists with schema v1.0; `navgator lessons list --global` returns without error; `navgator lessons promote <id>` moves a lesson from project to global |

Criteria 1-4 are the install block. Criterion 5 is the lessons extension.

## Open Questions (need user input before Phase 4)

- **Q1.** Keep plugin internal name as `gator` or rename to `navgator`?
  - Keeping `gator`: minimal risk, matches existing marketplace entry.
  - Renaming to `navgator`: consistent with everything else, but user-facing enabledPlugins key changes from `gator@navgator` to `navgator@navgator`.
  - **Recommendation**: keep `gator` to avoid breakage. Flag for future cleanup.
- **Q2.** Reconcile the three conflicting versions to one?
  - `package.json` and `plugin.json` agree on 0.6.1. marketplace.json has two stale values (1.0.0 and 0.2.2).
  - **Recommendation**: update marketplace.json to 0.6.1 in both places. Low risk.
- **Q3.** Scope of the global lessons store?
  - **A**: Just the directory + schema + one `promote` CLI command. No list/filter UI.
  - **B**: Directory + schema + `promote` + `list --global` + `search` + integration with Claude Code skill (so it auto-surfaces relevant global lessons in context).
  - **C**: Defer entirely — only do the install, tackle lessons as a separate build-loop.
  - **Recommendation**: **B** — matches the "approaches, connections, configurations" use case the user mentioned, without going overboard. Skill auto-activation in Claude Code is the highest-value part.
- **Q4.** Hook fix (prompt → command type)?
  - In scope: rewrite all 5 hooks as command-type scripts per the feedback memory rule.
  - Out of scope: noted in findings, deferred.
  - **Recommendation**: **out of scope** — flag only. Hook rewrite is a separate build-loop with its own test matrix.
