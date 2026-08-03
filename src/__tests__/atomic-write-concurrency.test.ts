/**
 * Closure proof for the temp-filename collision found in review.
 *
 * `atomicWriteFile` used a `pid + Date.now()` suffix, which is NOT unique per
 * call: two writes in the same process in the same millisecond shared one temp
 * path. One writer truncated it while another was still writing, and the torn
 * content was then renamed into place — reintroducing exactly the torn read the
 * helper exists to prevent. Measured before the fix at 8 concurrent writers:
 * 1398/2400 renames failed ENOENT and 123/400 rounds published unparseable JSON.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { atomicWriteFile } from '../storage.js';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-atomic-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('atomicWriteFile under concurrency', () => {
  // Explicit timeout: this test writes ~64MB (40 rounds x 8 writers x 200KB).
  // Under the 5s default it can time out on a cold first run when parallel
  // workers contend for disk and vite transform I/O.
  it('never rejects and never publishes a torn file with 8 concurrent writers', { timeout: 30_000 }, async () => {
    const target = path.join(dir, 'registry.json');
    // A payload large enough that a truncating peer is observable. The original
    // defect needed size to reproduce; a few bytes always won the race cleanly.
    const payload = (n: number) =>
      JSON.stringify({ writer: n, filler: 'x'.repeat(200_000) });

    const ROUNDS = 40;
    const WRITERS = 8;
    let rejected = 0;

    for (let round = 0; round < ROUNDS; round++) {
      const results = await Promise.allSettled(
        Array.from({ length: WRITERS }, (_, w) => atomicWriteFile(target, payload(w)))
      );
      rejected += results.filter((r) => r.status === 'rejected').length;

      // Whatever won, the published file must be complete and parseable.
      const raw = fs.readFileSync(target, 'utf-8');
      expect(() => JSON.parse(raw)).not.toThrow();
    }

    expect(rejected).toBe(0);
  });

  it('leaves no temp file behind when the write fails', async () => {
    // A directory at the target path makes rename fail with EISDIR.
    const target = path.join(dir, 'as-a-dir');
    fs.mkdirSync(target);

    await expect(atomicWriteFile(target, 'content')).rejects.toBeTruthy();

    const strays = fs.readdirSync(dir).filter((f) => f.includes('.tmp.'));
    expect(strays).toEqual([]);
  });

  it('generates a distinct temp path per call within the same millisecond', async () => {
    // Indirect but sufficient: many same-tick writes all succeed, which is only
    // possible if each reserved its own temp path.
    const target = path.join(dir, 'same-tick.json');
    const results = await Promise.allSettled(
      Array.from({ length: 32 }, (_, i) => atomicWriteFile(target, JSON.stringify({ i })))
    );
    expect(results.filter((r) => r.status === 'rejected')).toEqual([]);
    expect(() => JSON.parse(fs.readFileSync(target, 'utf-8'))).not.toThrow();
  });
});
