import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { scanPortfolio } from '../../portfolio/scan.js';
import { resetConfig, setConfig } from '../../config.js';
import { acquireScanLease } from '../../scan-lock.js';
import { scanLockPath } from '../../freshness/paths.js';

function initGitRepo(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
  fs.writeFileSync(path.join(dir, 'README.md'), '# test repo\n');
  execFileSync('git', ['add', '.'], { cwd: dir });
  execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: dir });
}

describe('scanPortfolio', () => {
  let portfolioRoot: string;
  let homeDir: string;
  let prevHome: string | undefined;

  beforeEach(() => {
    portfolioRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-portfolio-'));
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-home-'));
    prevHome = process.env.HOME;
    process.env.HOME = homeDir;
    resetConfig();
    setConfig({ storageMode: 'local' });
  });

  afterEach(() => {
    process.env.HOME = prevHome;
    resetConfig();
    fs.rmSync(portfolioRoot, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  it('hard-refuses shared storage mode, naming the reason', async () => {
    setConfig({ storageMode: 'shared' });
    await expect(scanPortfolio(portfolioRoot)).rejects.toThrow(/shared storage mode/i);
    await expect(scanPortfolio(portfolioRoot)).rejects.toThrow(/overwrite/i);
  });

  it('continues the sweep when one repo is busy, and still scans the others', async () => {
    const repoA = path.join(portfolioRoot, 'repo-a');
    const repoB = path.join(portfolioRoot, 'repo-b');
    initGitRepo(repoA);
    initGitRepo(repoB);

    const held = acquireScanLease(scanLockPath(repoA), 'full', { startHeartbeat: false });
    expect(held.ok).toBe(true);
    if (!held.ok) throw new Error(held.message);

    try {
      const result = await scanPortfolio(portfolioRoot, { depth: 1 });

      const outcomeA = result.repos.find((r) => r.path === repoA);
      const outcomeB = result.repos.find((r) => r.path === repoB);

      expect(outcomeA?.status).toBe('busy');
      expect(outcomeA?.retryable).toBe(true);
      expect(outcomeA?.message).toBeTruthy();

      expect(['scanned', 'noop']).toContain(outcomeB?.status);
      expect(result.busy).toBe(1);
      expect(result.scanned + result.noop).toBeGreaterThanOrEqual(1);
      expect(result.repos.length).toBe(2);
    } finally {
      held.lease.release();
    }
  }, 30000);

  it('with HOME redirected, writes only projects.json under ~/.navgator (no second registry file)', async () => {
    const repoOne = path.join(portfolioRoot, 'repo-one');
    initGitRepo(repoOne);

    await scanPortfolio(portfolioRoot, { depth: 1 });

    const navDir = path.join(homeDir, '.navgator');
    expect(fs.existsSync(navDir)).toBe(true);
    const topLevelJson = fs.readdirSync(navDir).filter((e) => e.endsWith('.json'));
    expect(topLevelJson).toEqual(['projects.json']);
  }, 30000);
});
