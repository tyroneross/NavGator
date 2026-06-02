# Living Architecture — Slice 1: Stamped View + Non-Blocking Dirty Hook — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make NavGator's architecture view continuously current via a non-blocking dirty-ledger + background drainer, and make every read honest about its freshness via a stamp.

**Architecture:** A PostToolUse hook does one fast append to a dirty-set ledger (`.navgator/dirty.json`) and exits — it never blocks the edit. A background, single-writer drainer (behind a stale-detecting lock) coalesces dirty files and runs NavGator's existing incremental `scan()`, then writes a freshness stamp (`.navgator/architecture/freshness.json`) carrying `generated_at`, `commit_sha`, and the outstanding `dirty_files`. Agents read the stamp to know if the view is trustworthy. This is Slice 1 of 4 (later slices: `context <target>`, canonical-main + worktree-delta storage, pre-merge architecture diff).

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Node ≥18 stdlib (`fs`, `os`, `path`, `child_process`), commander CLI, vitest, NavGator's existing `scan()` / `getGitInfo()` / config path helpers.

**Out of scope for Slice 1 (do NOT build):** the `context <target>` command, worktree/main delta model, pre-merge diff, MCP resource exposure. These are later slices.

---

## File Structure

- `src/freshness/paths.ts` — resolves all freshness file locations from NavGator config (DRY single source of paths).
- `src/freshness/dirty-ledger.ts` — append/read/clear the dirty-set ledger; atomic writes.
- `src/freshness/scan-lock.ts` — single-writer lock with PID + heartbeat stale detection.
- `src/freshness/stamp.ts` — read/write/compute the freshness stamp.
- `src/freshness/drainer.ts` — coalesce + drain the dirty set via `scan()`, update the stamp.
- `src/cli/commands/freshness.ts` — `navgator mark-dirty <path>`, `navgator drain`, `navgator freshness` commands.
- `src/cli/index.ts` — wire the new commands (MODIFY).
- `hooks/mark-dirty.sh` — non-blocking PostToolUse hook script.
- `hooks/hooks.json` — register the hook (MODIFY).
- Tests under `src/__tests__/freshness/`.

Design note: the dirty ledger and lock live at the `.navgator/` base (sibling of `architecture/`); the stamp lives inside `architecture/` next to the graph it describes. All paths derive from `path.dirname(getStoragePath(getConfig(), root))` so they honor local vs shared storage mode.

---

### Task 1: Freshness path helpers

**Files:**
- Create: `src/freshness/paths.ts`
- Test: `src/__tests__/freshness/paths.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/__tests__/freshness/paths.test.ts
import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { navgatorBase, dirtyLedgerPath, scanLockPath, stampPath } from '../../freshness/paths.js';

describe('freshness paths', () => {
  const root = '/tmp/example-project';

  it('navgatorBase is <root>/.navgator in local mode', () => {
    expect(navgatorBase(root)).toBe(path.join(root, '.navgator'));
  });

  it('dirty ledger sits at the navgator base', () => {
    expect(dirtyLedgerPath(root)).toBe(path.join(root, '.navgator', 'dirty.json'));
  });

  it('scan lock sits at the navgator base', () => {
    expect(scanLockPath(root)).toBe(path.join(root, '.navgator', 'scan.lock'));
  });

  it('stamp sits inside architecture next to the graph', () => {
    expect(stampPath(root)).toBe(path.join(root, '.navgator', 'architecture', 'freshness.json'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/freshness/paths.test.ts`
Expected: FAIL — cannot find module `../../freshness/paths.js`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/freshness/paths.ts
/**
 * Single source of truth for freshness-subsystem file locations.
 * Derived from NavGator config so local vs shared storage mode is honored:
 * getStoragePath() returns <base>/architecture, so its dirname is the base.
 */
import * as path from 'path';
import { getConfig, getStoragePath } from '../config.js';

/** The `.navgator` base dir for a project root (sibling of `architecture/`). */
export function navgatorBase(root: string): string {
  return path.dirname(getStoragePath(getConfig(), root));
}

/** Dirty-set ledger: append-only set of changed paths since the last clean drain. */
export function dirtyLedgerPath(root: string): string {
  return path.join(navgatorBase(root), 'dirty.json');
}

/** Single-writer scan lock. */
export function scanLockPath(root: string): string {
  return path.join(navgatorBase(root), 'scan.lock');
}

/** Freshness stamp, stored next to the graph it describes. */
export function stampPath(root: string): string {
  return path.join(navgatorBase(root), 'architecture', 'freshness.json');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/freshness/paths.test.ts`
Expected: PASS (all 4).

Note: if local-mode `getStoragePath` returns a path whose dirname is not `<root>/.navgator`, fix `navgatorBase` to `path.join(root, '.navgator')` for local mode and keep the dirname form only for shared mode. Verify against `src/config.ts:113` before assuming.

- [ ] **Step 5: Commit**

```bash
git add src/freshness/paths.ts src/__tests__/freshness/paths.test.ts
git commit -m "feat(freshness): path helpers for dirty ledger, scan lock, stamp"
```

---

### Task 2: Dirty-set ledger

**Files:**
- Create: `src/freshness/dirty-ledger.ts`
- Test: `src/__tests__/freshness/dirty-ledger.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/__tests__/freshness/dirty-ledger.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { markDirty, readDirty, clearDirty } from '../../freshness/dirty-ledger.js';

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'nv-dirty-'));
  fs.mkdirSync(path.join(root, '.navgator'), { recursive: true });
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('dirty ledger', () => {
  it('starts empty', () => {
    expect(readDirty(root)).toEqual([]);
  });

  it('marks and reads paths, deduped and sorted', () => {
    markDirty(['b.ts', 'a.ts', 'b.ts'], root);
    expect(readDirty(root)).toEqual(['a.ts', 'b.ts']);
  });

  it('accumulates across calls', () => {
    markDirty(['a.ts'], root);
    markDirty(['c.ts'], root);
    expect(readDirty(root)).toEqual(['a.ts', 'c.ts']);
  });

  it('clears only the drained subset, leaving late arrivals', () => {
    markDirty(['a.ts', 'b.ts', 'c.ts'], root);
    clearDirty(['a.ts', 'b.ts'], root);
    expect(readDirty(root)).toEqual(['c.ts']);
  });

  it('tolerates a corrupt ledger by resetting to empty', () => {
    fs.writeFileSync(path.join(root, '.navgator', 'dirty.json'), '{not json');
    expect(readDirty(root)).toEqual([]);
    markDirty(['a.ts'], root);
    expect(readDirty(root)).toEqual(['a.ts']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/freshness/dirty-ledger.test.ts`
Expected: FAIL — cannot find module `../../freshness/dirty-ledger.js`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/freshness/dirty-ledger.ts
/**
 * The dirty-set ledger: an append-only set of changed paths since the last clean
 * drain. The PostToolUse hook appends here (fast, non-blocking); the drainer
 * reads it, scans, and clears the drained subset. Late arrivals (marked while a
 * scan is in flight) survive a partial clear and are picked up next drain.
 */
import * as fs from 'fs';
import * as path from 'path';
import { dirtyLedgerPath } from './paths.js';

interface DirtyFile {
  version: 1;
  paths: string[];
  updated_at: number;
}

function load(root: string): DirtyFile {
  const p = dirtyLedgerPath(root);
  if (!fs.existsSync(p)) return { version: 1, paths: [], updated_at: 0 };
  try {
    const parsed = JSON.parse(fs.readFileSync(p, 'utf8')) as DirtyFile;
    if (parsed?.version === 1 && Array.isArray(parsed.paths)) return parsed;
  } catch {
    /* corrupt → reset; never block the hook or drainer */
  }
  return { version: 1, paths: [], updated_at: 0 };
}

function save(root: string, data: DirtyFile): void {
  const p = dirtyLedgerPath(root);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, p); // atomic on same filesystem
}

/** Append paths to the dirty set (deduped, sorted). Safe to call concurrently-ish. */
export function markDirty(paths: string[], root: string): void {
  const data = load(root);
  const set = new Set(data.paths);
  for (const raw of paths) {
    const v = raw.trim();
    if (v) set.add(v);
  }
  save(root, { version: 1, paths: [...set].sort(), updated_at: Date.now() });
}

/** Read the current dirty set (sorted). */
export function readDirty(root: string): string[] {
  return load(root).paths;
}

/** Remove the given drained paths, leaving anything that arrived later. */
export function clearDirty(drained: string[], root: string): void {
  const data = load(root);
  const drop = new Set(drained);
  save(root, {
    version: 1,
    paths: data.paths.filter((p) => !drop.has(p)),
    updated_at: Date.now(),
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/freshness/dirty-ledger.test.ts`
Expected: PASS (all 5).

- [ ] **Step 5: Commit**

```bash
git add src/freshness/dirty-ledger.ts src/__tests__/freshness/dirty-ledger.test.ts
git commit -m "feat(freshness): append-only dirty-set ledger with atomic writes"
```

---

### Task 3: Single-writer scan lock

**Files:**
- Create: `src/freshness/scan-lock.ts`
- Test: `src/__tests__/freshness/scan-lock.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/__tests__/freshness/scan-lock.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { acquireLock, releaseLock, LOCK_TTL_MS } from '../../freshness/scan-lock.js';
import { scanLockPath } from '../../freshness/paths.js';

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'nv-lock-'));
  fs.mkdirSync(path.join(root, '.navgator'), { recursive: true });
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('scan lock', () => {
  it('acquires when free', () => {
    expect(acquireLock(root)).toBe(true);
  });

  it('refuses a second live acquire', () => {
    expect(acquireLock(root)).toBe(true);
    expect(acquireLock(root)).toBe(false);
  });

  it('release frees the lock', () => {
    expect(acquireLock(root)).toBe(true);
    releaseLock(root);
    expect(acquireLock(root)).toBe(true);
  });

  it('steals a stale lock (heartbeat older than TTL)', () => {
    const lock = { pid: 999999, heartbeat_at: Date.now() - LOCK_TTL_MS - 1000 };
    fs.writeFileSync(scanLockPath(root), JSON.stringify(lock));
    expect(acquireLock(root)).toBe(true);
  });

  it('steals a lock whose PID is dead even if heartbeat is recent', () => {
    // PID 999999 is overwhelmingly unlikely to exist.
    const lock = { pid: 999999, heartbeat_at: Date.now() };
    fs.writeFileSync(scanLockPath(root), JSON.stringify(lock));
    expect(acquireLock(root)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/freshness/scan-lock.test.ts`
Expected: FAIL — cannot find module `../../freshness/scan-lock.js`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/freshness/scan-lock.ts
/**
 * Single-writer scan lock. Under the parallel rally fleet many hooks fire at
 * once; only one drainer may scan at a time or the graph/ledger corrupts. The
 * lock is a JSON file holding the owner PID + a heartbeat. A lock is considered
 * stealable when its heartbeat is older than LOCK_TTL_MS OR its PID is dead, so
 * a crashed drainer never wedges the system.
 */
import * as fs from 'fs';
import * as path from 'path';
import { scanLockPath } from './paths.js';

export const LOCK_TTL_MS = 60_000;

interface Lock {
  pid: number;
  heartbeat_at: number;
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0); // signal 0 = existence check, doesn't kill
    return true;
  } catch {
    return false;
  }
}

function readLock(p: string): Lock | null {
  try {
    const l = JSON.parse(fs.readFileSync(p, 'utf8')) as Lock;
    if (typeof l?.pid === 'number' && typeof l?.heartbeat_at === 'number') return l;
  } catch {
    /* missing/corrupt → treat as free */
  }
  return null;
}

/** Try to take the lock. Returns true on success, false if a live lock exists. */
export function acquireLock(root: string): boolean {
  const p = scanLockPath(root);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const existing = readLock(p);
  if (existing) {
    const fresh = Date.now() - existing.heartbeat_at < LOCK_TTL_MS;
    if (fresh && pidAlive(existing.pid)) return false; // genuinely held
    // else: stale or dead owner → steal
  }
  fs.writeFileSync(p, JSON.stringify({ pid: process.pid, heartbeat_at: Date.now() } as Lock));
  return true;
}

/** Refresh the heartbeat mid-scan (call periodically for long scans). */
export function touchLock(root: string): void {
  try {
    fs.writeFileSync(
      scanLockPath(root),
      JSON.stringify({ pid: process.pid, heartbeat_at: Date.now() } as Lock),
    );
  } catch {
    /* best effort */
  }
}

/** Release the lock if we own it. */
export function releaseLock(root: string): void {
  const p = scanLockPath(root);
  const existing = readLock(p);
  if (existing && existing.pid === process.pid) {
    try {
      fs.rmSync(p, { force: true });
    } catch {
      /* best effort */
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/freshness/scan-lock.test.ts`
Expected: PASS (all 5).

- [ ] **Step 5: Commit**

```bash
git add src/freshness/scan-lock.ts src/__tests__/freshness/scan-lock.test.ts
git commit -m "feat(freshness): single-writer scan lock with stale/dead detection"
```

---

### Task 4: Freshness stamp

**Files:**
- Create: `src/freshness/stamp.ts`
- Test: `src/__tests__/freshness/stamp.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/__tests__/freshness/stamp.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { writeStamp, readStamp, type FreshnessStamp } from '../../freshness/stamp.js';

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'nv-stamp-'));
  fs.mkdirSync(path.join(root, '.navgator', 'architecture'), { recursive: true });
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('freshness stamp', () => {
  it('round-trips a stamp', () => {
    const stamp: FreshnessStamp = {
      version: 1,
      generated_at: 123,
      commit_sha: 'abc1234',
      branch: 'main',
      dirty_files: ['x.ts'],
      dirty_count: 1,
      scan_in_flight: false,
    };
    writeStamp(root, stamp);
    expect(readStamp(root)).toEqual(stamp);
  });

  it('returns null when absent', () => {
    expect(readStamp(root)).toBeNull();
  });

  it('returns null on corrupt stamp rather than throwing', () => {
    fs.writeFileSync(path.join(root, '.navgator', 'architecture', 'freshness.json'), 'nope');
    expect(readStamp(root)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/freshness/stamp.test.ts`
Expected: FAIL — cannot find module `../../freshness/stamp.js`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/freshness/stamp.ts
/**
 * The freshness stamp: the honesty contract for the architecture view. Every
 * read can check this to know whether the view is current or how many files
 * have changed since the last clean drain. Cheaper and more robust than
 * guaranteeing freshness — especially under N parallel agents.
 */
import * as fs from 'fs';
import * as path from 'path';
import { getGitInfo } from '../git.js';
import { stampPath } from './paths.js';
import { readDirty } from './dirty-ledger.js';

export interface FreshnessStamp {
  version: 1;
  /** epoch ms of the last clean drain (scan completion). */
  generated_at: number;
  /** short commit sha the graph was generated against ('' if not a git repo). */
  commit_sha: string;
  /** branch name ('' if unknown). */
  branch: string;
  /** files changed since generated_at and not yet drained. */
  dirty_files: string[];
  dirty_count: number;
  /** true while a drain is mid-flight. */
  scan_in_flight: boolean;
}

export function writeStamp(root: string, stamp: FreshnessStamp): void {
  const p = stampPath(root);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(stamp, null, 2), 'utf8');
  fs.renameSync(tmp, p);
}

export function readStamp(root: string): FreshnessStamp | null {
  const p = stampPath(root);
  if (!fs.existsSync(p)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(p, 'utf8')) as FreshnessStamp;
    if (parsed?.version === 1) return parsed;
  } catch {
    /* corrupt → null */
  }
  return null;
}

/**
 * Compute a stamp for the current moment. `inFlight` marks a drain in progress;
 * `generatedAt` defaults to now (use the scan completion time on a clean drain).
 */
export async function computeStamp(
  root: string,
  opts: { inFlight: boolean; generatedAt?: number } = { inFlight: false },
): Promise<FreshnessStamp> {
  const git = await getGitInfo(root);
  const dirty = readDirty(root);
  return {
    version: 1,
    generated_at: opts.generatedAt ?? Date.now(),
    commit_sha: git?.commit ?? '',
    branch: git?.branch ?? '',
    dirty_files: dirty,
    dirty_count: dirty.length,
    scan_in_flight: opts.inFlight,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/freshness/stamp.test.ts`
Expected: PASS (all 3).

- [ ] **Step 5: Commit**

```bash
git add src/freshness/stamp.ts src/__tests__/freshness/stamp.test.ts
git commit -m "feat(freshness): stamp read/write/compute (honesty contract)"
```

---

### Task 5: Background drainer

**Files:**
- Create: `src/freshness/drainer.ts`
- Test: `src/__tests__/freshness/drainer.test.ts`

The drainer is the coordinator. It is dependency-injected with a `scanFn` so the
test never runs a real scan. Production wiring passes NavGator's `scan`.

- [ ] **Step 1: Write the failing test**

```typescript
// src/__tests__/freshness/drainer.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { drain, type DrainResult } from '../../freshness/drainer.js';
import { markDirty, readDirty } from '../../freshness/dirty-ledger.js';
import { acquireLock } from '../../freshness/scan-lock.js';
import { readStamp } from '../../freshness/stamp.js';

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'nv-drain-'));
  fs.mkdirSync(path.join(root, '.navgator', 'architecture'), { recursive: true });
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

const okScan = async () => {};

describe('drainer', () => {
  it('drains the dirty set, scans once, clears, and writes a stamp', async () => {
    markDirty(['a.ts', 'b.ts'], root);
    let scans = 0;
    const res = await drain(root, { scanFn: async () => { scans++; }, minIntervalMs: 0 });
    expect(res.status).toBe('drained');
    expect(scans).toBe(1);
    expect(readDirty(root)).toEqual([]);
    const stamp = readStamp(root);
    expect(stamp?.dirty_count).toBe(0);
    expect(stamp?.scan_in_flight).toBe(false);
  });

  it('with an empty dirty set refreshes the stamp without scanning', async () => {
    let scans = 0;
    const res = await drain(root, { scanFn: async () => { scans++; }, minIntervalMs: 0 });
    expect(res.status).toBe('clean');
    expect(scans).toBe(0);
    expect(readStamp(root)).not.toBeNull();
  });

  it('returns busy when the lock is already held', async () => {
    markDirty(['a.ts'], root);
    acquireLock(root); // simulate another drainer
    const res = await drain(root, { scanFn: okScan, minIntervalMs: 0 });
    expect(res.status).toBe('busy');
    expect(readDirty(root)).toEqual(['a.ts']); // untouched
  });

  it('keeps late arrivals marked while only clearing what it drained', async () => {
    markDirty(['a.ts'], root);
    const scanFn = async () => { markDirty(['late.ts'], root); }; // arrives mid-scan
    const res = await drain(root, { scanFn, minIntervalMs: 0 });
    expect(res.status).toBe('drained');
    expect(readDirty(root)).toEqual(['late.ts']);
  });

  it('debounces: a second drain within minIntervalMs is skipped', async () => {
    markDirty(['a.ts'], root);
    await drain(root, { scanFn: okScan, minIntervalMs: 0 });
    markDirty(['b.ts'], root);
    const res = await drain(root, { scanFn: okScan, minIntervalMs: 60_000 });
    expect(res.status).toBe('debounced');
    expect(readDirty(root)).toEqual(['b.ts']); // preserved for next drain
  });

  it('on scan failure leaves the dirty set intact and reports error', async () => {
    markDirty(['a.ts'], root);
    const res = await drain(root, { scanFn: async () => { throw new Error('boom'); }, minIntervalMs: 0 });
    expect(res.status).toBe('error');
    expect(readDirty(root)).toEqual(['a.ts']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/freshness/drainer.test.ts`
Expected: FAIL — cannot find module `../../freshness/drainer.js`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/freshness/drainer.ts
/**
 * The background drainer. Coalesces the dirty set and runs one incremental scan
 * under the single-writer lock, then writes an honest stamp. Designed to be
 * invoked repeatedly and cheaply (by the hook, the orchestrator, or a timer):
 *  - busy      → another drainer holds the lock; caller should not wait.
 *  - debounced → a drain ran within minIntervalMs; skipped (dirty set kept).
 *  - clean     → nothing dirty; stamp refreshed only.
 *  - drained   → scanned, cleared the drained subset, stamp updated.
 *  - error     → scan threw; dirty set left intact for a retry.
 */
import { readDirty, clearDirty } from './dirty-ledger.js';
import { acquireLock, releaseLock } from './scan-lock.js';
import { computeStamp, writeStamp, readStamp } from './stamp.js';

export type DrainStatus = 'busy' | 'debounced' | 'clean' | 'drained' | 'error';

export interface DrainResult {
  status: DrainStatus;
  scanned: number; // count of dirty paths drained
  error?: string;
}

export interface DrainOptions {
  /** Injected scanner. Production passes a wrapper over NavGator `scan()`. */
  scanFn: (root: string, changed: string[]) => Promise<void>;
  /** Skip if the last stamp was generated within this window (default 3000ms). */
  minIntervalMs?: number;
}

export async function drain(root: string, opts: DrainOptions): Promise<DrainResult> {
  const minInterval = opts.minIntervalMs ?? 3000;

  // Debounce off the last stamp's generated_at (only when there IS prior state).
  const prior = readStamp(root);
  if (prior && Date.now() - prior.generated_at < minInterval) {
    return { status: 'debounced', scanned: 0 };
  }

  if (!acquireLock(root)) {
    return { status: 'busy', scanned: 0 };
  }

  try {
    const dirty = readDirty(root);

    if (dirty.length === 0) {
      writeStamp(root, await computeStamp(root, { inFlight: false }));
      return { status: 'clean', scanned: 0 };
    }

    // Mark in-flight so concurrent readers see the truth during the scan.
    writeStamp(root, await computeStamp(root, { inFlight: true }));

    try {
      await opts.scanFn(root, dirty);
    } catch (e) {
      // Leave the dirty set intact; clear the in-flight flag honestly.
      writeStamp(root, await computeStamp(root, { inFlight: false }));
      return { status: 'error', scanned: 0, error: e instanceof Error ? e.message : String(e) };
    }

    const completedAt = Date.now();
    clearDirty(dirty, root); // clears only what we drained; late arrivals remain
    writeStamp(root, await computeStamp(root, { inFlight: false, generatedAt: completedAt }));
    return { status: 'drained', scanned: dirty.length };
  } finally {
    releaseLock(root);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/freshness/drainer.test.ts`
Expected: PASS (all 6).

- [ ] **Step 5: Commit**

```bash
git add src/freshness/drainer.ts src/__tests__/freshness/drainer.test.ts
git commit -m "feat(freshness): background drainer (coalesce + lock + scan + stamp)"
```

---

### Task 6: CLI commands — mark-dirty, drain, freshness

**Files:**
- Create: `src/cli/commands/freshness.ts`
- Modify: `src/cli/index.ts` (register the new commands)
- Test: `src/__tests__/freshness/cli-freshness.test.ts`

Wires the real `scan()` into the drainer and exposes three commands. The
production `scanFn` calls NavGator's `scan(root)` and ignores the rich return —
`scan()` already persists the graph, regenerates NAVSUMMARY, and (Slice-0) runs
external enrichment, so the drainer only needs it to complete.

- [ ] **Step 1: Write the failing test**

```typescript
// src/__tests__/freshness/cli-freshness.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runMarkDirty, runFreshness } from '../../cli/commands/freshness.js';
import { readDirty } from '../../freshness/dirty-ledger.js';

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'nv-cli-'));
  fs.mkdirSync(path.join(root, '.navgator', 'architecture'), { recursive: true });
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('freshness CLI helpers', () => {
  it('runMarkDirty appends to the ledger', () => {
    runMarkDirty(['src/a.ts'], root);
    expect(readDirty(root)).toEqual(['src/a.ts']);
  });

  it('runFreshness returns a stamp-shaped object even before any drain', async () => {
    const out = await runFreshness(root);
    expect(out).toHaveProperty('dirty_count');
    expect(out).toHaveProperty('scan_in_flight');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/freshness/cli-freshness.test.ts`
Expected: FAIL — cannot find module `../../cli/commands/freshness.js`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/cli/commands/freshness.ts
import { Command } from 'commander';
import { spawn } from 'child_process';
import { markDirty } from '../../freshness/dirty-ledger.js';
import { drain } from '../../freshness/drainer.js';
import { computeStamp, readStamp, type FreshnessStamp } from '../../freshness/stamp.js';
import { scan } from '../../scanner.js';

/** Production scanFn: run the real incremental scan; it persists everything. */
const realScan = async (root: string): Promise<void> => {
  await scan(root, {});
};

/** Testable core: append paths to the dirty ledger. */
export function runMarkDirty(paths: string[], root: string): void {
  markDirty(paths, root);
}

/** Testable core: run a drain with the real scanner. */
export async function runDrain(root: string, minIntervalMs?: number) {
  return drain(root, { scanFn: realScan, minIntervalMs });
}

/** Testable core: return the current stamp (computing a transient one if none). */
export async function runFreshness(root: string): Promise<FreshnessStamp> {
  return readStamp(root) ?? (await computeStamp(root, { inFlight: false }));
}

export function registerFreshnessCommands(program: Command): void {
  program
    .command('mark-dirty <paths...>')
    .description('Append changed file paths to the dirty-set ledger (used by the PostToolUse hook)')
    .option('--drain', 'Spawn a detached background drain after marking')
    .action((paths: string[], options: { drain?: boolean }) => {
      const root = process.cwd();
      runMarkDirty(paths, root);
      if (options.drain) {
        // Detached + unref so the hook returns immediately (non-blocking).
        const child = spawn(process.execPath, [process.argv[1]!, 'drain'], {
          cwd: root,
          detached: true,
          stdio: 'ignore',
        });
        child.unref();
      }
      console.log(JSON.stringify({ ok: true, marked: paths.length }));
    });

  program
    .command('drain')
    .description('Coalesce the dirty set and run one incremental scan under the single-writer lock')
    .option('--min-interval <ms>', 'Debounce window in ms', (v) => parseInt(v, 10))
    .action(async (options: { minInterval?: number }) => {
      const result = await runDrain(process.cwd(), options.minInterval);
      console.log(JSON.stringify(result));
    });

  program
    .command('freshness')
    .description('Print the freshness stamp for the architecture view (honesty contract)')
    .action(async () => {
      console.log(JSON.stringify(await runFreshness(process.cwd()), null, 2));
    });
}
```

- [ ] **Step 4: Wire commands into the CLI**

Modify `src/cli/index.ts` — add the import alongside the other command imports, and register it next to `registerStatusCommand(program);`:

```typescript
// near the other: import { registerStatusCommand } from './commands/status.js';
import { registerFreshnessCommands } from './commands/freshness.js';

// near the other register*Command(program) calls:
registerFreshnessCommands(program);
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npx vitest run src/__tests__/freshness/cli-freshness.test.ts && npx tsc --noEmit -p tsconfig.json`
Expected: tests PASS (2); tsc prints no errors.

- [ ] **Step 6: Build + smoke-test the CLI against NavGator itself**

```bash
npm run build
navgator mark-dirty src/scanner.ts
navgator freshness          # shows dirty_files: ["src/scanner.ts"], dirty_count: 1
navgator drain              # status: "drained"
navgator freshness          # dirty_count: 0, commit_sha + generated_at populated
```
Expected: the sequence above; second `freshness` shows an empty dirty set and a populated `commit_sha`/`generated_at`.

- [ ] **Step 7: Commit**

```bash
git add src/cli/commands/freshness.ts src/cli/index.ts src/__tests__/freshness/cli-freshness.test.ts
git commit -m "feat(freshness): mark-dirty/drain/freshness CLI commands"
```

---

### Task 7: Non-blocking PostToolUse hook

**Files:**
- Create: `hooks/mark-dirty.sh`
- Modify: `hooks/hooks.json`

The hook must NEVER block the edit. It marks the file dirty and spawns a detached
drain, then exits 0 immediately.

- [ ] **Step 1: Create the hook script**

```bash
# hooks/mark-dirty.sh
#!/usr/bin/env bash
# Non-blocking PostToolUse hook: record the edited file in NavGator's dirty
# ledger and kick a detached background drain. Returns immediately — it never
# delays the edit. Coalescing + the single-writer lock live in the drainer.
set -euo pipefail

# Claude Code passes tool input as JSON on stdin; extract the file path.
INPUT="$(cat 2>/dev/null || true)"
FILE="$(printf '%s' "$INPUT" | sed -n 's/.*"file_path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)"

# Only act inside a project that has a NavGator graph.
if [ -z "$FILE" ] || [ ! -d ".navgator" ]; then
  exit 0
fi

# `mark-dirty --drain` appends to the ledger and self-spawns a detached drain.
if command -v navgator >/dev/null 2>&1; then
  navgator mark-dirty "$FILE" --drain >/dev/null 2>&1 || true
fi
exit 0
```

- [ ] **Step 2: Make it executable**

Run: `chmod +x hooks/mark-dirty.sh`

- [ ] **Step 3: Register the hook in hooks/hooks.json**

Read the existing `hooks/hooks.json`, then ADD a `PostToolUse` entry matching `Write|Edit` that runs the script via `${CLAUDE_PLUGIN_ROOT}`. Preserve all existing entries. The added entry:

```json
{
  "matcher": "Write|Edit",
  "hooks": [
    {
      "type": "command",
      "command": "bash ${CLAUDE_PLUGIN_ROOT}/hooks/mark-dirty.sh",
      "timeout": 10
    }
  ]
}
```

If `hooks.json` already has a `PostToolUse` array, append this object to it rather than creating a second `PostToolUse` key.

- [ ] **Step 4: Manual verification (non-blocking + correctness)**

```bash
cd /Users/tyroneross/dev/git-folder/NavGator
# Simulate the hook payload:
echo '{"tool_input":{"file_path":"src/scanner.ts"}}' | bash hooks/mark-dirty.sh
navgator freshness   # src/scanner.ts present in dirty_files OR already drained by the background drain
sleep 4
navgator freshness   # dirty_count back to 0 after the detached drain completes
```
Expected: the file appears dirty, then a background drain clears it within a few seconds — the hook call itself returns instantly.

- [ ] **Step 5: Commit**

```bash
git add hooks/mark-dirty.sh hooks/hooks.json
git commit -m "feat(freshness): non-blocking PostToolUse hook marks dirty + detached drain"
```

---

### Task 8: Full suite + docs

**Files:**
- Modify: `docs/external-enrichment-fold.md` (cross-link) OR create `docs/living-architecture.md`

- [ ] **Step 1: Run the entire test suite**

Run: `npx vitest run`
Expected: all tests pass, including the 6 new freshness test files.

- [ ] **Step 2: Typecheck the whole project**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: 0 errors.

- [ ] **Step 3: Write the subsystem doc**

Create `docs/living-architecture.md` describing: the dirty-ledger → drainer → stamp pipeline, the three triggers (hook / session-start / orchestrator), the honesty-stamp model, and a "Slice roadmap" listing Slices 2–4 (context command, canonical-main+worktree-delta, pre-merge diff) as not-yet-built.

- [ ] **Step 4: Commit**

```bash
git add docs/living-architecture.md
git commit -m "docs(freshness): living-architecture Slice 1 overview + roadmap"
```

---

## Self-Review (completed by planner)

**Spec coverage:** "updated at appropriate times" → hook (Task 7) + drainer debounce/lock (Task 5) + `drain` for orchestrator/session-start (Task 6). "readily available + easy to read by agents" → `navgator freshness` JSON + stamp (Tasks 4, 6); MCP resource explicitly deferred to a later slice. "honest about freshness" → stamp with dirty_files/in_flight (Task 4). Non-blocking hook → detached spawn + `unref` (Tasks 6–7). Single-writer safety under the fleet → scan-lock (Task 3). Tradeoff metadata + `context <target>` + worktree/main model + pre-merge diff → **out of scope, later slices** (stated in header).

**Placeholder scan:** no TBD/TODO; every code step shows complete code; commands show expected output.

**Type consistency:** `markDirty/readDirty/clearDirty` (ledger), `acquireLock/releaseLock/touchLock` + `LOCK_TTL_MS` (lock), `FreshnessStamp`/`writeStamp/readStamp/computeStamp` (stamp), `drain`/`DrainResult`/`DrainOptions.scanFn(root, changed)` (drainer), `runMarkDirty/runDrain/runFreshness`/`registerFreshnessCommands` (CLI) — names match across tasks.

**One thing to verify during execution:** Task 1 Step 4 note — confirm `navgatorBase` against `src/config.ts:113` `getStoragePath`; adjust if local-mode dirname isn't `<root>/.navgator`.
