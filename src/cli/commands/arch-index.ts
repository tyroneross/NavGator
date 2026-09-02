/**
 * `navgator arch-index [--write] [--check] [--json] [--agent]` — generate the
 * committed, version-controlled architecture index.
 *
 * Unlike every other NavGator command, this one does NOT read
 * `.navgator/architecture/`. That store is a per-clone cache: gitignored,
 * timestamped, machine-specific. This command scans the tree directly so it
 * produces the same bytes on a developer laptop and on a clean CI checkout,
 * which is what makes `--check` a usable merge gate.
 *
 * Outputs (both committed):
 *   ARCHITECTURE.md              — answer-first entry point for a cold agent
 *   docs/architecture/index.json — machine-readable, per-file blast radius
 *
 * Exit codes follow src/cli/exit-codes.ts. `--check` exits NO_DATA (2) when
 * the committed copy is stale, which is a "regenerate and commit" signal, not
 * an internal error.
 */
import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import {
  ARCHITECTURE_INDEX_PATH,
  ARCHITECTURE_MD_PATH,
  buildArchitectureIndex,
  stableStringify,
  writeArchitectureIndex,
} from '../../architecture-index.js';
import { wrapInEnvelope } from '../../agent-output.js';
import { EXIT_CODES } from '../exit-codes.js';

interface ArchIndexOptions {
  write?: boolean;
  check?: boolean;
  json?: boolean;
  agent?: boolean;
}

export function registerArchIndexCommand(program: Command): void {
  program
    .command('arch-index')
    .description('Generate the committed architecture index (ARCHITECTURE.md + docs/architecture/index.json)')
    .option('--write', 'Write the artifacts to disk')
    .option('--check', 'Exit 2 if the committed artifacts are stale (CI gate)')
    .option('--json', 'Output as JSON')
    .option('--agent', 'Output wrapped in agent envelope (implies --json)')
    .action(async (options: ArchIndexOptions) => {
      try {
        if (options.write && options.check) {
          console.error('--write and --check are mutually exclusive.');
          process.exitCode = EXIT_CODES.USAGE;
          return;
        }

        const root = process.cwd();

        if (options.write) {
          const { changed, index } = await writeArchitectureIndex(root);
          const payload = {
            changed,
            coverage: index.coverage.status,
            analyzed_files: index.coverage.analyzed_files,
            internal_edges: index.coverage.internal_edges,
            modules: index.modules.length,
            uncurated_modules: index.modules.filter(m => !m.curated).length,
            violated_boundaries: index.boundaries.filter(b => b.status === 'violated').length,
          };
          if (options.agent) {
            console.log(wrapInEnvelope('arch-index', payload));
            return;
          }
          if (options.json) {
            console.log(JSON.stringify(payload, null, 2));
            return;
          }
          console.log(
            changed.length === 0
              ? 'Architecture index already up to date.'
              : `Architecture index updated: ${changed.join(', ')}`
          );
          console.log(
            `  coverage=${payload.coverage} files=${payload.analyzed_files} ` +
            `edges=${payload.internal_edges} modules=${payload.modules} ` +
            `uncurated=${payload.uncurated_modules} boundary-violations=${payload.violated_boundaries}`
          );
          return;
        }

        const { index, markdown } = await buildArchitectureIndex(root);

        if (options.check) {
          const stale: string[] = [];
          const expected: Array<[string, string]> = [
            [ARCHITECTURE_MD_PATH, markdown],
            [ARCHITECTURE_INDEX_PATH, stableStringify(index)],
          ];
          for (const [relative, content] of expected) {
            const absolute = path.join(root, relative);
            const actual = fs.existsSync(absolute) ? fs.readFileSync(absolute, 'utf-8') : null;
            if (actual !== content) stale.push(relative);
          }

          const payload = { stale, up_to_date: stale.length === 0 };
          if (options.agent) {
            console.log(wrapInEnvelope('arch-index', payload));
          } else if (options.json) {
            console.log(JSON.stringify(payload, null, 2));
          } else if (stale.length === 0) {
            console.log('Architecture index is up to date.');
          } else {
            console.error(
              `Architecture index is stale: ${stale.join(', ')}\n` +
              'Run `npm run architecture` and commit the result.'
            );
          }
          if (stale.length > 0) process.exitCode = EXIT_CODES.NO_DATA;
          return;
        }

        if (options.agent) {
          console.log(wrapInEnvelope('arch-index', index));
          return;
        }
        if (options.json) {
          console.log(stableStringify(index).trimEnd());
          return;
        }
        console.log(markdown);
      } catch (error) {
        console.error(`arch-index failed: ${error instanceof Error ? error.message : String(error)}`);
        process.exitCode = EXIT_CODES.OPERATIONAL;
      }
    });
}
