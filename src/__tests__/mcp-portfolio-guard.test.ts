/**
 * SEC-004 / f4 — MCP `portfolio` tool boundary tests.
 *
 * SEC-004: `portfolio.dir` was previously a free-form path handed straight to
 * `path.resolve()` -> `scanPortfolio()`, which both reads from an arbitrary
 * filesystem location on an LLM's instruction and writes a managed
 * `.gitignore`/`.git/info/exclude` block into every repo it finds
 * (src/gitignore-safety.ts). This constrains `dir` to already-registered
 * NavGator project roots and explicitly refuses the remote-scan cache root
 * regardless of registration status.
 *
 * f4: the no-`dir` status path bypasses `scanPortfolio()` (and its internal
 * `assertLocalStorageMode` guard) entirely — it fans out
 * `loadAllComponents`/`loadAllConnections` directly across every registered
 * project. In shared storage mode every project would resolve to the SAME
 * `$HOME` storage path, and `buildCrossRepoMap` would fabricate cross-repo
 * sharing/service-call edges across all of them. The MCP handler must call
 * the same guard before that branch runs.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { handleToolCall } from '../mcp/tools.js';
import { registerProject } from '../projects.js';
import { resetConfig, setConfig } from '../config.js';
import { defaultCacheRoot } from '../remote/clone.js';

let homeDir: string;
let prevHome: string | undefined;

beforeEach(() => {
  homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-mcp-portfolio-home-'));
  prevHome = process.env.HOME;
  process.env.HOME = homeDir;
  resetConfig();
  setConfig({ storageMode: 'local' });
});

afterEach(() => {
  process.env.HOME = prevHome;
  resetConfig();
  fs.rmSync(homeDir, { recursive: true, force: true });
});

describe('MCP portfolio tool — dir guard (SEC-004)', () => {
  it('refuses a dir that is not an already-registered project root', async () => {
    const notRegistered = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-mcp-portfolio-unregistered-'));
    try {
      const result = await handleToolCall('portfolio', { dir: notRegistered });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toMatch(/not an already-registered/i);
      expect(result.content[0].text).toContain(path.resolve(notRegistered));
    } finally {
      fs.rmSync(notRegistered, { recursive: true, force: true });
    }
  });

  it('refuses a dir under the remote-scan cache root, even if it happened to be registered', async () => {
    const cacheRoot = defaultCacheRoot();
    const clonedRepoPath = path.join(cacheRoot, 'attacker', 'repo');
    // Simulate the state after a human ran `navgator scan-remote`: the
    // cloned repo IS registered, since scan() registers every project it
    // scans. The cache-root refusal must fire regardless of that.
    await registerProject(clonedRepoPath, { components: 1, connections: 0, prompts: 0 });

    const result = await handleToolCall('portfolio', { dir: clonedRepoPath });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/remote-scan cache root/i);
  });

  it('still accepts a dir that IS a registered project root', async () => {
    const registeredRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-mcp-portfolio-registered-'));
    try {
      await registerProject(registeredRoot, { components: 0, connections: 0, prompts: 0 });

      const result = await handleToolCall('portfolio', { dir: registeredRoot });

      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toMatch(/Scanned \d+ repo\(s\)/);
    } finally {
      fs.rmSync(registeredRoot, { recursive: true, force: true });
    }
  });

  it('the no-dir status path still works and reports over registered projects', async () => {
    const result = await handleToolCall('portfolio', {});

    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toMatch(/^Status: \d+ repo\(s\)/m);
  });

  it('the no-dir status path refuses in shared storage mode instead of fabricating a cross-repo map (f4)', async () => {
    await registerProject(path.join(homeDir, 'repo-x'), { components: 1, connections: 0, prompts: 0 });
    setConfig({ storageMode: 'shared' });

    const result = await handleToolCall('portfolio', {});

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/shared storage mode/i);
  });
});
