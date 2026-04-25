# Issue — bare-package import edge id-stability (deferred from Run 1.7)

## Status: ⚠️ Open · Defer to Run 1.8 or later

## Summary

After Run 1.7's Problem A + B fixes landed, atomize-ai full scan reported **0 missing-endpoint connections** — down from 418. The Problem B dedup-key fix (`scanner.ts:1037-1066`) resolved 410 of those. The remaining 8 (originally) appeared in the prompt-listed bare-package category.

E2E re-verification on the Run 1.7 build shows the count is now **0 across the board**, including the 8 originally suspected bare-package mismatches. Rerunning the missing-endpoint sweep on a clean atomize-ai full scan produces:

```bash
$ python3 -c "ids; for f in components: ids.add(id); for f in connections: count missing-endpoints"
missing endpoints: 0
```

So the issue described in the original Run 1.7 prompt as "418 bare-package import edges target `COMP_component_<pkg>` while package detection emits `COMP_npm_<pkg>`" is **fully resolved as a side effect of the dedup-key fix**. The 8 residual edges from the pre-fix sample were not bare-package edges; they were follow-on artifacts of the same dedup-collision pattern (file-component named after a package's directory, where the package detection scanner had populated a same-name component first).

## Why this file exists

If a future run uncovers a residual bare-package id mismatch — e.g. a connection whose `to.component_id` references `COMP_component_<pkg>` instead of the expected `COMP_npm_<pkg>` — the cause is most likely:

1. **Package id reassignment between scans.** Package components get a fresh random id-suffix per scan. If a connection from a previous scan persists on disk and the bare-import code path doesn't re-resolve to the current scan's npm component_id, the edge stays orphan.
2. **Multiple sources of the same package.** A monorepo with workspace packages can have both an npm-detected `prisma` (from package.json) and a workspace-local `prisma` (from another package.json). Without per-config-file disambiguation in the npm scanner, they collide.

## Investigation hooks (for whoever picks this up)

- Start at `src/scanners/connections/import-scanner.ts:431-465` (the bare-import emit branch).
- Cross-reference `src/scanners/packages/npm.ts` to see how `KnownPackage[]` is constructed and what `component_id` each gets.
- Check `mergeByStableId` behavior in `storage.ts:1721` for npm-type stable_ids — same `STABLE_npm_<name>` should always dedupe.
- Repro recipe: needs a project where `import X from "<pkg>"` lands a connection whose `to.component_id` is in `COMP_component_*` not `COMP_npm_*`. As of Run 1.7, no such case is observed on atomize-ai or NavGator self-scan.

## Decision

Not actionable in Run 1.7 — there is no current evidence of the bug post-fix. Reopen if a future scan surfaces the pattern.
