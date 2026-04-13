/**
 * Tests for the global + local lessons store.
 *
 * Uses `fs.mkdtempSync` for isolation. The global store is redirected via
 * `NAVGATOR_GLOBAL_LESSONS_DIR` so the user's real `~/.navgator/` is never touched.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  globalLessonsPath,
  localLessonsPath,
  readLessons,
  writeLessons,
  listLessons,
  searchLessons,
  findLessonById,
  promoteLesson,
  demoteLesson,
  type Lesson,
  type GlobalLesson,
  type LessonsFile,
} from '../lessons-store.js';

let projectRoot = '';
let globalDir = '';
let prevEnv: string | undefined;

function sampleLesson(overrides: Partial<Lesson> = {}): Lesson {
  return {
    id: 'lesson-api-contract-missing-field',
    category: 'api-contract',
    pattern: 'API response missing expected field',
    signature: ['res\\.json\\(\\{[^}]*\\}\\)'],
    severity: 'important',
    context: {
      first_seen: '2026-01-01T00:00:00Z',
      occurrences: 1,
      files_affected: ['src/api/users.ts'],
      resolution: 'Include field in serializer',
    },
    example: {
      bad: 'res.json({ id })',
      good: 'res.json({ id, name })',
    },
    ...overrides,
  };
}

function seedLocal(lessons: Lesson[], project = 'test-project'): void {
  const file: LessonsFile = {
    schema_version: '1.0.0',
    project,
    lessons,
  };
  writeLessons(localLessonsPath(projectRoot), file);
}

beforeEach(() => {
  projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-lessons-proj-'));
  globalDir = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-lessons-global-'));
  prevEnv = process.env.NAVGATOR_GLOBAL_LESSONS_DIR;
  process.env.NAVGATOR_GLOBAL_LESSONS_DIR = globalDir;
});

afterEach(() => {
  if (prevEnv === undefined) delete process.env.NAVGATOR_GLOBAL_LESSONS_DIR;
  else process.env.NAVGATOR_GLOBAL_LESSONS_DIR = prevEnv;
  try { fs.rmSync(projectRoot, { recursive: true, force: true }); } catch { /* ignore */ }
  try { fs.rmSync(globalDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

// ---------------------------------------------------------------------------

describe('paths', () => {
  it('globalLessonsPath honors NAVGATOR_GLOBAL_LESSONS_DIR', () => {
    expect(globalLessonsPath()).toBe(path.join(globalDir, 'global-lessons.json'));
  });

  it('localLessonsPath joins project root', () => {
    expect(localLessonsPath('/tmp/x')).toBe(
      path.join('/tmp/x', '.navgator', 'lessons', 'lessons.json'),
    );
  });
});

describe('read/write', () => {
  it('readLessons returns empty default when file missing', () => {
    const file = readLessons(localLessonsPath(projectRoot));
    expect(file.schema_version).toBe('1.0.0');
    expect(file.project).toBe('');
    expect(file.lessons).toEqual([]);
  });

  it('write then read roundtrip (local)', () => {
    const original: LessonsFile = {
      schema_version: '1.0.0',
      project: 'p',
      lessons: [sampleLesson()],
    };
    writeLessons(localLessonsPath(projectRoot), original);
    const round = readLessons(localLessonsPath(projectRoot));
    expect(round.project).toBe('p');
    expect(round.lessons).toHaveLength(1);
    expect((round.lessons[0] as Lesson).id).toBe('lesson-api-contract-missing-field');
  });

  it('write then read roundtrip (global)', () => {
    const original: LessonsFile = {
      schema_version: '1.0.0',
      project: '',
      lessons: [],
    };
    writeLessons(globalLessonsPath(), original);
    const round = readLessons(globalLessonsPath());
    expect(round.project).toBe('');
    expect(round.lessons).toEqual([]);
  });
});

describe('listLessons', () => {
  it('lists local lessons', () => {
    seedLocal([sampleLesson()]);
    const list = listLessons({ scope: 'local', projectRoot });
    expect(list).toHaveLength(1);
  });

  it('lists global lessons (empty by default)', () => {
    const list = listLessons({ scope: 'global' });
    expect(list).toEqual([]);
  });
});

describe('promoteLesson', () => {
  it('copies the lesson into global and marks local as promoted', () => {
    seedLocal([sampleLesson()]);
    const result = promoteLesson(
      'lesson-api-contract-missing-field',
      projectRoot,
      { applies_to: ['nextjs', 'prisma'], project_name: 'my-app' },
    );
    expect(result.promoted).toBe(true);
    expect(result.reason).toBe('ok');
    expect(result.globalLesson).toBeTruthy();
    expect(result.globalLesson?.source_project).toBe('my-app');
    expect(result.globalLesson?.applies_to).toEqual(['nextjs', 'prisma']);
    expect(result.globalLesson?.promoted_at).toBeTruthy();
    expect(result.globalLesson?.promoted_from).toBe(localLessonsPath(projectRoot));
    // Global lesson does NOT carry the `promoted: true` local marker
    expect((result.globalLesson as unknown as Lesson).promoted).toBeUndefined();

    // Local: marked promoted, otherwise unchanged
    const local = readLessons(localLessonsPath(projectRoot));
    expect((local.lessons[0] as Lesson).promoted).toBe(true);
    expect(local.lessons[0].pattern).toBe('API response missing expected field');
    expect(local.lessons).toHaveLength(1);

    // Global: exactly one lesson present
    const global = readLessons(globalLessonsPath());
    expect(global.lessons).toHaveLength(1);
  });

  it('returns already-global when re-promoting', () => {
    seedLocal([sampleLesson()]);
    promoteLesson('lesson-api-contract-missing-field', projectRoot);
    const again = promoteLesson('lesson-api-contract-missing-field', projectRoot);
    expect(again.promoted).toBe(false);
    expect(again.reason).toBe('already-global');
    expect(again.globalLesson).toBeNull();
  });

  it('returns not-found when id missing locally', () => {
    seedLocal([sampleLesson()]);
    const res = promoteLesson('lesson-data-flow-nope', projectRoot);
    expect(res.promoted).toBe(false);
    expect(res.reason).toBe('not-found');
  });

  it('rejects invalid ids', () => {
    seedLocal([sampleLesson()]);
    expect(() => promoteLesson('not_a_valid_id', projectRoot)).toThrow(/Invalid lesson id/);
  });
});

describe('demoteLesson', () => {
  it('removes from global but leaves local untouched', () => {
    seedLocal([sampleLesson()]);
    promoteLesson('lesson-api-contract-missing-field', projectRoot);
    const res = demoteLesson('lesson-api-contract-missing-field');
    expect(res.demoted).toBe(true);
    expect(readLessons(globalLessonsPath()).lessons).toHaveLength(0);
    // Local still has the lesson (still marked promoted — we don't revert it)
    const local = readLessons(localLessonsPath(projectRoot));
    expect(local.lessons).toHaveLength(1);
  });

  it('is idempotent — returns not-found when lesson absent', () => {
    const res = demoteLesson('lesson-infrastructure-ghost');
    expect(res.demoted).toBe(false);
    expect(res.reason).toBe('not-found');
  });
});

describe('searchLessons', () => {
  it('searches by regex across pattern', () => {
    seedLocal([
      sampleLesson(),
      sampleLesson({ id: 'lesson-data-flow-stale-cache', category: 'data-flow', pattern: 'Stale cache read after write' }),
    ]);
    const res = searchLessons('cache', { scope: 'local', projectRoot });
    expect(res).toHaveLength(1);
    expect(res[0].id).toBe('lesson-data-flow-stale-cache');
  });

  it('searches by tag on global lessons only', () => {
    seedLocal([sampleLesson()]);
    promoteLesson('lesson-api-contract-missing-field', projectRoot, {
      applies_to: ['nextjs'],
    });
    const res = searchLessons('', { scope: 'all', projectRoot, tags: ['nextjs'] });
    // Tag filter excludes the local (no applies_to), keeps the global
    expect(res).toHaveLength(1);
    expect((res[0] as GlobalLesson).applies_to).toContain('nextjs');
  });

  it('stacks category + severity + tag filters', () => {
    seedLocal([
      sampleLesson(),
      sampleLesson({
        id: 'lesson-data-flow-other',
        category: 'data-flow',
        severity: 'critical',
        pattern: 'Different lesson',
      }),
    ]);
    // Promote both so tags are available
    promoteLesson('lesson-api-contract-missing-field', projectRoot, { applies_to: ['nextjs'] });
    promoteLesson('lesson-data-flow-other', projectRoot, { applies_to: ['nextjs'] });
    const res = searchLessons('', {
      scope: 'global',
      category: 'data-flow',
      severity: 'critical',
      tags: ['nextjs'],
    });
    expect(res).toHaveLength(1);
    expect(res[0].id).toBe('lesson-data-flow-other');
  });
});

describe('findLessonById', () => {
  it('returns the matching lesson or null', () => {
    seedLocal([sampleLesson()]);
    expect(findLessonById('lesson-api-contract-missing-field', { scope: 'local', projectRoot })).toBeTruthy();
    expect(findLessonById('lesson-nope', { scope: 'local', projectRoot })).toBeNull();
  });
});

describe('atomic write', () => {
  it('surfaces a sensible error when the target dir cannot be created', () => {
    // Point at a path under a regular file — mkdirSync will fail.
    const blocker = path.join(projectRoot, 'blocker');
    fs.writeFileSync(blocker, 'not-a-dir');
    const bad = path.join(blocker, 'lessons.json');
    expect(() => writeLessons(bad, { schema_version: '1.0.0', project: '', lessons: [] }))
      .toThrow();
  });
});
