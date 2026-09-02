/**
 * Guard tests for `checkDataAvailability()`'s upward walk.
 *
 * The defect these exist to prevent: a repository that has never been scanned
 * silently adopts an ancestor `.navgator/` (in practice, a home-directory-wide
 * index) and answers every read command from the wrong graph. ~15 commands
 * share this helper, so the blast radius is the whole read surface.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { checkDataAvailability } from '../cli/commands/helpers.js';

let tmp: string;
let originalCwd: string;

function seedGraph(dir: string): void {
  const arch = path.join(dir, '.navgator', 'architecture');
  fs.mkdirSync(arch, { recursive: true });
  fs.writeFileSync(path.join(arch, 'index.json'), JSON.stringify({ stats: {} }));
}

beforeEach(() => {
  originalCwd = process.cwd();
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-boundary-')));
});

afterEach(() => {
  process.chdir(originalCwd);
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('checkDataAvailability upward walk', () => {
  it('refuses an ancestor graph that lies outside the current repository', () => {
    // outer/ has a graph; outer/repo is a separate, unscanned git repo.
    seedGraph(tmp);
    const repo = path.join(tmp, 'repo');
    fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
    fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
    process.chdir(path.join(repo, 'src'));

    const warning = checkDataAvailability();

    expect(warning).toBeTruthy();
    expect(warning).toContain('navgator scan');
    // and it must not have silently retargeted us at the ancestor graph
    expect(fs.realpathSync(process.cwd()).startsWith(repo)).toBe(true);
  });

  it('refuses the home-directory index for a project living under it', () => {
    const home = fs.realpathSync(os.homedir());
    seedGraph(home);
    const project = path.join(home, `navgator-boundary-${process.pid}`);
    fs.mkdirSync(project, { recursive: true });
    try {
      process.chdir(project);
      const warning = checkDataAvailability();
      expect(warning).toBeTruthy();
      expect(fs.realpathSync(process.cwd())).toBe(fs.realpathSync(project));
    } finally {
      process.chdir(originalCwd);
      fs.rmSync(project, { recursive: true, force: true });
      fs.rmSync(path.join(home, '.navgator', 'architecture'), { recursive: true, force: true });
    }
  });

  it('still adopts the project root from a subdirectory of the same repo', () => {
    const repo = path.join(tmp, 'repo');
    fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
    seedGraph(repo);
    const sub = path.join(repo, 'src', 'deep');
    fs.mkdirSync(sub, { recursive: true });
    process.chdir(sub);

    const warning = checkDataAvailability();

    expect(warning).toBeNull();
    expect(fs.realpathSync(process.cwd())).toBe(fs.realpathSync(repo));
  });

  it('returns data-available when the graph is in the cwd itself', () => {
    const repo = path.join(tmp, 'repo');
    fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
    seedGraph(repo);
    process.chdir(repo);

    expect(checkDataAvailability()).toBeNull();
  });
});
