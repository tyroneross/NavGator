/**
 * B3: multi-stack root discovery.
 *
 * Builds a temp dir tree to mirror common shapes:
 *   1. Single-root project — root has package.json. Should return `.`.
 *   2. Frontend/Backend split — no manifest at root, frontend/package.json,
 *      backend/pyproject.toml. Should return both subroots.
 *   3. Mixed real/junk — extra subdirs without manifests are ignored.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { discoverStackRoots } from '../scanner.js';

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-multistack-'));
});

afterEach(() => {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {
    // Best-effort cleanup — test isolation already complete by this point.
  }
});

describe('discoverStackRoots', () => {
  it('returns root when root has a stack manifest', () => {
    fs.writeFileSync(path.join(tmp, 'package.json'), '{}');
    const out = discoverStackRoots(tmp, false);
    expect(out).toEqual([{ path: tmp, origin: '.' }]);
  });

  it('returns each subroot when root has no manifest but children do', () => {
    fs.mkdirSync(path.join(tmp, 'frontend'));
    fs.mkdirSync(path.join(tmp, 'backend'));
    fs.writeFileSync(path.join(tmp, 'frontend', 'package.json'), '{}');
    fs.writeFileSync(path.join(tmp, 'backend', 'pyproject.toml'), '');

    const out = discoverStackRoots(tmp, false);
    const origins = out.map(s => s.origin).sort();
    expect(origins).toEqual(['backend', 'frontend']);
  });

  it('ignores subdirs without manifests', () => {
    fs.mkdirSync(path.join(tmp, 'frontend'));
    fs.mkdirSync(path.join(tmp, 'docs'));        // no manifest
    fs.mkdirSync(path.join(tmp, 'misc'));        // no manifest
    fs.writeFileSync(path.join(tmp, 'frontend', 'package.json'), '{}');

    const out = discoverStackRoots(tmp, false);
    expect(out).toEqual([{ path: path.join(tmp, 'frontend'), origin: 'frontend' }]);
  });

  it('skips node_modules / .git / dist', () => {
    fs.mkdirSync(path.join(tmp, 'node_modules'));
    fs.mkdirSync(path.join(tmp, '.git'));
    fs.mkdirSync(path.join(tmp, 'dist'));
    // These contain manifests by accident — must NOT be picked up.
    fs.writeFileSync(path.join(tmp, 'node_modules', 'package.json'), '{}');
    fs.writeFileSync(path.join(tmp, 'dist', 'pyproject.toml'), '');

    fs.mkdirSync(path.join(tmp, 'app'));
    fs.writeFileSync(path.join(tmp, 'app', 'go.mod'), 'module x');

    const out = discoverStackRoots(tmp, false);
    const origins = out.map(s => s.origin).sort();
    expect(origins).toEqual(['app']);
  });

  it('detects .csproj as a .NET stack root', () => {
    fs.mkdirSync(path.join(tmp, 'service'));
    fs.writeFileSync(path.join(tmp, 'service', 'MyService.csproj'), '<Project/>');
    const out = discoverStackRoots(tmp, false);
    expect(out.map(s => s.origin)).toEqual(['service']);
  });

  it('falls back to root when nothing matches anywhere', () => {
    fs.mkdirSync(path.join(tmp, 'docs'));
    const out = discoverStackRoots(tmp, false);
    expect(out).toEqual([{ path: tmp, origin: '.' }]);
  });
});
