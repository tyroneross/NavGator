/**
 * Portfolio remote-origin exclusion — shared helper + CLI seam.
 *
 * `src/__tests__/mcp-portfolio-guard.test.ts` covers this property at the MCP
 * seam. When the MCP server was demoted to opt-in and `navgator <cmd> --agent`
 * became the default agent surface, the exclusion existed ONLY in the MCP
 * handler: the CLI's no-`dir` fan-out called `listProjects()` unfiltered, so a
 * `scan-remote` clone's attacker-authored component names, descriptions, and
 * prompt strings reached an agent envelope unmarked on the path that had just
 * been promoted to default.
 *
 * Both exclusion routes are covered independently:
 *  1. `origin.kind === 'remote'` at an ordinary path (the marker route), and
 *  2. an UNMARKED project whose path is under the remote-scan cache root.
 *
 * (2) is the fail-open case the double check exists for — scan() registers the
 * clone itself and `recordRemoteOrigin` patches `origin` in afterwards while
 * swallowing every error, so an interrupted run leaves an unmarked remote clone
 * registered. A test that only covered (1) would still pass with the path check
 * deleted.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Command } from 'commander';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { registerPortfolioCommand } from '../cli/commands/portfolio.js';
import { excludeRemoteOriginProjects, formatRemoteExclusionNote } from '../portfolio/scan.js';
import { registerProject } from '../projects.js';
import { resetConfig, setConfig } from '../config.js';
import { defaultCacheRoot } from '../remote/clone.js';

let homeDir: string;
let prevHome: string | undefined;

beforeEach(() => {
  homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-portfolio-filter-home-'));
  prevHome = process.env.HOME;
  process.env.HOME = homeDir;
  resetConfig();
  setConfig({ storageMode: 'local' });
});

afterEach(() => {
  process.env.HOME = prevHome;
  resetConfig();
  process.exitCode = undefined;
  fs.rmSync(homeDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

/** Register a project exactly the way `scan()` does — no origin field at all. */
async function registerUnmarked(dir: string): Promise<string> {
  fs.mkdirSync(dir, { recursive: true });
  await registerProject(dir);
  return dir;
}

/**
 * Register, then patch `origin` in afterwards — the same two-step
 * `scan()` -> `recordRemoteOrigin()` sequence the real remote-scan path uses.
 */
async function registerMarkedRemote(dir: string): Promise<string> {
  await registerUnmarked(dir);
  const registryPath = path.join(homeDir, '.navgator', 'projects.json');
  const registry = JSON.parse(fs.readFileSync(registryPath, 'utf-8'));
  for (const p of registry.projects) {
    if (p.path === dir) p.origin = { kind: 'remote', url: 'https://github.com/attacker/evil-repo' };
  }
  fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2));
  return dir;
}

/** Run `navgator portfolio` with the given flags and capture stdout. */
async function runPortfolio(...flags: string[]): Promise<string> {
  const lines: string[] = [];
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    lines.push(args.map(String).join(' '));
  });
  const errors: string[] = [];
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    errors.push(args.map(String).join(' '));
  });

  const program = new Command();
  program.exitOverride();
  registerPortfolioCommand(program);
  await program.parseAsync(['node', 'navgator', 'portfolio', ...flags]);

  expect(errors, `portfolio errored: ${errors.join('\n')}`).toEqual([]);
  return lines.join('\n');
}

// =============================================================================
// SHARED HELPER — both exclusion routes, independently
// =============================================================================

describe('excludeRemoteOriginProjects — the one implementation', () => {
  it('excludes a project marked origin.kind === "remote" at an ordinary path', () => {
    const marked = { path: path.join(homeDir, 'looks-local'), origin: { kind: 'remote' } };
    const local = { path: path.join(homeDir, 'keeper') };

    const { local: kept, skippedRemote } = excludeRemoteOriginProjects([marked, local]);

    expect(kept).toEqual([local]);
    expect(skippedRemote).toBe(1);
  });

  it('excludes an UNMARKED project whose path is under the cache root (fail-open route)', () => {
    const unmarkedClone = { path: path.join(defaultCacheRoot(), 'attacker', 'evil-repo') };
    const local = { path: path.join(homeDir, 'keeper') };

    const { local: kept, skippedRemote } = excludeRemoteOriginProjects([unmarkedClone, local]);

    expect(kept).toEqual([local]);
    expect(skippedRemote).toBe(1);
  });

  it('excludes the cache root itself, not only paths beneath it', () => {
    const { local: kept, skippedRemote } = excludeRemoteOriginProjects([
      { path: defaultCacheRoot() },
    ]);

    expect(kept).toEqual([]);
    expect(skippedRemote).toBe(1);
  });

  it('does not exclude a sibling directory that merely shares the cache-root prefix', () => {
    const lookalike = { path: `${defaultCacheRoot()}-backup` };

    const { local: kept, skippedRemote } = excludeRemoteOriginProjects([lookalike]);

    expect(kept).toEqual([lookalike]);
    expect(skippedRemote).toBe(0);
  });

  it('keeps genuine local projects and reports zero skipped', () => {
    const projects = [{ path: path.join(homeDir, 'a') }, { path: path.join(homeDir, 'b') }];

    const { local: kept, skippedRemote } = excludeRemoteOriginProjects(projects);

    expect(kept).toEqual(projects);
    expect(skippedRemote).toBe(0);
    expect(formatRemoteExclusionNote(skippedRemote)).toBeNull();
  });
});

// =============================================================================
// CLI SEAM — `navgator portfolio` with no dir
// =============================================================================

describe('navgator portfolio (no dir) — remote clones never reach the agent envelope', () => {
  it('excludes an UNMARKED clone under the cache root and reports the skip (fail-open route)', async () => {
    await registerUnmarked(path.join(defaultCacheRoot(), 'attacker', 'evil-repo'));
    await registerUnmarked(path.join(homeDir, 'keeper'));

    const out = await runPortfolio('--agent');
    const envelope = JSON.parse(out);

    expect(envelope.command).toBe('portfolio');
    expect(envelope.data.crossRepo.status.repoCount).toBe(1);
    expect(out).not.toContain('evil-repo');
    expect(envelope.data.skippedRemote).toBe(1);
    expect(envelope.data.skippedRemoteNote).toMatch(/skipped 1 project\(s\) registered from a remote clone/);
  });

  it('excludes a MARKED remote project at an ordinary path and reports the skip (marker route)', async () => {
    await registerMarkedRemote(path.join(homeDir, 'looks-local'));
    await registerUnmarked(path.join(homeDir, 'keeper'));

    const out = await runPortfolio('--agent');
    const envelope = JSON.parse(out);

    expect(envelope.data.crossRepo.status.repoCount).toBe(1);
    expect(out).not.toContain('looks-local');
    expect(envelope.data.skippedRemote).toBe(1);
  });

  it('counts both routes together', async () => {
    await registerUnmarked(path.join(defaultCacheRoot(), 'attacker', 'evil-repo'));
    await registerMarkedRemote(path.join(homeDir, 'looks-local'));
    await registerUnmarked(path.join(homeDir, 'keeper'));

    const envelope = JSON.parse(await runPortfolio('--agent'));

    expect(envelope.data.crossRepo.status.repoCount).toBe(1);
    expect(envelope.data.skippedRemote).toBe(2);
    expect(envelope.data.skippedRemoteNote).toMatch(/skipped 2 project\(s\)/);
  });

  it('reports zero skipped and keeps every genuine local project', async () => {
    await registerUnmarked(path.join(homeDir, 'keeper-a'));
    await registerUnmarked(path.join(homeDir, 'keeper-b'));

    const envelope = JSON.parse(await runPortfolio('--agent'));

    expect(envelope.data.crossRepo.status.repoCount).toBe(2);
    expect(envelope.data.skippedRemote).toBe(0);
    expect(envelope.data.skippedRemoteNote).toBeNull();
  });

  it('surfaces the skip in --json too', async () => {
    await registerUnmarked(path.join(defaultCacheRoot(), 'attacker', 'evil-repo'));
    await registerUnmarked(path.join(homeDir, 'keeper'));

    const payload = JSON.parse(await runPortfolio('--json'));

    expect(payload.skippedRemote).toBe(1);
    expect(payload.skippedRemoteNote).toMatch(/remote clone/);
    expect(JSON.stringify(payload)).not.toContain('evil-repo');
  });

  it('surfaces the skip in human output too — a silent drop is its own trust problem', async () => {
    await registerUnmarked(path.join(defaultCacheRoot(), 'attacker', 'evil-repo'));
    await registerUnmarked(path.join(homeDir, 'keeper'));

    const out = await runPortfolio();

    expect(out).toMatch(/Status: 1 repo\(s\)/);
    expect(out).toMatch(/skipped 1 project\(s\) registered from a remote clone/);
    expect(out).not.toContain('evil-repo');
  });

  it('still refuses shared storage mode before fanning out (f4 guard intact)', async () => {
    await registerUnmarked(path.join(homeDir, 'repo-x'));
    setConfig({ storageMode: 'shared' });

    const errors: string[] = [];
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errors.push(args.map(String).join(' '));
    });

    const program = new Command();
    program.exitOverride();
    registerPortfolioCommand(program);
    await program.parseAsync(['node', 'navgator', 'portfolio', '--agent']);

    expect(errors.join('\n')).toMatch(/shared storage mode/i);
    expect(process.exitCode).toBe(1);
  });
});
