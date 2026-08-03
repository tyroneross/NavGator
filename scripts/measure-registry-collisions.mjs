#!/usr/bin/env node
/**
 * Measure lost-update collisions from the registry journal.
 *
 * The journal records every read and write of ~/.navgator/projects.json. This
 * script reads it back and counts the one thing the journal exists to make
 * visible: two or more processes publishing the SAME revision with DIFFERENT
 * content digests inside one burst. Each such burst means N-1 writers were
 * overwritten and their registrations silently lost.
 *
 * Why the burst window matters: a revision can legitimately repeat if the
 * registry file is restored from a backup, which rolls the counter back and
 * re-issues revisions. Those writes are minutes apart. Requiring the writes to
 * fall inside a few seconds of each other, from different pids, with different
 * digests, separates a real race from a rollback. Without that constraint a
 * restore reads as dozens of phantom collisions — verified while writing this.
 *
 * Usage:
 *   node scripts/measure-registry-collisions.mjs [--journal <path>] [--since <iso>]
 *                                                [--window-ms 3000] [--json]
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const WRITE_OPS = new Set(["register", "save", "update", "remove"]);

function parseArgs(argv) {
  const args = {
    journal: path.join(os.homedir(), ".navgator", "registry-journal.jsonl"),
    windowMs: 3000,
    since: null,
    json: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === "--journal") args.journal = argv[++i];
    else if (flag === "--window-ms") args.windowMs = Number.parseInt(argv[++i], 10);
    else if (flag === "--since") args.since = Date.parse(argv[++i]);
    else if (flag === "--json") args.json = true;
    else if (flag === "--help" || flag === "-h") {
      console.log(
        "usage: measure-registry-collisions.mjs [--journal <path>] [--since <iso>] [--window-ms <n>] [--json]"
      );
      process.exit(0);
    }
  }
  if (!Number.isFinite(args.windowMs) || args.windowMs <= 0) args.windowMs = 3000;
  return args;
}

function readRecords(journalPath) {
  let raw;
  try {
    raw = fs.readFileSync(journalPath, "utf-8");
  } catch {
    return [];
  }
  const records = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed?.ts === "number" && typeof parsed?.op === "string") records.push(parsed);
    } catch {
      // Torn final line from a killed process — skip it, keep the rest.
    }
  }
  return records;
}

/** Group each revision's writes into bursts, then keep the genuinely concurrent ones. */
function findCollisions(records, windowMs) {
  const writes = records.filter((r) => WRITE_OPS.has(r.op));
  const byRevision = new Map();
  for (const write of writes) {
    if (!byRevision.has(write.rev)) byRevision.set(write.rev, []);
    byRevision.get(write.rev).push(write);
  }

  const collisions = [];
  for (const [revision, group] of byRevision) {
    group.sort((a, b) => a.ts - b.ts);
    let burst = [group[0]];
    const flush = () => {
      if (burst.length < 2) return;
      const pids = new Set(burst.map((w) => w.pid));
      const digests = new Set(burst.map((w) => w.digest));
      // Same pid twice is a retry, not a race. Same digest twice is an
      // idempotent rewrite, not a lost update. Both must differ.
      if (pids.size > 1 && digests.size > 1) {
        collisions.push({
          revision,
          at: new Date(burst[0].ts).toISOString(),
          writers: burst.length,
          lost: burst.length - 1,
          pids: [...pids],
          actors: [...new Set(burst.map((w) => w.actor))],
        });
      }
    };
    for (let i = 1; i < group.length; i++) {
      if (group[i].ts - burst[0].ts <= windowMs) burst.push(group[i]);
      else {
        flush();
        burst = [group[i]];
      }
    }
    flush();
  }
  return collisions.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

const args = parseArgs(process.argv);
let records = readRecords(args.journal);
if (args.since !== null && Number.isFinite(args.since)) {
  records = records.filter((r) => r.ts >= args.since);
}

const writes = records.filter((r) => WRITE_OPS.has(r.op));
const collisions = findCollisions(records, args.windowMs);
const journaledConflicts = records.filter((r) => r.op === "conflict");
const lost = collisions.reduce((sum, c) => sum + c.lost, 0);

const report = {
  journal: args.journal,
  records: records.length,
  writes: writes.length,
  span:
    records.length > 0
      ? { from: new Date(records[0].ts).toISOString(), to: new Date(records.at(-1).ts).toISOString() }
      : null,
  collisions: collisions.length,
  entries_lost: lost,
  journaled_conflicts: journaledConflicts.length,
  detail: collisions,
};

if (args.json) {
  console.log(JSON.stringify(report, null, 2));
} else if (records.length === 0) {
  console.log(`No journal records at ${args.journal}.`);
} else {
  console.log(`Registry journal: ${args.journal}`);
  console.log(`  ${report.records} records (${report.writes} writes) from ${report.span.from} to ${report.span.to}`);
  console.log(`  ${report.collisions} lost-update collisions, ${report.entries_lost} entries silently lost`);
  console.log(`  ${report.journaled_conflicts} conflicts detected and journaled by the writers themselves`);
  if (collisions.length > 0) {
    console.log("");
    for (const c of collisions) {
      console.log(
        `  rev ${c.revision} at ${c.at} — ${c.writers} writers (${c.actors.join("/")}, pids ${c.pids.join(",")}), ${c.lost} lost`
      );
    }
    console.log("");
    console.log(
      "A collision with 0 journaled conflicts is the compare-and-swap blind spot: writers"
    );
    console.log(
      "that load the same revision in the same tick all pass their own check. The cross-process"
    );
    console.log("file lock is what prevents it; CAS only catches what gets past the lock.");
  }
}
