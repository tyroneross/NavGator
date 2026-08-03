import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  loadRegistry,
  registerProject,
  updateProjectMeta,
  listProjects,
  pruneProjects,
} from '../projects.js';

let homeDir: string;
let prevHome: string | undefined;

beforeEach(() => {
  homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-projects-home-'));
  prevHome = process.env.HOME;
  process.env.HOME = homeDir;
});

afterEach(() => {
  process.env.HOME = prevHome;
  fs.rmSync(homeDir, { recursive: true, force: true });
});

describe('projects registry', () => {
  it('registerProject creates a new entry with scanCount 1', async () => {
    await registerProject('/repos/demo', { components: 3, connections: 2, prompts: 0 });
    const projects = await listProjects();
    const entry = projects.find((p) => p.path === '/repos/demo');
    expect(entry).toBeDefined();
    expect(entry?.scanCount).toBe(1);
  });

  it('updateProjectMeta preserves unknown fields on an existing entry', async () => {
    await registerProject('/repos/demo', { components: 3, connections: 2, prompts: 0 });

    await updateProjectMeta('/repos/demo', {
      origin: { kind: 'remote', url: 'https://github.com/example/demo' },
    });

    const registry = await loadRegistry();
    const entry = registry.projects.find((p) => p.path === '/repos/demo');
    expect(entry?.origin).toEqual({ kind: 'remote', url: 'https://github.com/example/demo' });
    // Fields set by registerProject before the patch must survive untouched.
    expect(entry?.scanCount).toBe(1);
    expect(entry?.stats).toEqual({ components: 3, connections: 2, prompts: 0 });
  });

  it('updateProjectMeta creates a new entry (with scanCount 0) when none exists yet', async () => {
    await updateProjectMeta('/repos/new-project', { portfolio: { root: '/repos' } });

    const registry = await loadRegistry();
    const entry = registry.projects.find((p) => p.path === '/repos/new-project');
    expect(entry).toBeDefined();
    expect(entry?.scanCount).toBe(0);
    expect(entry?.portfolio).toEqual({ root: '/repos' });
  });

  it('a second updateProjectMeta patch does not clobber a field set by a prior patch', async () => {
    await updateProjectMeta('/repos/demo', { origin: { kind: 'local' } });
    await updateProjectMeta('/repos/demo', { portfolio: { root: '/repos' } });

    const registry = await loadRegistry();
    const entry = registry.projects.find((p) => p.path === '/repos/demo');
    expect(entry?.origin).toEqual({ kind: 'local' });
    expect(entry?.portfolio).toEqual({ root: '/repos' });
  });

  // f1 closure proof (updateProjectMeta side): fired concurrently rather
  // than sequentially, each call must still see the previous call's
  // in-memory mutation rather than racing a shared pre-image read. Before
  // the withRegistryLock fix, concurrent load-mutate-save calls could each
  // load the same pre-image and the last save to land would drop whichever
  // field(s) the other call had set.
  it('concurrent updateProjectMeta calls on the same project do not lose fields', async () => {
    await Promise.all([
      updateProjectMeta('/repos/concurrent', { origin: { kind: 'local' } }),
      updateProjectMeta('/repos/concurrent', { portfolio: { root: '/repos' } }),
      updateProjectMeta('/repos/concurrent', { lastSignificance: 'minor' }),
    ]);

    const registry = await loadRegistry();
    const entry = registry.projects.find((p) => p.path === '/repos/concurrent');
    expect(entry).toBeDefined();
    expect(entry?.origin).toEqual({ kind: 'local' });
    expect(entry?.portfolio).toEqual({ root: '/repos' });
    expect(entry?.lastSignificance).toBe('minor');
  });

  // f1 closure proof (registerProject side): N concurrent registrations of
  // distinct projects must all land — this is the in-process shape of what
  // scanPortfolio's workers do (each finishes and calls registerProject on
  // its own repo path). Auditor measured 2 of 6 surviving before the fix.
  it('concurrent registerProject calls for distinct projects all register', async () => {
    const count = 6;
    await Promise.all(
      Array.from({ length: count }, (_, i) =>
        registerProject(`/repos/concurrent-${i}`, { components: 1, connections: 0, prompts: 0 })
      )
    );

    const registry = await loadRegistry();
    expect(registry.projects.length).toBe(count);
  });

  // C3: pruneProjects removes an explicit path list in one registry write,
  // rather than looping removeProject per path.
  it('pruneProjects removes exactly the given paths and leaves the rest untouched', async () => {
    await registerProject('/repos/keep-1', { components: 1, connections: 0, prompts: 0 });
    await registerProject('/repos/drop-1', { components: 1, connections: 0, prompts: 0 });
    await registerProject('/repos/drop-2', { components: 1, connections: 0, prompts: 0 });

    const { removed } = await pruneProjects(['/repos/drop-1', '/repos/drop-2']);
    expect(removed.map((p) => p.path).sort()).toEqual(['/repos/drop-1', '/repos/drop-2']);

    const registry = await loadRegistry();
    expect(registry.projects.map((p) => p.path)).toEqual(['/repos/keep-1']);
  });
});
