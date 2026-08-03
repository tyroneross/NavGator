/**
 * Atomic file write for web API routes.
 *
 * Write through a temp file and rename. A plain writeFile can be observed
 * half-written by src/projects.ts's loadRegistry, which parse-fails to an EMPTY
 * registry rather than an error — so a torn write from a route reads as
 * "no projects registered" on the CLI side. Rename is atomic on the same
 * filesystem, so a concurrent reader sees either the old file or the new one.
 *
 * The suffix must be unique PER CALL. Next.js serves concurrent requests in one
 * process, so `pid + Date.now()` collides whenever two saves land in the same
 * millisecond: one writer truncates the shared temp while another is still
 * writing it, and the torn content then gets renamed into place. Measured at 8
 * concurrent writers: 1398 of 2400 renames failed ENOENT and 123 of 400 rounds
 * published unparseable JSON. The random suffix removes both.
 *
 * This mirrors src/storage.ts's atomicWriteFile; the web app compiles
 * separately from the CLI, so the helper lives here rather than importing
 * across package boundaries. The shared concurrency oracle in
 * src/__tests__/web-atomic-write-concurrency.test.ts holds this copy to the
 * same contract.
 */

import * as fs from "fs/promises";
import { randomBytes } from "crypto";

export async function atomicWriteFile(
  target: string,
  content: string
): Promise<void> {
  const tmp = `${target}.${process.pid}.${Date.now()}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    await fs.writeFile(tmp, content, "utf-8");
    await fs.rename(tmp, target);
  } catch (error) {
    // Without this the temp survives every failed write and leaks a full copy
    // of the payload beside the target.
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw error;
  }
}
