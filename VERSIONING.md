# NavGator — Versioning & Source of Truth

## Current

- **Version:** 0.6.1
- **Source of truth:** Local dev (`~/Desktop/git-folder/NavGator`)
- **Also available at:**
  - GitHub: https://github.com/tyroneross/NavGator
  - npm: `@tyroneross/navgator`
  - Marketplace: `navgator` in `RossLabs-AI-Toolkit` (via GitHub source)
- **Claude Code registry entry:** `gator@local` (loaded directly from source path; no cache dir)

## Key changes in 0.6.1

- Groq provider attribution fix — detect SDK import patterns
- File-first LLM dedup — eliminates `UNKNOWN` category
- LLM dedup, template fetch, knowledge base spec
- Raw SQL detection, backward trace, script classification
- 8 slash commands for Claude Code

## Where to look for the latest version

| Source | Location | Notes |
|---|---|---|
| **Authoritative** | `~/Desktop/git-folder/NavGator/.claude-plugin/plugin.json` | Local dev — canonical |
| GitHub | github.com/tyroneross/NavGator | Public mirror |
| npm | `@tyroneross/navgator` | Published releases (marketplace installs pull from here) |
| Marketplace manifest | `~/Desktop/git-folder/RossLabs-AI-Toolkit/.claude-plugin/marketplace.json` | Must be kept in sync with plugin.json version |

**Known past drift:** On 2026-04-04, `marketplace.json` recorded `0.2.2` while source was at `0.6.1` — four patch releases out of sync. Fixed in same commit that introduced this file.

When "latest" is ambiguous, trust **local dev** first, then npm, then marketplace.json.

## Release discipline (enforce before committing a version bump)

1. Bump `version` in `.claude-plugin/plugin.json`
2. Update the version stamp in `CLAUDE.md` (line 1 HTML comment)
3. Update this file's `Current` section + add an entry to `Version history` below
4. **Update `~/Desktop/git-folder/RossLabs-AI-Toolkit/.claude-plugin/marketplace.json`** — bump the version string for the `navgator` entry
5. Back up, then update `~/.claude/plugins/installed_plugins.json` → `installPath` + `version` for every entry of this plugin
6. Run `/reload-plugins` in Claude Code
7. Commit `plugin.json`, `CLAUDE.md`, `VERSIONING.md` together in one commit; update the marketplace repo separately

NavGator is `@local` scope — loaded directly from the source dir, no cache dir, no cache drift possible. Drift risk is only in marketplace.json sync (above).

## Version history

- **0.6.1** (2026-04-03): Groq attribution, file-first LLM dedup, raw SQL detection, 8 slash commands
- **0.2.2** (prior registry entry — stale; was never updated in `installed_plugins.json` until 2026-04-04)
- Other versions: see `git log`
