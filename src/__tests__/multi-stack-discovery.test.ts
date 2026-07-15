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
import { discoverStackRoots, scan } from '../scanner.js';

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

  it('returns root and nested stacks when both carry manifests', () => {
    fs.writeFileSync(path.join(tmp, 'package.json'), '{}');
    fs.mkdirSync(path.join(tmp, 'apps', 'mac'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'apps', 'mac', 'Package.swift'), '// swift-tools-version: 6.0');

    const out = discoverStackRoots(tmp, false);

    expect(out).toEqual([
      { path: tmp, origin: '.' },
      { path: path.join(tmp, 'apps', 'mac'), origin: 'apps/mac' },
    ]);
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

  it('detects Cargo.toml as a Rust stack root', () => {
    fs.mkdirSync(path.join(tmp, 'rust-api'));
    fs.writeFileSync(path.join(tmp, 'rust-api', 'Cargo.toml'), '[package]\nname = "rust-api"\nversion = "0.1.0"\n');
    const out = discoverStackRoots(tmp, false);
    expect(out.map(s => s.origin)).toEqual(['rust-api']);
  });

  it('detects nested Swift package and Xcode roots behind wrapper directories', () => {
    fs.mkdirSync(path.join(tmp, 'apps', 'mac', 'PsychScribe.xcodeproj'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'packages', 'PsychScribeCore'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'tools', 'asr-bench'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'packages', 'PsychScribeCore', 'Package.swift'), '// swift-tools-version: 6.0');
    fs.writeFileSync(path.join(tmp, 'tools', 'asr-bench', 'Package.swift'), '// swift-tools-version: 6.0');

    const origins = discoverStackRoots(tmp, false).map(s => s.origin).sort();

    expect(origins).toEqual([
      'apps/mac',
      'packages/PsychScribeCore',
      'tools/asr-bench',
    ]);
  });

  it('runs Swift code analysis when the manifest is below a wrapper directory', async () => {
    fs.writeFileSync(path.join(tmp, 'package.json'), '{"name":"mixed-root"}');
    const packageRoot = path.join(tmp, 'packages', 'PsychScribeCore');
    const sourcesRoot = path.join(packageRoot, 'Sources', 'PsychScribeCore');
    fs.mkdirSync(sourcesRoot, { recursive: true });
    fs.writeFileSync(
      path.join(packageRoot, 'Package.swift'),
      '// swift-tools-version: 6.0\nimport PackageDescription\n' +
      'let package = Package(name: "PsychScribeCore", dependencies: [' +
      '.package(url: "https://github.com/apple/swift-collections.git", from: "1.0.0")])\n'
    );
    fs.writeFileSync(
      path.join(sourcesRoot, 'Recorder.swift'),
      'struct LocalRecorder: Sendable {}\n'
    );

    const result = await scan(tmp, { mode: 'full', noAudit: true });

    expect(result.connections.some(connection =>
      connection.detected_from === 'swift-code-scanner' &&
      connection.connection_type === 'conforms-to' &&
      connection.code_reference?.file === 'packages/PsychScribeCore/Sources/PsychScribeCore/Recorder.swift'
    )).toBe(true);
    expect(result.components.find(component => component.name === 'swift-collections')?.source.config_files)
      .toContain('packages/PsychScribeCore/Package.swift');

    fs.appendFileSync(path.join(packageRoot, 'Package.swift'), '// dependency changed\n');
    const incremental = await scan(tmp, { mode: 'auto', noAudit: true });

    expect(incremental.fileChanges?.modified).toContain('packages/PsychScribeCore/Package.swift');
    expect(incremental.timelineEntry?.scan_type).toBe('full');
  }, 30000);

  it('falls back to root when nothing matches anywhere', () => {
    fs.mkdirSync(path.join(tmp, 'docs'));
    const out = discoverStackRoots(tmp, false);
    expect(out).toEqual([{ path: tmp, origin: '.' }]);
  });
});
