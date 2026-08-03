/**
 * Contract tests for the registry operation journal.
 *
 * The journal's whole job is to leave evidence that a registry read or write
 * happened. Two properties therefore matter more than anything else here and
 * are tested first: it must never throw into its caller (a broken journal must
 * not break a registry write), and it must never grow without bound.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  appendJournalEvent,
  appendJournalEventSync,
  readJournal,
  formatJournal,
  registryDigest,
  journalPathForDir,
  journalPathForRegistry,
  defaultRegistryDir,
  JOURNAL_FILENAME,
  JOURNAL_ROTATED_FILENAME,
} from '../registry-journal.js';

let dir: string;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-journal-'));
  for (const key of [
    'NAVGATOR_REGISTRY_JOURNAL',
    'NAVGATOR_REGISTRY_JOURNAL_MAX_BYTES',
    'NAVGATOR_JOURNAL_ACTOR',
  ]) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('journal path resolution', () => {
  it('derives the journal from the directory it is handed, not from $HOME', () => {
    // This is what stops a test pointed at a tmp registry from appending to the
    // user's real ~/.navgator/registry-journal.jsonl. `loadRegisteredProjectPaths`
    // takes an arbitrary registryPath, so a home-derived journal would leak.
    expect(journalPathForDir(dir)).toBe(path.join(dir, JOURNAL_FILENAME));
    expect(journalPathForRegistry(path.join(dir, 'projects.json'))).toBe(
      path.join(dir, JOURNAL_FILENAME)
    );
    expect(journalPathForDir(dir).startsWith(os.homedir())).toBe(false);
  });

  it('defaults to ~/.navgator and follows a redirected HOME', () => {
    const prevHome = process.env.HOME;
    process.env.HOME = dir;
    try {
      expect(defaultRegistryDir()).toBe(path.join(dir, '.navgator'));
    } finally {
      if (prevHome === undefined) delete process.env.HOME;
      else process.env.HOME = prevHome;
    }
  });
});

describe('append and read', () => {
  it('round-trips a full record through the async path', async () => {
    await appendJournalEvent(dir, {
      op: 'save',
      rev: 7,
      entries: 12,
      delta: 1,
      digest: 'abc123',
      note: 'register',
      actor: 'cli',
    });

    const [event] = readJournal({ dir });
    expect(event.op).toBe('save');
    expect(event.rev).toBe(7);
    expect(event.entries).toBe(12);
    expect(event.delta).toBe(1);
    expect(event.digest).toBe('abc123');
    expect(event.note).toBe('register');
    expect(event.actor).toBe('cli');
    expect(event.pid).toBe(process.pid);
    expect(typeof event.ts).toBe('number');
  });

  it('round-trips through the sync path and creates the directory', () => {
    const nested = path.join(dir, 'does-not-exist-yet');
    appendJournalEventSync(nested, { op: 'load', rev: 0, entries: 0, actor: 'web-route' });

    const [event] = readJournal({ dir: nested });
    expect(event.op).toBe('load');
    expect(event.actor).toBe('web-route');
  });

  it('keeps records as one JSON object per line', async () => {
    for (let i = 0; i < 5; i++) {
      await appendJournalEvent(dir, { op: 'load', rev: i, entries: i, actor: 'cli' });
    }

    const lines = fs
      .readFileSync(journalPathForDir(dir), 'utf-8')
      .split('\n')
      .filter(Boolean);
    expect(lines).toHaveLength(5);
    for (const line of lines) expect(() => JSON.parse(line)).not.toThrow();
  });

  it('returns the most recent N records, newest last', async () => {
    for (let i = 0; i < 10; i++) {
      await appendJournalEvent(dir, { op: 'load', rev: i, entries: 0, actor: 'cli' });
    }

    const events = readJournal({ dir, limit: 3 });
    expect(events.map((e) => e.rev)).toEqual([7, 8, 9]);
  });

  it('truncates an over-long note instead of storing a payload', async () => {
    await appendJournalEvent(dir, {
      op: 'save',
      rev: 1,
      entries: 1,
      note: 'x'.repeat(5_000),
      actor: 'cli',
    });

    const [event] = readJournal({ dir });
    expect(event.note!.length).toBe(120);
  });
});

describe('filters', () => {
  beforeEach(async () => {
    await appendJournalEvent(dir, { op: 'load', rev: 1, entries: 1, actor: 'cli' });
    await appendJournalEvent(dir, { op: 'register', rev: 2, entries: 2, actor: 'cli' });
    await appendJournalEvent(dir, { op: 'save', rev: 3, entries: 2, actor: 'web-route' });
    await appendJournalEvent(dir, {
      op: 'conflict',
      rev: 4,
      entries: 2,
      base: 2,
      found: 4,
      actor: 'web-route',
    });
  });

  it('filters by actor', () => {
    expect(readJournal({ dir, actor: 'web-route' }).map((e) => e.op)).toEqual([
      'save',
      'conflict',
    ]);
  });

  it('filters by op', () => {
    expect(readJournal({ dir, op: 'register' })).toHaveLength(1);
  });

  it('conflictsOnly surfaces the lost-update records and their base/found pair', () => {
    const conflicts = readJournal({ dir, conflictsOnly: true });
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].base).toBe(2);
    expect(conflicts[0].found).toBe(4);
  });
});

describe('rotation', () => {
  it('rotates at the threshold and never keeps more than two generations', async () => {
    process.env.NAVGATOR_REGISTRY_JOURNAL_MAX_BYTES = '2000';

    for (let i = 0; i < 300; i++) {
      await appendJournalEvent(dir, {
        op: 'save',
        rev: i,
        entries: i,
        note: 'padding-to-reach-the-threshold',
        actor: 'cli',
      });
    }

    const files = fs.readdirSync(dir).filter((f) => f.includes('registry-journal'));
    expect(files.sort()).toEqual([JOURNAL_ROTATED_FILENAME, JOURNAL_FILENAME].sort());

    // The bound that matters, asserted at the strength the comment claims: the
    // size check runs BEFORE each append, so a generation may overshoot by at
    // most one record (~400 bytes with padding) — not by a whole extra
    // threshold. Asserting `< 2 * max` per file would permit 4x the intended
    // total and would not have caught a rotation that stopped firing.
    for (const file of files) {
      expect(fs.statSync(path.join(dir, file)).size).toBeLessThan(2000 + 400);
    }
  });

  it('reads back across the rotation boundary so history is not lost at the seam', async () => {
    process.env.NAVGATOR_REGISTRY_JOURNAL_MAX_BYTES = '1500';

    for (let i = 0; i < 60; i++) {
      await appendJournalEvent(dir, { op: 'save', rev: i, entries: i, actor: 'cli' });
    }

    // The live file alone holds fewer than 60 records after rotation; the read
    // must reach into the rotated generation to satisfy the limit.
    const liveOnly = readJournal({ dir, limit: 60, includeRotated: false });
    const withRotated = readJournal({ dir, limit: 60, includeRotated: true });
    expect(withRotated.length).toBeGreaterThan(liveOnly.length);
  });
});

describe('conflict retention', () => {
  it('writes conflicts to a dedicated log as well as the main journal', async () => {
    await appendJournalEvent(dir, { op: 'conflict', rev: 5, entries: 2, base: 3, found: 5, actor: 'cli' });

    expect(fs.existsSync(path.join(dir, 'registry-conflicts.jsonl'))).toBe(true);
    expect(readJournal({ dir, conflictsOnly: true })).toHaveLength(1);
    // Still present in the main journal too, so a chronological read is intact.
    expect(readJournal({ dir }).some((e) => e.op === 'conflict')).toBe(true);
  });

  it('keeps conflicts readable after routine traffic has rotated the main journal twice', async () => {
    // The evidence this subsystem exists to produce must survive the volume it
    // does not control. Before the dedicated log, ~66k unauthenticated GETs
    // could rotate every conflict record out of existence.
    process.env.NAVGATOR_REGISTRY_JOURNAL_MAX_BYTES = '2000';
    await appendJournalEvent(dir, { op: 'conflict', rev: 1, entries: 1, base: 0, found: 1, actor: 'cli' });

    for (let i = 0; i < 400; i++) {
      await appendJournalEvent(dir, { op: 'load', rev: i, entries: i, note: 'routine read', actor: 'web-route' });
    }

    const conflicts = readJournal({ dir, conflictsOnly: true, limit: 50 });
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].base).toBe(0);
    expect(conflicts[0].found).toBe(1);
  });

  it('finds conflicts in the rotated generation even when the live file is full', async () => {
    // The rotation gate must be judged on MATCHING records. Gating on raw line
    // count made `--conflicts` skip the rotated file whenever the live one held
    // `limit` lines of routine traffic — hiding exactly what was asked for.
    fs.writeFileSync(
      path.join(dir, 'registry-conflicts.1.jsonl'),
      JSON.stringify({ ts: Date.now(), actor: 'cli', pid: 1, op: 'conflict', rev: 9, entries: 1, base: 8, found: 9 }) + '\n'
    );
    for (let i = 0; i < 60; i++) {
      await appendJournalEvent(dir, { op: 'load', rev: i, entries: i, actor: 'cli' });
    }

    expect(readJournal({ dir, conflictsOnly: true, limit: 50 })).toHaveLength(1);
  });
});

describe('record hygiene', () => {
  it('strips control characters from a note so a reader cannot be driven by them', async () => {
    await appendJournalEvent(dir, {
      op: 'save',
      rev: 1,
      entries: 1,
      note: 'before\u001b[31mred\u0007\nafter',
      actor: 'cli',
    });

    const [event] = readJournal({ dir });
    expect(event.note).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/);
    expect(event.note).toContain('before');
    expect(event.note).toContain('after');
  });

  it('records whether the cross-process lock was held', async () => {
    await appendJournalEvent(dir, { op: 'register', rev: 1, entries: 1, locked: true, actor: 'cli' });
    await appendJournalEvent(dir, { op: 'register', rev: 2, entries: 2, locked: false, actor: 'cli' });

    const events = readJournal({ dir });
    expect(events[0].locked).toBe(true);
    expect(events[1].locked).toBe(false);
  });

  it('creates the journal owner-only', async () => {
    await appendJournalEvent(dir, { op: 'save', rev: 1, entries: 1, actor: 'cli' });
    const mode = fs.statSync(journalPathForDir(dir)).mode & 0o777;
    expect(mode).toBe(0o600);
  });
});

describe('fail-open', () => {
  it('does not throw when the journal path is unwritable', async () => {
    // A file where the directory should be makes every append fail.
    const blocked = path.join(dir, 'blocked');
    fs.writeFileSync(blocked, 'not a directory');

    await expect(
      appendJournalEvent(blocked, { op: 'save', rev: 1, entries: 1, actor: 'cli' })
    ).resolves.toBeUndefined();
    expect(() =>
      appendJournalEventSync(blocked, { op: 'save', rev: 1, entries: 1, actor: 'cli' })
    ).not.toThrow();
  });

  it('does not throw when the journal itself is a directory', async () => {
    fs.mkdirSync(journalPathForDir(dir));
    await expect(
      appendJournalEvent(dir, { op: 'save', rev: 1, entries: 1, actor: 'cli' })
    ).resolves.toBeUndefined();
  });

  it('returns an empty list rather than throwing when no journal exists', () => {
    expect(readJournal({ dir: path.join(dir, 'nothing-here') })).toEqual([]);
  });

  it('skips a torn final line and still returns the intact records', async () => {
    await appendJournalEvent(dir, { op: 'save', rev: 1, entries: 1, actor: 'cli' });
    // A process killed mid-append leaves a partial line.
    fs.appendFileSync(journalPathForDir(dir), '{"op":"save","rev":2,"ent');

    const events = readJournal({ dir });
    expect(events).toHaveLength(1);
    expect(events[0].rev).toBe(1);
  });

  it('skips a line that parses but is not a journal record', async () => {
    fs.writeFileSync(journalPathForDir(dir), '"just a string"\n42\nnull\n');
    await appendJournalEvent(dir, { op: 'save', rev: 9, entries: 1, actor: 'cli' });

    const events = readJournal({ dir });
    expect(events).toHaveLength(1);
    expect(events[0].rev).toBe(9);
  });
});

describe('disable switch', () => {
  it('writes nothing when NAVGATOR_REGISTRY_JOURNAL=0', async () => {
    process.env.NAVGATOR_REGISTRY_JOURNAL = '0';
    await appendJournalEvent(dir, { op: 'save', rev: 1, entries: 1, actor: 'cli' });
    appendJournalEventSync(dir, { op: 'save', rev: 2, entries: 1, actor: 'cli' });

    expect(fs.existsSync(journalPathForDir(dir))).toBe(false);
  });

  it('writes when the variable is absent (journaling is on by default)', async () => {
    await appendJournalEvent(dir, { op: 'save', rev: 1, entries: 1, actor: 'cli' });
    expect(readJournal({ dir })).toHaveLength(1);
  });
});

describe('digest', () => {
  it('is stable for equal content and differs for different content', () => {
    const a = { version: 2, revision: 1, projects: [{ path: '/x' }] };
    const b = { version: 2, revision: 1, projects: [{ path: '/x' }] };
    const c = { version: 2, revision: 1, projects: [{ path: '/y' }] };

    expect(registryDigest(a)).toBe(registryDigest(b));
    expect(registryDigest(a)).not.toBe(registryDigest(c));
    expect(registryDigest(a)).toHaveLength(16);
  });

  it('does not throw on a circular structure', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => registryDigest(circular)).not.toThrow();
  });
});

describe('formatJournal', () => {
  it('says so plainly when there is nothing to show', () => {
    expect(formatJournal([])).toContain('No registry journal entries yet');
  });

  it('distinguishes an empty journal from a filter that matched nothing', () => {
    // `--conflicts` on a healthy registry hits this. Reporting "no entries yet"
    // there would tell the user the journal is not recording, which is false.
    const filtered = formatJournal([], { filtered: true });
    expect(filtered).toContain('match that filter');
    expect(filtered).not.toContain('No registry journal entries yet');
  });

  it('reports zero conflicts when none were recorded', async () => {
    await appendJournalEvent(dir, { op: 'save', rev: 1, entries: 1, actor: 'cli' });
    expect(formatJournal(readJournal({ dir }))).toContain('no lost-update conflicts detected');
  });

  it('does not claim the registry is conflict-free from a filtered slice', async () => {
    // `--op register` renders only register records; saying "no lost-update
    // conflicts detected" there would be a false statement about the journal.
    await appendJournalEvent(dir, { op: 'register', rev: 1, entries: 1, actor: 'cli' });
    const rendered = formatJournal(readJournal({ dir, op: 'register' }), { filtered: true });

    expect(rendered).not.toContain('no lost-update conflicts detected');
    expect(rendered).toContain('matching the filter');
  });

  it('surfaces the conflict count and the base/disk mismatch', async () => {
    await appendJournalEvent(dir, {
      op: 'conflict',
      rev: 5,
      entries: 3,
      base: 2,
      found: 5,
      actor: 'web-route',
    });

    const rendered = formatJournal(readJournal({ dir }));
    expect(rendered).toContain('1 lost-update conflict detected');
    expect(rendered).toContain('base 2 != disk 5');
  });
});
