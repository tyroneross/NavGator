/**
 * The guard that stops a self-inconsistent timeline diff becoming a durable
 * gator-memory record.
 *
 * `buildCurrentSnapshot` can produce a diff claiming everything was removed on
 * the full-scan path. This repo's own timeline carries two such entries
 * (TL_20260530080058 and TL_20260602062857, both `components_after: 0` with
 * `total_changes: 636`) immediately before an entry reporting 265 components.
 *
 * That upstream defect is filed separately
 * (`.build-loop/issues/scanner-full-scan-diff-reports-zero-after.md`). What is
 * tested here is the containment: gator-memory must not persist the false
 * narrative into a project's permanent milestone list, or mirror it into
 * build-loop-memory where other agents read it as authoritative.
 *
 * Recording nothing beats recording a confident falsehood.
 */
import { describe, it, expect } from 'vitest';

import { isDiffConsistentWithScan } from '../scanner.js';
import type { TimelineEntry } from '../types.js';

function entryWithAfter(componentsAfter: number): TimelineEntry {
  return {
    id: 'TL_test',
    timestamp: Date.now(),
    significance: 'major',
    triggers: [],
    diff: {
      components: { added: [], removed: [], modified: [] },
      connections: { added: [], removed: [] },
      stats: {
        total_changes: 636,
        components_before: 241,
        components_after: componentsAfter,
        connections_before: 300,
        connections_after: 0,
      },
    },
  } as TimelineEntry;
}

describe('isDiffConsistentWithScan', () => {
  it('rejects the real-world shape: diff says 0 components, scan wrote 265', () => {
    // The exact shape of TL_20260530080058.
    expect(isDiffConsistentWithScan(entryWithAfter(0), 265)).toBe(false);
  });

  it('accepts a diff that agrees with what the scan persisted', () => {
    expect(isDiffConsistentWithScan(entryWithAfter(265), 265)).toBe(true);
  });

  it('accepts a genuine full removal — 0 after, 0 written', () => {
    // Not a heuristic about zero: a scan that really did end with no
    // components agrees with its own diff, and is reported.
    expect(isDiffConsistentWithScan(entryWithAfter(0), 0)).toBe(true);
  });

  it('rejects any other disagreement, in either direction', () => {
    expect(isDiffConsistentWithScan(entryWithAfter(15), 13)).toBe(false);
    expect(isDiffConsistentWithScan(entryWithAfter(13), 15)).toBe(false);
  });

  it('treats a missing entry or diff as "nothing to report"', () => {
    expect(isDiffConsistentWithScan(undefined, 10)).toBe(false);
    expect(isDiffConsistentWithScan({ id: 'x' } as unknown as TimelineEntry, 10)).toBe(false);
  });
});
