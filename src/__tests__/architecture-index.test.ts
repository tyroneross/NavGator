/**
 * Contract tests for the committed architecture index.
 *
 * Two properties matter more than any individual number this generator emits:
 *
 *   1. DETERMINISM. The artifact is committed and reviewed in diffs. If it
 *      churned on every run, reviewers would learn to skip it and the gate
 *      would be worse than no gate. Every test here that regenerates twice is
 *      guarding that, and `no timestamp / no absolute path` is the specific
 *      failure mode that would break it silently on someone else's machine.
 *
 *   2. HONESTY. A scan that measured nothing must not grade as healthy. The
 *      coverage tests below assert that an unanalyzable tree reports `none`
 *      or `partial` with a named blind spot, never a clean `full`.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  ARCHITECTURE_INDEX_PATH,
  ARCHITECTURE_MD_PATH,
  autoModuleId,
  buildArchitectureIndex,
  stableStringify,
  writeArchitectureIndex,
} from '../architecture-index.js';

let fixture: string;

function write(relative: string, content: string): void {
  const absolute = path.join(fixture, relative);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, content, 'utf-8');
}

beforeAll(() => {
  fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-arch-index-'));

  write('src/types.ts', 'export interface Thing { id: string }\n');
  write('src/config.ts', "import type { Thing } from './types.js';\nexport const c: Thing = { id: 'a' };\n");
  write('src/scanner.ts', "import { c } from './config.js';\nimport type { Thing } from './types.js';\nexport const s = c;\n");
  write('src/cli/index.ts', "import { s } from '../scanner.js';\nexport const run = () => s;\n");
  write('src/scanners/one.ts', "import type { Thing } from '../types.js';\nexport type T = Thing;\n");
  // Not TypeScript/JavaScript: must show up as an UNANALYZED language.
  write('ios/App.swift', 'import SwiftUI\nstruct App {}\n');

  write(
    'docs/architecture/modules.json',
    JSON.stringify(
      {
        modules: [
          { id: 'src', path: 'src', responsibility: 'Core library.' },
          { id: 'src/cli', path: 'src/cli', responsibility: 'Command line.' },
        ],
        boundaries: [
          {
            id: 'core-not-cli',
            from: 'src',
            must_not_depend_on: ['src/cli'],
            why: 'The library must not import its own CLI.',
          },
        ],
      },
      null,
      2
    )
  );
});

afterAll(() => {
  if (fixture) fs.rmSync(fixture, { recursive: true, force: true });
});

describe('architecture index — determinism', () => {
  it('produces byte-identical output across two runs on an unchanged tree', async () => {
    const first = await buildArchitectureIndex(fixture);
    const second = await buildArchitectureIndex(fixture);

    expect(second.markdown).toBe(first.markdown);
    expect(stableStringify(second.index)).toBe(stableStringify(first.index));
  });

  it('writes on the first pass and reports zero changes on the second', async () => {
    const first = await writeArchitectureIndex(fixture);
    expect(first.changed.sort()).toEqual([ARCHITECTURE_MD_PATH, ARCHITECTURE_INDEX_PATH].sort());

    const beforeBytes = fs.readFileSync(path.join(fixture, ARCHITECTURE_INDEX_PATH));
    const second = await writeArchitectureIndex(fixture);
    const afterBytes = fs.readFileSync(path.join(fixture, ARCHITECTURE_INDEX_PATH));

    // `changed: []` is the exact signal the CI gate depends on.
    expect(second.changed).toEqual([]);
    expect(afterBytes.equals(beforeBytes)).toBe(true);
  });

  it('embeds no timestamp, absolute path, or other machine-specific value', async () => {
    const { index, markdown } = await buildArchitectureIndex(fixture);
    const serialized = `${markdown}\n${stableStringify(index)}`;

    // The fixture lives under the OS temp dir, so its own path leaking in is
    // the realistic form of this bug.
    expect(serialized).not.toContain(fixture);
    expect(serialized).not.toMatch(/\/(Users|home)\//);
    // ISO-8601 timestamps and millisecond epochs.
    expect(serialized).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
    expect(serialized).not.toMatch(/\b1[6-9]\d{11}\b/);
  });

  it('sorts JSON keys so an unrelated code reorder cannot change the artifact', () => {
    const a = stableStringify({ b: 1, a: { d: 2, c: 3 } });
    const b = stableStringify({ a: { c: 3, d: 2 }, b: 1 });
    expect(a).toBe(b);
    expect(a.endsWith('\n')).toBe(true);
  });
});

describe('architecture index — honesty about what it could not see', () => {
  it('names an unanalyzed language as a blind spot instead of reporting full coverage', async () => {
    const { index } = await buildArchitectureIndex(fixture);

    const swift = index.coverage.languages.find(l => l.language === 'Swift');
    expect(swift).toBeDefined();
    expect(swift!.analyzed).toBe(false);
    expect(swift!.files).toBe(1);

    expect(index.coverage.status).toBe('partial');
    expect(index.coverage.blind_spots.some(s => s.includes('Swift') && s.includes('NOT analyzed'))).toBe(true);
  });

  it('grades a tree with no measurable edges as `none`, never as a clean result', async () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-arch-empty-'));
    try {
      // Swift only: NavGator emits no internal component edges for Swift, so
      // this is the exact shape that must not read as a decoupled codebase.
      fs.mkdirSync(path.join(empty, 'Sources'), { recursive: true });
      fs.writeFileSync(path.join(empty, 'Sources', 'A.swift'), 'struct A {}\n');

      const { index, markdown } = await buildArchitectureIndex(empty);
      expect(index.coverage.internal_edges).toBe(0);
      expect(index.coverage.status).toBe('none');
      expect(markdown).toContain('Coverage: NONE');
      expect(markdown).toContain('unmeasured');
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });
});

describe('architecture index — the four session questions', () => {
  it('answers "what are the components" with curated responsibilities', async () => {
    const { index } = await buildArchitectureIndex(fixture);
    const core = index.modules.find(m => m.id === 'src');
    expect(core?.responsibility).toBe('Core library.');
    expect(core?.curated).toBe(true);
  });

  it('answers "what depends on what" at module altitude', async () => {
    const { index } = await buildArchitectureIndex(fixture);
    expect(index.module_edges).toContainEqual({ from: 'src/cli', to: 'src', edges: 1 });
  });

  it('answers "if I change X, what else is affected" per file', async () => {
    const { index } = await buildArchitectureIndex(fixture);
    const types = index.files['src/types.ts'];
    expect(types.imported_by).toEqual([
      'src/config.ts',
      'src/scanner.ts',
      'src/scanners/one.ts',
    ]);
    expect(index.hotspots[0]).toEqual({ file: 'src/types.ts', module: 'src', dependents: 3 });
  });

  it('answers "which boundaries must I not cross" and re-checks each one', async () => {
    const { index } = await buildArchitectureIndex(fixture);
    const rule = index.boundaries.find(b => b.id === 'core-not-cli');
    expect(rule?.status).toBe('held');
    expect(rule?.violations).toEqual([]);
  });

  it('reports a boundary violation with the exact importing file', async () => {
    const violating = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-arch-violation-'));
    try {
      fs.mkdirSync(path.join(violating, 'src', 'cli'), { recursive: true });
      fs.writeFileSync(path.join(violating, 'src', 'cli', 'index.ts'), 'export const run = () => 1;\n');
      fs.writeFileSync(
        path.join(violating, 'src', 'core.ts'),
        "import { run } from './cli/index.js';\nexport const c = run;\n"
      );
      fs.mkdirSync(path.join(violating, 'docs', 'architecture'), { recursive: true });
      fs.writeFileSync(
        path.join(violating, 'docs', 'architecture', 'modules.json'),
        JSON.stringify({
          modules: [
            { id: 'src', path: 'src', responsibility: 'Core.' },
            { id: 'src/cli', path: 'src/cli', responsibility: 'CLI.' },
          ],
          boundaries: [
            { id: 'core-not-cli', from: 'src', must_not_depend_on: ['src/cli'], why: 'Layering.' },
          ],
        })
      );

      const { index, markdown } = await buildArchitectureIndex(violating);
      const rule = index.boundaries.find(b => b.id === 'core-not-cli');
      expect(rule?.status).toBe('violated');
      expect(rule?.violations).toEqual([
        { from_file: 'src/core.ts', to_file: 'src/cli/index.ts', to_module: 'src/cli' },
      ]);
      expect(markdown).toContain('**VIOLATED (1)**');
    } finally {
      fs.rmSync(violating, { recursive: true, force: true });
    }
  });
});

describe('architecture index — module assignment', () => {
  it('derives a module id from path segments when nobody has curated one', () => {
    expect(autoModuleId('vitest.config.ts')).toBe('.');
    expect(autoModuleId('scripts/build.mjs')).toBe('scripts');
    expect(autoModuleId('src/cli/commands/scan.ts')).toBe('src/cli');
  });

  it('assigns a file to the longest matching curated prefix', async () => {
    const { index } = await buildArchitectureIndex(fixture);
    // `src/cli` is longer than `src`, so the CLI file belongs to the CLI.
    expect(index.files['src/cli/index.ts'].module).toBe('src/cli');
    expect(index.files['src/scanner.ts'].module).toBe('src');
    // Absorption is intentional and load-bearing: a curated `src` claims its
    // whole subtree, so `src/scanners/` collapses into `src` until somebody
    // curates it separately. Splitting a module is therefore a modules.json
    // edit, not a code change.
    expect(index.files['src/scanners/one.ts'].module).toBe('src');
    expect(index.modules.find(m => m.id === 'src/scanners')).toBeUndefined();
  });

  it('flags a directory nobody has curated rather than hiding it', async () => {
    const uncurated = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-arch-uncurated-'));
    try {
      fs.mkdirSync(path.join(uncurated, 'src'), { recursive: true });
      fs.writeFileSync(path.join(uncurated, 'src', 'a.ts'), "export const a = 1;\n");
      fs.mkdirSync(path.join(uncurated, 'tools'), { recursive: true });
      fs.writeFileSync(path.join(uncurated, 'tools', 'b.ts'), "import { a } from '../src/a.js';\nexport const b = a;\n");

      const { index, markdown } = await buildArchitectureIndex(uncurated);
      const tools = index.modules.find(m => m.id === 'tools');
      expect(tools?.curated).toBe(false);
      expect(tools?.responsibility).toBeNull();
      expect(markdown).toContain('uncurated');
    } finally {
      fs.rmSync(uncurated, { recursive: true, force: true });
    }
  });
});
