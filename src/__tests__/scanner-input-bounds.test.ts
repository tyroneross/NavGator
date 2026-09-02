/**
 * SEC-012 — scanner input bounds against untrusted trees.
 *
 * `navgator scan-remote <url>` clones a repository whose contents the scanned
 * repo controls, so scanner input is untrusted by construction. `ES_IMPORT_RE`
 * in the import scanner used an unbounded `[\s\S]*?` between `import` and
 * `from`; combined with the preceding `\s+`, one line of `import` plus N
 * spaces drove polynomial backtracking. Measured before this fix, on a single
 * line, whole-file input with no cap applied:
 *
 *     2,000 spaces →  1,410 ms
 *     4,000 spaces → 10,897 ms
 *     8,000 spaces → 88,222 ms
 *
 * Two independent bounds now apply: the quantifier is capped at 4,096, and
 * `capLongLines` blanks any line longer than 4,096 characters before a regex
 * sees it. The timing assertion below is the regression guard — remove either
 * bound and the 8,000-space case returns to tens of seconds, well past the
 * ceiling asserted here.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { scanImports } from '../scanners/connections/import-scanner.js';
import { MAX_FILE_SIZE_BYTES, MAX_LINE_LENGTH, capLongLines } from '../scanners/scan-limits.js';

let root: string;

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-scan-bounds-'));
});

afterAll(() => {
  if (root) fs.rmSync(root, { recursive: true, force: true });
});

describe('capLongLines', () => {
  it('blanks over-long lines while preserving the line count', () => {
    const content = ['short', 'x'.repeat(MAX_LINE_LENGTH + 1), 'also short'].join('\n');
    const capped = capLongLines(content);
    const lines = capped.split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe('short');
    expect(lines[1]).toBe('');
    expect(lines[2]).toBe('also short');
  });

  it('returns short content untouched', () => {
    const content = "import { a } from './a.js';\n";
    expect(capLongLines(content)).toBe(content);
  });
});

describe('import scanner input bounds', () => {
  it('completes quickly on the measured ReDoS input (8,000-space import line)', async () => {
    const dir = path.join(root, 'redos');
    fs.mkdirSync(dir, { recursive: true });
    // The exact shape that measured 88 seconds: one line, `import`, a long
    // whitespace run, and no closing quote to match.
    fs.writeFileSync(path.join(dir, 'hostile.ts'), `import${' '.repeat(8000)}`, 'utf-8');

    const started = Date.now();
    await scanImports(dir, ['hostile.ts']);
    const elapsed = Date.now() - started;

    // 88,222 ms before the fix. A 5-second ceiling is ~17x headroom over a
    // slow CI runner while still convicting any regression by two orders of
    // magnitude.
    expect(elapsed).toBeLessThan(5000);
  }, 20_000);

  it('skips a file larger than the size cap instead of parsing it', async () => {
    const dir = path.join(root, 'oversize');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'target.ts'), 'export const t = 1;\n', 'utf-8');
    // Over the cap, and it does contain a real import that would otherwise
    // produce an edge — so the absence of that edge proves the skip happened.
    const filler = `// ${'p'.repeat(120)}\n`.repeat(Math.ceil(MAX_FILE_SIZE_BYTES / 124) + 20);
    fs.writeFileSync(path.join(dir, 'huge.ts'), `import { t } from './target.js';\n${filler}`, 'utf-8');
    expect(fs.statSync(path.join(dir, 'huge.ts')).size).toBeGreaterThan(MAX_FILE_SIZE_BYTES);

    const result = await scanImports(dir, ['huge.ts', 'target.ts']);
    const edges = result.connections.filter(c => c.connection_type === 'imports');
    expect(edges).toHaveLength(0);
  }, 20_000);

  it('still resolves a normal import, so the bounds did not disable the scanner', async () => {
    const dir = path.join(root, 'normal');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'target.ts'), 'export const t = 1;\n', 'utf-8');
    fs.writeFileSync(path.join(dir, 'source.ts'), "import { t } from './target.js';\nexport const s = t;\n", 'utf-8');

    const result = await scanImports(dir, ['source.ts', 'target.ts']);
    const edges = result.connections.filter(c => c.connection_type === 'imports');
    expect(edges).toHaveLength(1);
    expect(edges[0].from.location?.file).toBe('source.ts');
    expect(edges[0].to.location?.file).toBe('target.ts');
  });

  it('still resolves a long multi-line barrel import under the quantifier cap', async () => {
    const dir = path.join(root, 'barrel');
    fs.mkdirSync(dir, { recursive: true });
    const names = Array.from({ length: 120 }, (_, i) => `exportedName${i}`);
    fs.writeFileSync(
      path.join(dir, 'target.ts'),
      `${names.map(n => `export const ${n} = 1;`).join('\n')}\n`,
      'utf-8'
    );
    fs.writeFileSync(
      path.join(dir, 'source.ts'),
      `import {\n${names.map(n => `  ${n},`).join('\n')}\n} from './target.js';\nexport const s = exportedName0;\n`,
      'utf-8'
    );

    const result = await scanImports(dir, ['source.ts', 'target.ts']);
    const edges = result.connections.filter(c => c.connection_type === 'imports');
    expect(edges).toHaveLength(1);
  });
});
