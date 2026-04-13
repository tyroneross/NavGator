/**
 * NavGator `lessons` subcommand — local + global architectural lessons store.
 */

import { Command } from 'commander';
import * as path from 'path';
import {
  ensureGlobalLessonsFile,
  listLessons,
  searchLessons,
  findLessonById,
  promoteLesson,
  demoteLesson,
  type Lesson,
  type GlobalLesson,
  type LessonCategory,
  type Severity,
} from '../../lessons-store.js';
import { wrapInEnvelope } from '../../agent-output.js';

// =============================================================================
// HELPERS
// =============================================================================

function isAgentMode(options: { agent?: boolean; json?: boolean }): boolean {
  return Boolean(options.agent) || process.env.NAVGATOR_AGENT === '1';
}

function wantsJson(options: { agent?: boolean; json?: boolean }): boolean {
  return Boolean(options.json) || isAgentMode(options);
}

function emit(
  command: string,
  data: unknown,
  options: { agent?: boolean; json?: boolean },
): boolean {
  if (isAgentMode(options)) {
    console.log(wrapInEnvelope(command, data));
    return true;
  }
  if (options.json) {
    console.log(JSON.stringify(data, null, 2));
    return true;
  }
  return false;
}

function collect(value: string, previous: string[] = []): string[] {
  return previous.concat([value]);
}

function formatLessonSummary(l: Lesson | GlobalLesson): string {
  const tags = (l as GlobalLesson).applies_to;
  const source = (l as GlobalLesson).source_project;
  const promotedMarker = (l as Lesson).promoted ? ' [promoted]' : '';
  const sourceStr = source ? ` [from: ${source}]` : '';
  const tagStr = tags && tags.length > 0 ? ` {${tags.join(', ')}}` : '';
  const pat = l.pattern.length > 80 ? l.pattern.slice(0, 77) + '...' : l.pattern;
  return `  ${l.id.padEnd(40)} ${l.severity.padEnd(9)} ${l.category.padEnd(24)} ${pat}${tagStr}${sourceStr}${promotedMarker}`;
}

function printTable(title: string, lessons: (Lesson | GlobalLesson)[]): void {
  console.log(title);
  console.log('─'.repeat(Math.min(title.length, 60)));
  if (lessons.length === 0) {
    console.log('  (none)');
    return;
  }
  console.log(
    `  ${'ID'.padEnd(40)} ${'SEVERITY'.padEnd(9)} ${'CATEGORY'.padEnd(24)} PATTERN`,
  );
  for (const l of lessons) console.log(formatLessonSummary(l));
}

function printLessonDetail(l: Lesson | GlobalLesson): void {
  console.log(`ID:        ${l.id}`);
  console.log(`Category:  ${l.category}`);
  console.log(`Severity:  ${l.severity}`);
  console.log(`Pattern:   ${l.pattern}`);
  if (l.signature && l.signature.length > 0) {
    console.log(`Signature: ${l.signature.join(' | ')}`);
  }
  const g = l as GlobalLesson;
  if (g.source_project) console.log(`Source:    ${g.source_project}`);
  if (g.applies_to && g.applies_to.length > 0) {
    console.log(`Tags:      ${g.applies_to.join(', ')}`);
  }
  if (g.promoted_at) console.log(`Promoted:  ${g.promoted_at}`);
  if (g.promoted_from) console.log(`From:      ${g.promoted_from}`);
  if ((l as Lesson).promoted) console.log(`Promoted:  true (local)`);
  if (l.context) {
    console.log('Context:');
    if (l.context.first_seen) console.log(`  first_seen: ${l.context.first_seen}`);
    if (l.context.last_seen) console.log(`  last_seen:  ${l.context.last_seen}`);
    if (typeof l.context.occurrences === 'number') {
      console.log(`  occurrences: ${l.context.occurrences}`);
    }
    if (l.context.files_affected && l.context.files_affected.length > 0) {
      console.log(`  files: ${l.context.files_affected.join(', ')}`);
    }
    if (l.context.resolution) console.log(`  resolution: ${l.context.resolution}`);
  }
  if (l.example) {
    console.log('Example:');
    if (l.example.bad) console.log(`  bad:  ${l.example.bad}`);
    if (l.example.good) console.log(`  good: ${l.example.good}`);
    if (l.example.why) console.log(`  why:  ${l.example.why}`);
  }
}

// =============================================================================
// COMMAND
// =============================================================================

export function registerLessonsCommand(program: Command): void {
  const lessons = program
    .command('lessons')
    .description('Manage local and global architectural lessons');

  // ---- list --------------------------------------------------------------
  lessons
    .command('list')
    .description('List lessons (local by default)')
    .option('--global', 'List the global lessons store')
    .option('--all', 'List local + global lessons combined')
    .option('--json', 'Output as JSON')
    .option('--agent', 'Output wrapped in agent envelope (implies --json)')
    .action((options) => {
      try {
        ensureGlobalLessonsFile();
        const projectRoot = process.cwd();
        let data: (Lesson | GlobalLesson)[] = [];

        if (options.all) {
          const local = listLessons({ scope: 'local', projectRoot }) as Lesson[];
          const global = listLessons({ scope: 'global' }) as GlobalLesson[];
          data = [...local, ...global];
          if (!emit('lessons.list', { scope: 'all', lessons: data }, options)) {
            printTable(`Lessons (local: ${local.length}, global: ${global.length})`, data);
          }
          return;
        }

        if (options.global) {
          const global = listLessons({ scope: 'global' }) as GlobalLesson[];
          data = global;
          if (!emit('lessons.list', { scope: 'global', lessons: data }, options)) {
            printTable(`Global Lessons (${global.length})`, global);
          }
          return;
        }

        const local = listLessons({ scope: 'local', projectRoot }) as Lesson[];
        data = local;
        if (!emit('lessons.list', { scope: 'local', project: projectRoot, lessons: data }, options)) {
          printTable(`Local Lessons — ${path.basename(projectRoot)} (${local.length})`, local);
        }
      } catch (err) {
        console.error('lessons list failed:', err instanceof Error ? err.message : err);
        process.exit(1);
      }
    });

  // ---- show --------------------------------------------------------------
  lessons
    .command('show <id>')
    .description('Show full detail for a single lesson')
    .option('--scope <scope>', 'Scope to search (local | global | all)', 'all')
    .option('--json', 'Output as JSON')
    .option('--agent', 'Output wrapped in agent envelope (implies --json)')
    .action((id, options) => {
      try {
        ensureGlobalLessonsFile();
        const projectRoot = process.cwd();
        const scope = (options.scope || 'all') as 'local' | 'global' | 'all';
        let found: Lesson | GlobalLesson | null = null;
        if (scope === 'local' || scope === 'all') {
          found = findLessonById(id, { scope: 'local', projectRoot });
        }
        if (!found && (scope === 'global' || scope === 'all')) {
          found = findLessonById(id, { scope: 'global' });
        }
        if (!found) {
          if (wantsJson(options)) {
            emit('lessons.show', { id, found: false }, options);
          } else {
            console.log(`No lesson with id "${id}" in scope=${scope}`);
          }
          process.exitCode = 1;
          return;
        }
        if (!emit('lessons.show', found, options)) {
          printLessonDetail(found);
        }
      } catch (err) {
        console.error('lessons show failed:', err instanceof Error ? err.message : err);
        process.exit(1);
      }
    });

  // ---- search ------------------------------------------------------------
  lessons
    .command('search <query>')
    .description('Search lessons by regex against pattern, signature, examples, and resolution')
    .option('--scope <scope>', 'Scope (local | global | all)', 'all')
    .option('--category <cat>', 'Filter by category')
    .option('--severity <sev>', 'Filter by severity (critical | important | minor)')
    .option('--tag <tag>', 'Filter by applies_to tag (repeatable, global only)', collect, [] as string[])
    .option('--json', 'Output as JSON')
    .option('--agent', 'Output wrapped in agent envelope (implies --json)')
    .action((query, options) => {
      try {
        ensureGlobalLessonsFile();
        const projectRoot = process.cwd();
        const scope = (options.scope || 'all') as 'local' | 'global' | 'all';
        const results = searchLessons(query, {
          scope,
          projectRoot,
          category: options.category as LessonCategory | undefined,
          severity: options.severity as Severity | undefined,
          tags: options.tag && options.tag.length > 0 ? options.tag : undefined,
        });
        if (!emit('lessons.search', { query, scope, results }, options)) {
          printTable(`Search: /${query}/ in ${scope} (${results.length})`, results);
        }
      } catch (err) {
        console.error('lessons search failed:', err instanceof Error ? err.message : err);
        process.exit(1);
      }
    });

  // ---- promote -----------------------------------------------------------
  lessons
    .command('promote <id>')
    .description('Promote a local lesson to the global store (copy-then-mark)')
    .option('--tag <tag>', 'applies_to tag (repeatable)', collect, [] as string[])
    .option('--project-name <name>', 'Override auto-detected project name')
    .option('--json', 'Output as JSON')
    .option('--agent', 'Output wrapped in agent envelope (implies --json)')
    .action((id, options) => {
      try {
        ensureGlobalLessonsFile();
        const projectRoot = process.cwd();
        const result = promoteLesson(id, projectRoot, {
          applies_to: options.tag && options.tag.length > 0 ? options.tag : undefined,
          project_name: options.projectName,
        });
        if (!emit('lessons.promote', result, options)) {
          if (result.promoted) {
            console.log(`Promoted ${id} to global store.`);
            if (result.globalLesson?.applies_to?.length) {
              console.log(`  Tags: ${result.globalLesson.applies_to.join(', ')}`);
            }
          } else {
            console.log(`Not promoted: ${result.reason}`);
            process.exitCode = 1;
          }
        } else if (!result.promoted) {
          process.exitCode = 1;
        }
      } catch (err) {
        console.error('lessons promote failed:', err instanceof Error ? err.message : err);
        process.exit(1);
      }
    });

  // ---- demote ------------------------------------------------------------
  lessons
    .command('demote <id>')
    .description('Remove a lesson from the global store (idempotent; local is untouched)')
    .option('--keep-local', 'No-op flag — kept for symmetry; local is always preserved', true)
    .option('--json', 'Output as JSON')
    .option('--agent', 'Output wrapped in agent envelope (implies --json)')
    .action((id, options) => {
      try {
        ensureGlobalLessonsFile();
        const result = demoteLesson(id);
        if (!emit('lessons.demote', result, options)) {
          if (result.demoted) {
            console.log(`Demoted ${id} from global store.`);
          } else {
            console.log(`Not demoted: ${result.reason}`);
            process.exitCode = 1;
          }
        } else if (!result.demoted) {
          process.exitCode = 1;
        }
      } catch (err) {
        console.error('lessons demote failed:', err instanceof Error ? err.message : err);
        process.exit(1);
      }
    });
}
