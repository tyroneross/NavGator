import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  loadRegistry,
  registerProject,
  updateProjectMeta,
  listProjects,
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
});
