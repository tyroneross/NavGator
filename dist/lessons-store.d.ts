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
export type Severity = 'critical' | 'important' | 'minor';
export type LessonCategory = 'api-contract' | 'data-flow' | 'component-communication' | 'llm-architecture' | 'infrastructure' | 'typespec' | 'database-structure';
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
export declare const LESSONS_SCHEMA_VERSION = "1.0.0";
export declare function globalLessonsPath(): string;
export declare function localLessonsPath(projectRoot: string): string;
export declare function readLessons(filePath: string): LessonsFile;
/**
 * Atomic write: write to a sibling temp file, then rename into place.
 * On any failure the caller sees a thrown error and the original is untouched.
 */
export declare function writeLessons(filePath: string, data: LessonsFile): void;
/**
 * Ensure the global lessons file exists, seeded with an empty template.
 * Safe to call repeatedly. Never touches `~/.navgator/projects.json`.
 */
export declare function ensureGlobalLessonsFile(): string;
interface ListOpts {
    scope: 'local' | 'global';
    projectRoot?: string;
}
export declare function listLessons(opts: ListOpts): Lesson[] | GlobalLesson[];
interface SearchOpts {
    scope: 'local' | 'global' | 'all';
    projectRoot?: string;
    category?: LessonCategory;
    severity?: Severity;
    tags?: string[];
}
export declare function searchLessons(query: string, opts: SearchOpts): (Lesson | GlobalLesson)[];
export declare function findLessonById(id: string, opts: ListOpts): Lesson | GlobalLesson | null;
interface PromoteResult {
    promoted: boolean;
    globalLesson: GlobalLesson | null;
    reason?: 'not-found' | 'already-global' | 'ok';
}
interface PromoteOpts {
    applies_to?: string[];
    project_name?: string;
}
export declare function promoteLesson(id: string, projectRoot: string, opts?: PromoteOpts): PromoteResult;
interface DemoteResult {
    demoted: boolean;
    reason?: 'not-found' | 'ok';
}
export declare function demoteLesson(id: string): DemoteResult;
export {};
//# sourceMappingURL=lessons-store.d.ts.map