---
description: Scan codebase and brief architecture changes
allowed-tools: Bash, Read
user-invocable: true
argument-hint: [--prompts] [--quick]
---

# /gator_scan

Scan the project, update architecture maps, and give the user a smart brevity brief of what was found.

## Instructions

1. Run the scan from the project root (include `--prompts` for AI prompt detection unless `--quick` was passed):

```bash
npx @tyroneross/navgator scan --prompts --verbose
```

If `--quick` was passed by the user, run without `--prompts`:

```bash
npx @tyroneross/navgator scan --quick --verbose
```

2. After the scan completes, read the updated context files:

```
Read .claude/architecture/SUMMARY.md
Read .claude/architecture/index.json
```

3. Output a **smart brevity brief** to the user. Keep it concise (under 10 lines). Format:

**Line 1 — Status**: "Scanned [project name]. [N] components, [N] connections, [N] AI prompts."

**What's new** (only if changes detected): List added/removed components from the "Changes Since Last Scan" section in SUMMARY.md. If no changes, say "No changes since last scan."

**What to watch** (only if issues exist): Mention any warnings (outdated packages, vulnerabilities, low-confidence detections). If none, omit this section.

**AI routing** (only if prompts found): One line summarizing providers and model count, e.g. "AI: 2 providers (OpenAI, Anthropic), 4 models across 12 call sites."

4. Do NOT dump raw CLI output or full file contents. Summarize into the brief format above.

## Examples

Good output:
```
Scanned Market Research App. 24 components, 18 connections, 6 AI prompts.

What's new: Added `stripe` (external), removed `redis` (database).
What to watch: 2 outdated packages (express, lodash).
AI: OpenAI (3 models), Anthropic (1 model) across 6 call sites.
```

Minimal output (clean project, no changes):
```
Scanned FloDoro. 7 components, 0 connections, 0 AI prompts. No changes since last scan.
```
