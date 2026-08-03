/**
 * Concurrency oracle for the web route's atomic-write helper.
 *
 * web/lib/server/atomic-write.ts is a deliberate twin of src/storage.ts's
 * atomicWriteFile (the web app compiles separately from the CLI). The original
 * pid+Date.now() suffix defect shipped precisely because a copy of the pattern
 * lacked a concurrency test — this file holds the twin to the same contract as
 * src/__tests__/atomic-write-concurrency.test.ts holds the original.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { atomicWriteFile } from '../../web/lib/server/atomic-write.js';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-web-atomic-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('web atomicWriteFile under concurrency', () => {
  it(
    'never rejects and never publishes a torn file with 8 concurrent writers',
    { timeout: 30_000 },
    async () => {
      const target = path.join(dir, 'registry.json');
      // Payload large enough that a truncating peer is observable; tiny writes
      // always won the original race cleanly and hid the defect.
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

        const raw = fs.readFileSync(target, 'utf-8');
        expect(() => JSON.parse(raw)).not.toThrow();
      }

      expect(rejected).toBe(0);
    }
  );

  it('leaves no temp file behind when the write fails', async () => {
    // A directory at the target path makes rename fail with EISDIR.
    const target = path.join(dir, 'as-a-dir');
    fs.mkdirSync(target);

    await expect(atomicWriteFile(target, 'content')).rejects.toBeTruthy();

    const strays = fs.readdirSync(dir).filter((f) => f.endsWith('.tmp'));
    expect(strays).toEqual([]);
  });

  it('generates a distinct temp path per call within the same millisecond', async () => {
    // Two same-ms writes must not share a temp path; success of both plus a
    // parseable result is the observable contract.
    const target = path.join(dir, 'same-ms.json');
    await Promise.all([
      atomicWriteFile(target, JSON.stringify({ a: 1 })),
      atomicWriteFile(target, JSON.stringify({ b: 2 })),
    ]);
    expect(() => JSON.parse(fs.readFileSync(target, 'utf-8'))).not.toThrow();
  });
});
