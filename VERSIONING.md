# NavGator — Versioning & Source of Truth

## Current

- **Version:** 0.9.0
- **Source of truth:** Local dev (`~/dev/git-folder/NavGator`)
- **Also available at:**
  - GitHub: https://github.com/tyroneross/NavGator
  - npm: `@tyroneross/navgator` (public registry currently lags until the next npm publish)
  - Marketplace: `navgator` in `RossLabs-AI-Toolkit` (via GitHub source)
- **Claude Code registry entry:** `navgator@rosslabs-ai-toolkit` 0.9.0

## Key changes in 0.9.0

- Consolidated architecture exports and diagram/summary guidance
- Claude and Codex plugin surfaces aligned at version 0.9.0
- Hooks disabled by default to avoid noisy stale-index prompts
- npm release path prepared for provenance attestations

## Where to look for the latest version

| Source | Location | Notes |
|---|---|---|
| **Authoritative** | `~/dev/git-folder/NavGator/.claude-plugin/plugin.json` | Local dev — canonical |
| GitHub | github.com/tyroneross/NavGator | Public mirror |
| npm | `@tyroneross/navgator` | Published releases (marketplace installs pull from here) |
| Marketplace manifest | `~/dev/git-folder/RossLabs-AI-Toolkit/.claude-plugin/marketplace.json` | Must be kept in sync with plugin.json version |

**Known past drift:** On 2026-04-04, `marketplace.json` recorded `0.2.2` while source was at `0.6.1` — four patch releases out of sync. Fixed in same commit that introduced this file.

When "latest" is ambiguous, trust **local dev** first, then npm, then marketplace.json.

## npm provenance release prep

- `package.json` sets `publishConfig.provenance: true` and `publishConfig.access: public`.
- npmjs publishing uses npm Trusted Publisher OIDC from `.github/workflows/publish.yml`; no `NPM_TOKEN` is required.
- npm provenance is generated automatically by trusted publishing for the public GitHub Actions release.
- GitHub Packages publishing uses `GITHUB_TOKEN`, `packages: write`, and `npm.pkg.github.com`.
- The publish workflow runs `npm run test:release`, a CI-stable subset that excludes the three Linux-flaky scanner suites already failing prior publish runs; run full `npm test` locally before release-prep commits.
- `package.json.repository.url` must keep the exact GitHub repo casing (`tyroneross/NavGator`) for npm provenance matching.
- Public npm currently reports `@tyroneross/navgator@0.2.2`; publish `0.9.0` from the release workflow before treating npmjs as current.
- After publish, verify with `npm view @tyroneross/navgator version dist-tags --json` and `npm audit signatures` in a consuming project.

## Release discipline (enforce before committing a version bump)

1. Bump `version` in `.claude-plugin/plugin.json`
2. Bump `version` in `.codex-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `package.json`, and `package-lock.json`
3. Update the version stamp in `CLAUDE.md` if present
4. Update this file's `Current` section + add an entry to `Version history` below
5. **Update `~/dev/git-folder/RossLabs-AI-Toolkit/.claude-plugin/marketplace.json`** — bump the version string for the `navgator` entry
6. Verify npm release readiness with `npm --cache /private/tmp/navgator-npm-cache pack --dry-run --json`
7. Commit the release-prep files, push, then publish from the GitHub Actions release workflow so npm provenance is generated
8. After publish, verify npm and refresh local Claude/Codex plugin caches as needed

## Version history

- **0.9.0** (2026-06-08): Architecture export skill corrected, Claude/Codex capability surfaces aligned, default hooks silenced, npm provenance release path prepared
- **0.6.1** (2026-04-03): Groq attribution, file-first LLM dedup, raw SQL detection, 8 slash commands
- **0.2.2** (prior registry entry — stale; was never updated in `installed_plugins.json` until 2026-04-04)
- Other versions: see `git log`
