import { describe, it, expect, vi, beforeEach } from 'vitest';
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

  it('parses, clones, and calls scan(cloneDir, { mode: "auto" }) on a valid URL', async () => {
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
    expect(mockScan).toHaveBeenCalledTimes(1);
    const [calledRoot, calledOptions] = mockScan.mock.calls[0];
    expect(calledRoot).toBe(path.resolve(cacheRoot, 'torvalds', 'linux'));
    expect(calledOptions).toEqual({ mode: 'auto' });
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
});
