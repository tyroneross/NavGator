import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * No test in this file touches the network. `scan()` is mocked entirely
 * (real scans are slow, non-deterministic, and orthogonal to this module's
 * job of parse → clone → call scan → branch on outcome); the git exec used
 * by `ensureClone` is injected so `git` is never actually invoked either.
 */
vi.mock('../../scanner.js', () => ({
  scan: vi.fn(),
}));

import { scan } from '../../scanner.js';
import { scanRemote } from '../../remote/scan-remote.js';

const mockScan = scan as unknown as ReturnType<typeof vi.fn>;

function makeExecSpy() {
  return vi.fn(async () => ({ stdout: '', stderr: '' }));
}

describe('scanRemote', () => {
  let cacheRoot: string;

  beforeEach(() => {
    mockScan.mockReset();
    cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-scan-remote-test-'));
  });

  it('returns a typed invalid_url result (not a throw) for a malformed URL', async () => {
    const result = await scanRemote('https://gitlab.com/owner/repo', { cacheRoot });
    expect(result.status).toBe('invalid_url');
    expect(mockScan).not.toHaveBeenCalled();
    fs.rmSync(cacheRoot, { recursive: true, force: true });
  });

  it('parses, clones, and calls scan(cloneDir, { mode: "full", clearFirst: true }) on a valid URL', async () => {
    // SEC-002: a remote clone always gets a forced full scan, never `auto` —
    // `auto` would let a shipped index/hashes.json select the no-changes
    // noop path and hand back attacker-authored records untouched.
    mockScan.mockResolvedValue({
      status: 'completed',
      components: [],
      connections: [],
      warnings: [],
      stats: {
        scan_duration_ms: 1,
        components_found: 0,
        connections_found: 0,
        warnings_count: 0,
        files_scanned: 0,
        files_changed: 0,
      },
    });

    const result = await scanRemote('torvalds/linux', {
      cacheRoot,
      execFileImpl: makeExecSpy(),
    });

    expect(result.status).toBe('completed');
    if (result.status === 'completed' || result.status === 'noop') {
      expect(result.origin).toEqual({ kind: 'remote', url: 'torvalds/linux' });
    }
    expect(mockScan).toHaveBeenCalledTimes(1);
    const [calledRoot, calledOptions] = mockScan.mock.calls[0];
    expect(calledRoot).toBe(path.resolve(cacheRoot, 'torvalds', 'linux'));
    expect(calledOptions).toEqual({ mode: 'full', clearFirst: true });
    fs.rmSync(cacheRoot, { recursive: true, force: true });
  });

  it('surfaces a busy scan outcome as a retryable result rather than crashing', async () => {
    mockScan.mockResolvedValue({
      status: 'busy',
      retryable: true,
      message: 'another scan owns the lease',
      components: [],
      connections: [],
      warnings: [],
      stats: {
        scan_duration_ms: 0,
        components_found: 0,
        connections_found: 0,
        warnings_count: 0,
        files_scanned: 0,
        files_changed: 0,
      },
    });

    const result = await scanRemote('torvalds/linux', {
      cacheRoot,
      execFileImpl: makeExecSpy(),
    });

    expect(result.status).toBe('busy');
    if (result.status === 'busy') {
      expect(result.retryable).toBe(true);
      expect(result.message).toBe('another scan owns the lease');
      expect(result.clonePath).toBe(path.resolve(cacheRoot, 'torvalds', 'linux'));
    }
    fs.rmSync(cacheRoot, { recursive: true, force: true });
  });

  it('returns the clone path so a caller can point other commands at it', async () => {
    mockScan.mockResolvedValue({
      status: 'noop',
      components: [],
      connections: [],
      warnings: [],
      stats: {
        scan_duration_ms: 0,
        components_found: 0,
        connections_found: 0,
        warnings_count: 0,
        files_scanned: 0,
        files_changed: 0,
      },
    });

    const result = await scanRemote('https://github.com/acme/widgets', {
      cacheRoot,
      execFileImpl: makeExecSpy(),
    });

    expect(result.status).toBe('noop');
    if (result.status === 'completed' || result.status === 'noop') {
      expect(result.clonePath).toBe(path.resolve(cacheRoot, 'acme', 'widgets'));
    }
    fs.rmSync(cacheRoot, { recursive: true, force: true });
  });

  it('SEC-001: rejects an argument-injection --ref before ever invoking the injected exec', async () => {
    const execSpy = makeExecSpy();

    const result = await scanRemote('owner/repo', {
      ref: '--upload-pack=x',
      cacheRoot,
      execFileImpl: execSpy,
    });

    expect(result.status).toBe('invalid_ref');
    expect(execSpy).not.toHaveBeenCalled();
    expect(mockScan).not.toHaveBeenCalled();
    fs.rmSync(cacheRoot, { recursive: true, force: true });
  });

  it('SEC-002: purges a clone-shipped .navgator/architecture/ and forces a full scan before it can be read', async () => {
    const owner = 'acme';
    const repo = 'poisoned-repo';
    const cloneDir = path.resolve(cacheRoot, owner, repo);
    const archDir = path.join(cloneDir, '.navgator', 'architecture');
    fs.mkdirSync(archDir, { recursive: true });
    // Attacker-shipped state: a recent-looking index + matching hashes +
    // a sentinel component that must never reach the returned result.
    fs.writeFileSync(
      path.join(archDir, 'index.json'),
      JSON.stringify({ last_full_scan: new Date().toISOString(), schema_version: '1.1.0' })
    );
    fs.writeFileSync(path.join(archDir, 'hashes.json'), JSON.stringify({}));
    fs.writeFileSync(
      path.join(archDir, 'components.full.jsonl'),
      JSON.stringify({ component_id: 'COMP_SENTINEL_ATTACKER', name: 'sentinel-planted-component' }) + '\n'
    );

    // The real scanner would never read the sentinel (the fixture is deleted
    // before scan() runs, and mode is forced to 'full'); this stub stands in
    // for that real, non-poisoned result.
    mockScan.mockResolvedValue({
      status: 'completed',
      components: [{ component_id: 'COMP_real', name: 'real-component' }],
      connections: [],
      warnings: [],
      stats: {
        scan_duration_ms: 1,
        components_found: 1,
        connections_found: 0,
        warnings_count: 0,
        files_scanned: 3,
        files_changed: 3,
      },
    });

    const result = await scanRemote(`${owner}/${repo}`, {
      cacheRoot,
      execFileImpl: vi.fn(async () => {
        // Simulate git leaving the fixture untouched (a real clone would
        // overwrite cloneDir entirely; the stub here proves the *code path*
        // purges first regardless of what git does).
        return { stdout: '', stderr: '' };
      }),
    });

    expect(mockScan).toHaveBeenCalledTimes(1);
    const [, calledOptions] = mockScan.mock.calls[0];
    expect(calledOptions).toEqual({ mode: 'full', clearFirst: true });
    // The shipped architecture dir must be gone before/by the time scan ran.
    expect(fs.existsSync(archDir)).toBe(false);

    expect(result.status).toBe('completed');
    if (result.status === 'completed') {
      const ids = result.scan.components.map((c) => c.component_id);
      expect(ids).not.toContain('COMP_SENTINEL_ATTACKER');
      expect(result.origin).toEqual({ kind: 'remote', url: `${owner}/${repo}` });
    }

    fs.rmSync(cacheRoot, { recursive: true, force: true });
  });
});

describe('scanRemote — f8: registry entry carries origin.kind === "remote" (static import, not dynamic lookup)', () => {
  let cacheRoot: string;
  let homeDir: string;
  let prevHome: string | undefined;

  beforeEach(async () => {
    mockScan.mockReset();
    cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-scan-remote-f8-'));
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-f8-home-'));
    prevHome = process.env.HOME;
    process.env.HOME = homeDir;
  });

  afterEach(() => {
    process.env.HOME = prevHome;
    fs.rmSync(cacheRoot, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  it('records origin.kind "remote" and the url in the project registry after a successful scan', async () => {
    const { loadRegistry } = await import('../../projects.js');

    mockScan.mockResolvedValue({
      status: 'completed',
      components: [],
      connections: [],
      warnings: [],
      stats: {
        scan_duration_ms: 1,
        components_found: 0,
        connections_found: 0,
        warnings_count: 0,
        files_scanned: 0,
        files_changed: 0,
      },
    });

    const url = 'acme/registered-repo';
    const result = await scanRemote(url, {
      cacheRoot,
      execFileImpl: makeExecSpy(),
    });

    expect(result.status).toBe('completed');
    const expectedDir = path.resolve(cacheRoot, 'acme', 'registered-repo');
    const registry = await loadRegistry();
    const entry = registry.projects.find((p) => p.path === expectedDir);
    expect(entry).toBeDefined();
    expect(entry?.origin).toEqual({ kind: 'remote', url, cachePath: expectedDir });
  });
});
