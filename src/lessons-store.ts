/**
 * NavGator Lessons Store
 *
 * Manages per-project and global architectural lessons. Local lessons live at
 * `<project>/.navgator/lessons/lessons.json`. Promoted lessons are copied (never
 * moved) into `~/.navgator/lessons/global-lessons.json` and the local copy is
 * marked with `promoted: true`.
 *
 * Zero external deps — uses node fs/path/os only. Writes are atomic (temp+rename).
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// =============================================================================
// TYPES
// =============================================================================

export type Severity = 'critical' | 'important' | 'minor';

export type LessonCategory =
  | 'api-contract'
  | 'data-flow'
  | 'component-communication'
  | 'llm-architecture'
  | 'infrastructure'
  | 'typespec'
  | 'database-structure';

const VALID_CATEGORIES: ReadonlySet<LessonCategory> = new Set<LessonCategory>([
  'api-contract',
  'data-flow',
  'component-communication',
  'llm-architecture',
  'infrastructure',
  'typespec',
  'database-structure',
]);

const VALID_SEVERITIES: ReadonlySet<Severity> = new Set<Severity>([
  'critical',
  'important',
  'minor',
]);

const ID_PATTERN = /^lesson-[a-z0-9-]+$/;

export interface LessonContext {
  first_seen?: string;
  last_seen?: string;
  occurrences?: number;
  files_affected?: string[];
  resolution?: string;
}

export interface LessonExample {
  bad?: string;
  good?: string;
  why?: string;
}

export interface Lesson {
  id: string;
  category: LessonCategory;
  pattern: string;
  signature?: string[];
  severity: Severity;
  context?: LessonContext;
  example?: LessonExample;
  /** Set to true on the local lesson after a successful promotion. */
  promoted?: boolean;
}

export interface GlobalLesson extends Lesson {
  source_project: string;
  applies_to?: string[];
  promoted_at: string;
  promoted_from?: string;
}

export interface LessonsFile {
  schema_version: string;
  project: string;
  lessons: Lesson[] | GlobalLesson[];
  /** Preserved on read/write for backward compatibility with repo template file. */
  _template?: unknown;
}

export const LESSONS_SCHEMA_VERSION = '1.0.0';

// =============================================================================
// PATHS
// =============================================================================

/**
 * Directory that holds the global lessons file. Honors the
 * `NAVGATOR_GLOBAL_LESSONS_DIR` env var so tests can redirect to a tmpdir.
 */
function globalLessonsDir(): string {
  const override = process.env.NAVGATOR_GLOBAL_LESSONS_DIR;
  if (override && override.trim() !== '') return override;
  return path.join(os.homedir(), '.navgator', 'lessons');
}

export function globalLessonsPath(): string {
  return path.join(globalLessonsDir(), 'global-lessons.json');
}

export function localLessonsPath(projectRoot: string): string {
  return path.join(projectRoot, '.navgator', 'lessons', 'lessons.json');
}

// =============================================================================
// READ / WRITE
// =============================================================================

function emptyFile(project: string): LessonsFile {
  return {
    schema_version: LESSONS_SCHEMA_VERSION,
    project,
    lessons: [],
  };
}

export function readLessons(filePath: string): LessonsFile {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<LessonsFile>;
    return {
      schema_version: parsed.schema_version || LESSONS_SCHEMA_VERSION,
      project: parsed.project ?? '',
      lessons: Array.isArray(parsed.lessons) ? (parsed.lessons as Lesson[]) : [],
      ...(parsed._template !== undefined ? { _template: parsed._template } : {}),
    };
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === 'ENOENT') {
      return emptyFile('');
    }
    // Malformed JSON or other read error — return empty so callers can overwrite.
    if (err instanceof SyntaxError) return emptyFile('');
    throw err;
  }
}

/**
 * Atomic write: write to a sibling temp file, then rename into place.
 * On any failure the caller sees a thrown error and the original is untouched.
 */
export function writeLessons(filePath: string, data: LessonsFile): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(
    dir,
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`,
  );
  const payload = JSON.stringify(data, null, 2);
  try {
    fs.writeFileSync(tmp, payload, 'utf-8');
    fs.renameSync(tmp, filePath);
  } catch (err) {
    // Best-effort cleanup of the temp file.
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
    throw err;
  }
}

/**
 * Ensure the global lessons file exists, seeded with an empty template.
 * Safe to call repeatedly. Never touches `~/.navgator/projects.json`.
 */
export function ensureGlobalLessonsFile(): string {
  const p = globalLessonsPath();
  if (!fs.existsSync(p)) {
    writeLessons(p, emptyFile(''));
  }
  return p;
}

// =============================================================================
// VALIDATION
// =============================================================================

function isValidId(id: string): boolean {
  return typeof id === 'string' && ID_PATTERN.test(id);
}

function assertValidId(id: string): void {
  if (!isValidId(id)) {
    throw new Error(
      `Invalid lesson id "${id}" — must match ${ID_PATTERN.source}`,
    );
  }
}

function assertValidCategory(c: unknown): void {
  if (!VALID_CATEGORIES.has(c as LessonCategory)) {
    throw new Error(`Invalid category "${String(c)}"`);
  }
}

function assertValidSeverity(s: unknown): void {
  if (!VALID_SEVERITIES.has(s as Severity)) {
    throw new Error(`Invalid severity "${String(s)}"`);
  }
}

// =============================================================================
// OPERATIONS
// =============================================================================

interface ListOpts {
  scope: 'local' | 'global';
  projectRoot?: string;
}

export function listLessons(opts: ListOpts): Lesson[] | GlobalLesson[] {
  if (opts.scope === 'global') {
    const file = readLessons(globalLessonsPath());
    return (file.lessons as GlobalLesson[]) || [];
  }
  if (!opts.projectRoot) {
    throw new Error('listLessons: projectRoot required for scope=local');
  }
  const file = readLessons(localLessonsPath(opts.projectRoot));
  return (file.lessons as Lesson[]) || [];
}

interface SearchOpts {
  scope: 'local' | 'global' | 'all';
  projectRoot?: string;
  category?: LessonCategory;
  severity?: Severity;
  tags?: string[];
}

function lessonMatchesQuery(l: Lesson | GlobalLesson, re: RegExp | null): boolean {
  if (!re) return true;
  if (re.test(l.pattern || '')) return true;
  if (Array.isArray(l.signature) && l.signature.some((s) => re.test(s))) return true;
  if (l.example?.bad && re.test(l.example.bad)) return true;
  if (l.example?.good && re.test(l.example.good)) return true;
  if (l.context?.resolution && re.test(l.context.resolution)) return true;
  if (re.test(l.id)) return true;
  return false;
}

export function searchLessons(
  query: string,
  opts: SearchOpts,
): (Lesson | GlobalLesson)[] {
  let re: RegExp | null = null;
  if (query && query.trim() !== '') {
    try {
      re = new RegExp(query, 'i');
    } catch {
      // Fall back to literal substring if regex is invalid.
      const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      re = new RegExp(escaped, 'i');
    }
  }

  const pool: (Lesson | GlobalLesson)[] = [];
  if (opts.scope === 'local' || opts.scope === 'all') {
    if (opts.projectRoot) {
      const local = readLessons(localLessonsPath(opts.projectRoot));
      pool.push(...(local.lessons as Lesson[]));
    }
  }
  if (opts.scope === 'global' || opts.scope === 'all') {
    const global = readLessons(globalLessonsPath());
    pool.push(...(global.lessons as GlobalLesson[]));
  }

  return pool.filter((l) => {
    if (!lessonMatchesQuery(l, re)) return false;
    if (opts.category && l.category !== opts.category) return false;
    if (opts.severity && l.severity !== opts.severity) return false;
    if (opts.tags && opts.tags.length > 0) {
      // Tags only apply to GlobalLesson.applies_to — filter out non-global matches.
      const applies = (l as GlobalLesson).applies_to;
      if (!Array.isArray(applies)) return false;
      const hasAll = opts.tags.every((t) => applies.includes(t));
      if (!hasAll) return false;
    }
    return true;
  });
}

export function findLessonById(
  id: string,
  opts: ListOpts,
): Lesson | GlobalLesson | null {
  const list = listLessons(opts) as (Lesson | GlobalLesson)[];
  return list.find((l) => l.id === id) || null;
}

interface PromoteResult {
  promoted: boolean;
  globalLesson: GlobalLesson | null;
  reason?: 'not-found' | 'already-global' | 'ok';
}

interface PromoteOpts {
  applies_to?: string[];
  project_name?: string;
}

export function promoteLesson(
  id: string,
  projectRoot: string,
  opts: PromoteOpts = {},
): PromoteResult {
  assertValidId(id);

  const localPath = localLessonsPath(projectRoot);
  const localFile = readLessons(localPath);
  const localLessons = localFile.lessons as Lesson[];
  const localIdx = localLessons.findIndex((l) => l.id === id);
  if (localIdx === -1) {
    return { promoted: false, globalLesson: null, reason: 'not-found' };
  }
  const localLesson = localLessons[localIdx];

  // Re-validate the lesson so we never promote garbage.
  assertValidCategory(localLesson.category);
  assertValidSeverity(localLesson.severity);

  const globalPath = globalLessonsPath();
  const globalFile = readLessons(globalPath);
  if (!globalFile.project) globalFile.project = '';
  const globalLessons = globalFile.lessons as GlobalLesson[];

  if (globalLessons.some((l) => l.id === id)) {
    return { promoted: false, globalLesson: null, reason: 'already-global' };
  }

  const projectName =
    opts.project_name ||
    localFile.project ||
    path.basename(projectRoot) ||
    projectRoot;

  const globalLesson: GlobalLesson = {
    ...localLesson,
    source_project: projectName,
    applies_to: opts.applies_to && opts.applies_to.length > 0 ? [...opts.applies_to] : undefined,
    promoted_at: new Date().toISOString(),
    promoted_from: localPath,
  };
  // Don't carry the local-only `promoted` marker into the global record.
  delete (globalLesson as Partial<Lesson>).promoted;

  globalLessons.push(globalLesson);
  globalFile.lessons = globalLessons;
  writeLessons(globalPath, globalFile);

  // Mark the local lesson (copy-then-mark — never move).
  localLessons[localIdx] = { ...localLesson, promoted: true };
  localFile.lessons = localLessons;
  writeLessons(localPath, localFile);

  return { promoted: true, globalLesson, reason: 'ok' };
}

interface DemoteResult {
  demoted: boolean;
  reason?: 'not-found' | 'ok';
}

export function demoteLesson(id: string): DemoteResult {
  assertValidId(id);
  const globalPath = globalLessonsPath();
  const globalFile = readLessons(globalPath);
  const globalLessons = globalFile.lessons as GlobalLesson[];
  const next = globalLessons.filter((l) => l.id !== id);
  if (next.length === globalLessons.length) {
    return { demoted: false, reason: 'not-found' };
  }
  globalFile.lessons = next;
  writeLessons(globalPath, globalFile);
  return { demoted: true, reason: 'ok' };
}
