/**
 * Closes `.build-loop/issues/scanner-full-scan-diff-reports-zero-after.md`.
 *
 * Two claims, both proven against a REAL scan (not a hand-built diff):
 *
 *   1. `timelineEntry.diff.stats.components_after` always equals the
 *      component count the scan actually persisted (`index.json`'s
 *      `stats.total_components`), even on the full-scan path where
 *      `clearStorage()` deletes `components.full.jsonl` /
 *      `connections.full.jsonl` before they're rewritten.
 *
 *   2. A genuinely significant change (a new `database`-layer component)
 *      driven through a real two-scan sequence produces an
 *      `architecture.changed` gator-memory event carrying the correct
 *      `componentsAdded` delta — the positive path `scanner-diff-guard.test.ts`
 *      could not exercise, because it only proves the CONTAINMENT predicate
 *      accepts a hand-built consistent diff.
 *
 * Reproduction shape (this is what made the bug visible before the fix):
 * scan1 (full, baseline) -> scan2 (incremental, trivial edit — this is the
 * ONLY path that calls `createSnapshot('pre-scan')` and therefore the only
 * way a SNAP_*.json file with a REAL component count gets written) -> add a
 * prisma schema (new `database`-layer component, page.json untouched) ->
 * scan3 (full — a schema-triggered full scan reads that real SNAP_ baseline
 * as `preScanSnapshot`, but pre-fix `buildCurrentSnapshot` read
 * `components.full.jsonl` AFTER `clearStorage()` had deleted it and BEFORE
 * Phase 5.6 rewrote it, producing `components_after: 0` — the exact
 * before=N/after=0 shape in this repo's own timeline).
 *
 * Why earlier attempts (referenced in the issue) landed on
 * `significance: patch` / `total_changes: 0`: if scan2 is skipped,
 * `preScanSnapshot` is `null` (no SNAP_ file exists — full scans never call
 * `createSnapshot`), and the pre-fix empty CURRENT snapshot diffed against a
 * null PREVIOUS snapshot vacuously agrees with itself (both sides read as
 * "no components"), so the defect hides behind an empty diff instead of
 * surfacing as a wrong one. The repro requires an incremental scan in the
 * middle specifically to force `preScanSnapshot` to be real.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import { scan } from '../scanner.js';
import { loadIndex } from '../storage.js';
import { readMemoryEvents, slug } from '../memory/store.js';

function writeFixture(dir: string, relPath: string, content: string): void {
  const fullPath = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, 'utf-8');
}

function makeBaselineProject(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-fullscan-diff-'));
  writeFixture(
    root,
    'package.json',
    JSON.stringify(
      { name: 'fullscan-diff-fixture', version: '0.0.0', dependencies: { chalk: '^5.0.0' } },
      null,
      2
    )
  );
  writeFixture(
    root,
    'src/a.ts',
    `export function fromA() { return 1; }\n`
  );
  writeFixture(
    root,
    'src/b.ts',
    `import { fromA } from './a';\nexport function fromB() { return fromA() + 1; }\n`
  );
  return root;
}

describe('Phase 5 full-scan diff — components_after is real', () => {
  let root: string;

  beforeEach(() => {
    root = makeBaselineProject();
  });

  it('scan1(full) -> scan2(incremental, trivial edit) -> scan3(full, real prisma-model change): components_after equals index.json total_components on EVERY scan, including the full-scan path that used to read 0', async () => {
    // scan1: baseline full scan.
    const baseline = await scan(root, { mode: 'full' });
    expect(baseline.timelineEntry).toBeDefined();

    const idx1 = await loadIndex(undefined, root);
    expect(idx1).not.toBeNull();
    expect(baseline.timelineEntry!.diff.stats.components_after).toBe(idx1!.stats.total_components);

    // scan2: incremental, trivial content edit to an existing file (no
    // manifest change, no new files) — this is the ONLY scan mode that calls
    // `createSnapshot('pre-scan')`, so it's the only way to get a REAL
    // (non-null) `preScanSnapshot` into scan3 below. Without this step the
    // defect hides behind a vacuous null-vs-empty diff (see file header).
    fs.writeFileSync(
      path.join(root, 'src', 'a.ts'),
      `export function fromA() { return 2; /* edited */ }\n`
    );
    const inc = await scan(root, { mode: 'incremental' });
    expect(inc.timelineEntry?.scan_type).toBe('incremental');
    const idx2 = await loadIndex(undefined, root);
    expect(inc.timelineEntry).toBeDefined();
    expect(inc.timelineEntry!.diff.stats.components_after).toBe(idx2!.stats.total_components);

    // Real architectural change: add a Prisma schema. Prisma models land on
    // the `database` layer, which `classifySignificance` treats as a
    // critical-layer change -> 'major', guaranteeing a non-patch,
    // non-zero-change diff (the "hard part" flagged in the issue — a plain
    // new source file does NOT create a new component, since NavGator's
    // component set is packages/infra/prisma/etc, not source files).
    writeFixture(
      root,
      'prisma/schema.prisma',
      `model Widget {\n  id    String @id @default(cuid())\n  name  String\n}\n`
    );

    const before = await loadIndex(undefined, root);
    const componentsBefore = before!.stats.total_components;

    // scan3: this is the exact buggy path — a schema change forces a FULL
    // scan (FULL_SCAN_TRIGGER_FILES / new-files), which pre-fix cleared
    // `components.full.jsonl` and read it back empty during Phase 5, before
    // Phase 5.6 rewrote it.
    const significant = await scan(root, { mode: 'full' });
    expect(significant.timelineEntry?.scan_type).toBe('full');

    const idx3 = await loadIndex(undefined, root);
    expect(idx3).not.toBeNull();
    const componentsAfter = idx3!.stats.total_components;

    // The component count must have genuinely grown (Widget model + any
    // prisma-detection scaffolding), or the "significant change" premise of
    // this test is void.
    expect(componentsAfter).toBeGreaterThan(componentsBefore);

    expect(significant.timelineEntry).toBeDefined();
    const stats = significant.timelineEntry!.diff.stats;

    // === Claim 1: components_after is real, not 0. ===
    expect(stats.components_after).toBe(componentsAfter);
    expect(stats.components_after).not.toBe(0);
    expect(stats.components_before).toBe(componentsBefore);

    // === Claim 1b: the diff is a real ADD, not a fabricated mass-removal.
    // Pre-fix this would report `removed: componentsBefore, added: 0`. ===
    expect(significant.timelineEntry!.diff.components.removed.length).toBe(0);
    expect(significant.timelineEntry!.diff.components.added.length).toBeGreaterThan(0);
    expect(
      significant.timelineEntry!.diff.components.added.some((c) => c.name === 'Widget')
    ).toBe(true);

    // === Claim: the diff is genuinely non-patch. ===
    expect(significant.timelineEntry!.significance).not.toBe('patch');
    expect(stats.total_changes).toBeGreaterThan(0);

    // === Claim 2: architecture.changed lands in gator-memory with correct
    // deltas — the positive path the containment guard could only ever
    // suppress before this fix. ===
    //
    // `readMemoryEvents` returns newest-last (per its own doc comment), and
    // scan1 (the first-ever scan, baseline vs. a null previous snapshot) ALSO
    // emits its own legitimate `architecture.changed` (everything is "added"
    // relative to nothing — `new-package` + `high-churn` triggers, verified
    // via NAVGATOR_DEBUG). So this must read the LAST matching event (scan3's),
    // not the first (scan1's) — `.find()` would silently grab the wrong one.
    const projectSlug = slug(root);
    const events = readMemoryEvents({ slug: projectSlug, limit: 100 });
    const archEvents = events.filter((e) => e.kind === 'architecture.changed');
    // scan1 (baseline) and scan3 (the significant prisma-model change) each
    // emit one; scan2 (patch, no real change) emits none.
    expect(archEvents.length).toBeGreaterThanOrEqual(2);
    const archEvent = archEvents[archEvents.length - 1];
    expect(archEvent).toBeDefined();
    expect(archEvent?.detail).toMatchObject({
      componentsAdded: significant.timelineEntry!.diff.components.added.length,
      componentsRemoved: 0,
    });
  }, 180_000);
});
