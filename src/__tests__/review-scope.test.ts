import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, expect, it } from 'vitest';
import { collectReviewScope } from '../review-scope.js';
import { formatReviewReport } from '../review-report.js';
import { resetConfig } from '../config.js';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function root(): string {
  const result = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-review-scope-'));
  roots.push(result);
  return result;
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

it('inventories four Git surfaces and flags stale retrieval review', async () => {
  const dir = root();
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.name', 'Test');
  git(dir, 'config', 'user.email', 'test@example.com');
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'src/search.ts'), 'export const query = 1;\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-qm', 'initial');
  git(dir, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  fs.writeFileSync(path.join(dir, 'src/graph.ts'), 'export const edge = 1;\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-qm', 'graph');
  fs.writeFileSync(path.join(dir, 'src/search.ts'), 'export const query = 2;\n');
  fs.writeFileSync(path.join(dir, 'src/router.ts'), 'export const route = 1;\n');
  git(dir, 'add', 'src/router.ts');
  fs.writeFileSync(path.join(dir, 'src/query.ts'), 'export const query = 3;\n');
  const index = path.join(dir, '.navgator/architecture/index.json');
  fs.mkdirSync(path.dirname(index), { recursive: true });
  const now = Date.now();
  fs.writeFileSync(index, JSON.stringify({ last_scan: now - 48 * 3600000 }));

  const scope = await collectReviewScope(dir, now);
  expect(scope.available).toBe(true);
  expect(scope.counts).toEqual({ committed: 1, staged: 1, unstaged: 1, untracked: 2, total: 5 });
  expect(scope.scan.status).toBe('stale');
  expect(scope.behavioral_review.required).toBe(true);
  expect(scope.behavioral_review.sample).toContain('src/search.ts');
  expect(scope.behavioral_review.sample).toContain('src/query.ts');
  expect(scope.branch_base_known).toBe(true);
  const text = formatReviewReport({ violations: [], runtime_topology: {}, review_scope: scope });
  expect(text).toContain('Live change scope: 5 files');
  expect(text).toContain('Architecture scan: stale');
  expect(text).toContain('Functional validation needed:');
  const focused = await collectReviewScope(dir, now, 'src');
  expect(focused.counts.total).toBe(4);
  expect(focused.outside_scope).toBe(1);
  expect(focused.scope_prefix).toBe('src');
});

it('reports unavailable Git coverage without claiming a clean review', async () => {
  const dir = root();
  const scope = await collectReviewScope(dir);
  expect(scope.available).toBe(false);
  expect(scope.reason).toBe('not_git_repository');
  expect(scope.scan.status).toBe('missing');
  const text = formatReviewReport({ violations: [], runtime_topology: {}, review_scope: scope });
  expect(text).toContain('Live change scope: unavailable (not_git_repository)');
  expect(text).toContain('Architecture scan: missing');
});

it('reads scan freshness from the configured storage path', async () => {
  const dir = root();
  const oldPath = process.env.NAVGATOR_PATH;
  process.env.NAVGATOR_PATH = 'custom/architecture';
  resetConfig();
  try {
    const index = path.join(dir, 'custom/architecture/index.json');
    fs.mkdirSync(path.dirname(index), { recursive: true });
    const now = Date.now();
    fs.writeFileSync(index, JSON.stringify({ last_scan: now }));
    const scope = await collectReviewScope(dir, now);
    expect(scope.scan.status).toBe('fresh');
  } finally {
    if (oldPath === undefined) delete process.env.NAVGATOR_PATH;
    else process.env.NAVGATOR_PATH = oldPath;
    resetConfig();
  }
});
