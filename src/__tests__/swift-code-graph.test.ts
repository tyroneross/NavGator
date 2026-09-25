/**
 * Swift file coupling: framework imports, cross-file type references, and
 * `@main` entry points. Same-module Swift files import nothing from each other,
 * so type references are the only file-to-file edges Swift source carries.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { scanSwiftCode, stripSwiftNonCode } from '../scanners/swift/code-scanner.js';

let tmp: string;

function writeFixture(relPath: string, content: string): void {
  const full = path.join(tmp, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf-8');
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-swift-graph-'));
  writeFixture('Package.swift', '// swift-tools-version: 6.0\nimport PackageDescription\nlet package = Package(name: "Demo")\n');
  writeFixture('Sources/Demo/DemoApp.swift', [
    'import SwiftUI',
    '',
    '@main',
    'struct DemoApp: App {',
    '    var body: some Scene { WindowGroup { RootView() } }',
    '}',
  ].join('\n'));
  writeFixture('Sources/Demo/RootView.swift', [
    'import SwiftUI',
    'struct RootView: View {',
    '    @StateObject private var store = SessionStore()',
    '    var body: some View { Text("\\(Formatter.label(store.count))") }',
    '    enum CodingKeys: String { case a }',
    '}',
  ].join('\n'));
  writeFixture('Sources/Demo/SessionStore.swift', [
    'import Foundation',
    '// RootView is only named in this comment',
    'final class SessionStore: ObservableObject {',
    '    @Published var count = 0',
    '    let title = "RootView in a string"',
    '    enum CodingKeys: String { case count }',
    '    func key() -> CodingKeys { .count }',
    '}',
  ].join('\n'));
  writeFixture('Sources/Demo/Formatter.swift', [
    'enum Formatter {',
    '    static func label(_ n: Int) -> String { String(n) }',
    '}',
  ].join('\n'));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('scanSwiftCode file graph', () => {
  it('emits references from the using file to the declaring type, skipping comments, strings and ambiguous names', async () => {
    const result = await scanSwiftCode(tmp);
    const byId = new Map(result.components.map(c => [c.component_id, c.name]));
    const refs = result.connections
      .filter(c => c.connection_type === 'references')
      .map(c => `${c.from.component_id.slice(5)} -> ${c.to.location?.file} (${c.code_reference.symbol})`)
      .sort();

    expect(refs).toEqual([
      'Sources/Demo/DemoApp.swift -> Sources/Demo/RootView.swift (RootView)',
      'Sources/Demo/RootView.swift -> Sources/Demo/Formatter.swift (Formatter)',       // inside \( ) interpolation
      'Sources/Demo/RootView.swift -> Sources/Demo/SessionStore.swift (SessionStore)',
    ]);
    // A type with its own component is the edge target, not just its file.
    const toStore = result.connections.find(c => c.connection_type === 'references' && c.code_reference.symbol === 'SessionStore');
    expect(byId.get(toStore!.to.component_id)).toBe('SessionStore');
    // A type with no component falls back to its declaring file.
    const toFormatter = result.connections.find(c => c.connection_type === 'references' && c.code_reference.symbol === 'Formatter');
    expect(toFormatter!.to.component_id).toBe('FILE:Sources/Demo/Formatter.swift');
  });

  it('tags the @main type as an entry point', async () => {
    const result = await scanSwiftCode(tmp);
    const app = result.components.find(c => c.name === 'DemoApp');
    expect(app?.tags).toContain('entrypoint');
    expect((app?.metadata as Record<string, unknown>)?.file).toBe('Sources/Demo/DemoApp.swift');
  });

  it('links each file import to the package-pass node it names', async () => {
    const result = await scanSwiftCode(tmp, undefined, [
      { component_id: 'COMP_framework_SwiftUI', module: 'SwiftUI' },
      { component_id: 'COMP_framework_Foundation', module: 'Foundation' },
    ]);
    const uses = result.connections
      .filter(c => c.connection_type === 'uses-package')
      .map(c => `${c.from.component_id} -> ${c.to.component_id}`)
      .sort();
    expect(uses).toEqual([
      'FILE:Sources/Demo/DemoApp.swift -> COMP_framework_SwiftUI',
      'FILE:Sources/Demo/RootView.swift -> COMP_framework_SwiftUI',
      'FILE:Sources/Demo/SessionStore.swift -> COMP_framework_Foundation',
    ]);
  });

  it('strips comments and string text but keeps interpolated code and line count', () => {
    const src = 'let a = "Foo \\(Bar.x) Baz" // Qux\n/* Zed */ let b = """\nMulti\n""" + #"Raw"#';
    const out = stripSwiftNonCode(src);
    expect(out).toContain('Bar.x');
    expect(out).not.toMatch(/Foo|Baz|Qux|Zed|Multi|Raw/);
    expect(out.split('\n')).toHaveLength(src.split('\n').length);
  });
});
