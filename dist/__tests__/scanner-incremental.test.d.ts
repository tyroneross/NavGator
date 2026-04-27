/**
 * Incremental scan tests (Run 1 — D4).
 *
 * Six scenarios from the build goal:
 *  1. edit-one-file       — full baseline → edit → scan_type='incremental'
 *  2. lockfile-trigger    — edit package.json → scan_type='full'
 *  3. stale-trigger       — last_full_scan 8 days ago → scan_type='full'
 *  4. incremental-cap     — incrementals_since_full = 20 → scan_type='full'
 *  5. integrity-auto-promote — corrupt a connection → 'incremental→full'
 *  6. noop                — no changes → scan_type='noop'
 */
export {};
//# sourceMappingURL=scanner-incremental.test.d.ts.map