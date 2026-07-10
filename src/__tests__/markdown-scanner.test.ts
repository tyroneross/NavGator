import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { scanMarkdownContent } from '../scanners/content/markdown-scanner.js';

let root: string;

function write(relPath: string, content: string): void {
  const target = path.join(root, relPath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, 'utf-8');
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-markdown-'));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('scanMarkdownContent', () => {
  it('maps documents, wikilinks, Markdown links, aliases, and typed relationships', async () => {
    write('wiki/a.md', [
      '---',
      'id: page-a',
      'title: "Page A, with context"',
      'aliases: [alpha]',
      'related:',
      '  - page-b',
      '---',
      '# Page A',
      'See [[page-b]] and [Page B](b.md).',
      '`[[ignored-inline]]`',
      '```md',
      '[[ignored-fence]]',
      '```',
      '[External](https://example.com).',
      '![Diagram](diagram.png)',
      '![[screenshot.jpg]]',
      '[Script](../tools/check.py)',
    ].join('\n'));
    write('wiki/b.md', '---\nid: page-b\n---\n# Page B\n');
    write('wiki/c.md', '---\nid: page-c\n---\n# Page C\nSee [[alpha]].\n');
    write('wiki/broken.md', '---\nid: broken\n---\n# Broken\nSee [[missing-page]].\n');

    const result = await scanMarkdownContent(root, [
      'wiki/a.md',
      'wiki/b.md',
      'wiki/c.md',
      'wiki/broken.md',
    ]);

    expect(result.components).toHaveLength(4);
    expect(result.components.every(component => component.type === 'document')).toBe(true);
    expect(result.components.every(component => component.role.layer === 'content')).toBe(true);
    expect(result.components.find(component => component.name === 'page-a')?.metadata?.title)
      .toBe('Page A, with context');

    const byType = result.connections.reduce<Record<string, number>>((counts, connection) => {
      counts[connection.connection_type] = (counts[connection.connection_type] ?? 0) + 1;
      return counts;
    }, {});
    expect(byType).toEqual({
      'typed-relationship': 1,
      wikilink: 2,
      'markdown-link': 1,
    });
    expect(result.connections.some(connection => connection.description?.includes('page-c links to page-a')))
      .toBe(true);

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatchObject({
      type: 'unresolved_link',
      file: 'wiki/broken.md',
      line: 5,
    });
    expect(result.warnings[0].message).toContain('missing-page');
    expect(result.warnings[0].message).not.toContain('ignored-inline');
  });

  it('returns all target components but limits link origins to an incremental walk set', async () => {
    write('a.md', '---\nid: a\n---\n[[b]]\n');
    write('b.md', '---\nid: b\n---\n[[a]]\n');

    const result = await scanMarkdownContent(root, ['a.md', 'b.md'], new Set(['a.md']));

    expect(result.components).toHaveLength(2);
    expect(result.connections).toHaveLength(1);
    expect(result.connections[0].description).toBe('a links to b');
  });

  it('resolves nested relative Markdown paths without using the process working directory', async () => {
    write('docs/guide/start.md', '[Next](../reference/next.md)\n');
    write('docs/reference/next.md', '# Next\n');

    const result = await scanMarkdownContent(root, [
      'docs/guide/start.md',
      'docs/reference/next.md',
    ]);

    expect(result.connections).toHaveLength(1);
    expect(result.connections[0].connection_type).toBe('markdown-link');
    expect(result.connections[0].to.location?.file).toBe('docs/reference/next.md');
  });

  it('prefers a frontmatter id over a colliding filename fallback', async () => {
    write('canonical.md', '---\nid: target-page\n---\n# Canonical\n');
    write('target-page.md', '');
    write('source.md', '---\nid: source\n---\n[[target-page]]\n');

    const result = await scanMarkdownContent(root, [
      'canonical.md',
      'target-page.md',
      'source.md',
    ]);

    expect(result.warnings).toHaveLength(0);
    expect(result.connections).toHaveLength(1);
    expect(result.connections[0].to.location?.file).toBe('canonical.md');
    expect(new Set(result.components.map(component => component.stable_id)).size).toBe(3);
  });
});
