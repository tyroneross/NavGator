/**
 * Endpoint resolution invariant (N1).
 *
 * The graph's core claim is that a connection joins two components. Before
 * this test, Swift and Rust repos violated that claim on ~99% of their edges:
 * scanners built endpoint ids by calling `generateComponentId()` at the edge
 * (a random suffix, so the id never matched any pushed component) or emitted
 * `FILE:<path>` for files no scanner claimed as a component. `runIntegrityCheck`
 * exempts `FILE:` ids unconditionally, so the graph reported "ok" while trace
 * dead-ended and the audit scored the edges as hallucinated.
 *
 * These tests assert the invariant directly against `scan()` output rather
 * than against a scanner in isolation, because resolution is a two-part
 * contract: scanners resolve what they know (name+type lookup), and
 * scanner.ts's (C)/(C2) endpoint resolver synthesizes a file-node for
 * whatever `FILE:` ref survives. A test on either half alone would pass while
 * the stored graph still dangled.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

let tmp: string;

function write(relPath: string, content: string): void {
  const full = path.join(tmp, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf-8');
}

/** Every endpoint id that names no component in the same scan. */
function danglingEndpoints(
  components: { component_id: string }[],
  connections: { connection_id: string; connection_type?: string; from?: { component_id?: string }; to?: { component_id?: string } }[]
): string[] {
  const ids = new Set(components.map(c => c.component_id));
  const bad: string[] = [];
  for (const c of connections) {
    const from = c.from?.component_id;
    const to = c.to?.component_id;
    if (from && !ids.has(from)) bad.push(`${c.connection_type}:FROM:${from}`);
    if (to && !ids.has(to)) bad.push(`${c.connection_type}:TO:${to}`);
  }
  return bad;
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-endpoints-'));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('connection endpoints resolve to stored components', () => {
  it('Swift: conforms-to, observes and actor-isolation edges all name real components', async () => {
    write('Package.swift', 'let package = Package(name: "Demo")\n');
    write(
      'Sources/Demo/Models.swift',
      [
        'import Foundation',
        '',
        'struct Message: Codable, Sendable, Equatable {',
        '    let id: String',
        '}',
        '',
        'struct Session: Codable, Sendable {',
        '    let id: String',
        '}',
        '',
        'actor SessionStore: Sendable {',
        '    private var sessions: [Session] = []',
        '}',
      ].join('\n')
    );
    write(
      'Sources/Demo/ViewModel.swift',
      [
        'import SwiftUI',
        '',
        '@MainActor',
        'final class ChatViewModel: ObservableObject, Sendable {',
        '    @Published var messages: [Message] = []',
        '',
        '    nonisolated func identifier() -> String { "chat" }',
        '',
        '    func load() {',
        '        Task { await refresh() }',
        '    }',
        '}',
        '',
        'struct ChatView: View {',
        '    @StateObject var model: ChatViewModel',
        '    var body: some View { Text("hi") }',
        '}',
      ].join('\n')
    );

    const { scan } = await import('../scanner.js');
    const result = await scan(tmp, { mode: 'full' });

    // The fixture must actually exercise the edge types this chunk fixed;
    // otherwise a scanner regression that emits nothing would pass silently.
    const types = new Set(result.connections.map(c => c.connection_type));
    expect(types.has('conforms-to')).toBe(true);

    expect(danglingEndpoints(result.components, result.connections)).toEqual([]);
    // No stored edge may keep an unresolved FILE: ref for a file on disk.
    const fileRefs = result.connections.flatMap(c =>
      [c.from?.component_id, c.to?.component_id].filter(
        (id): id is string => !!id && id.startsWith('FILE:')
      )
    );
    expect(fileRefs).toEqual([]);
  });

  it('Rust: repeated trait impls and use-graph edges name real components', async () => {
    write('Cargo.toml', '[package]\nname = "demo"\nversion = "0.1.0"\n');
    write(
      'src/main.rs',
      [
        'mod config;',
        'pub mod handlers;',
        '',
        'use crate::config::Settings;',
        'use crate::handlers::route;',
        'use serde::Serialize;',
        '',
        'pub struct App {}',
        '',
        'impl Serialize for App {',
        '    fn serialize(&self) {}',
        '}',
      ].join('\n')
    );
    write(
      'src/config.rs',
      [
        'use serde::Serialize;',
        '',
        'pub struct Settings {}',
        'pub struct Profile {}',
        '',
        // Two impls of the SAME trait — the case where the pre-fix scanner
        // regenerated a fresh trait id that the dedupe had already discarded.
        'impl Serialize for Settings {',
        '    fn serialize(&self) {}',
        '}',
        '',
        'impl Serialize for Profile {',
        '    fn serialize(&self) {}',
        '}',
      ].join('\n')
    );
    write('src/handlers.rs', ['use crate::config::Settings;', '', 'pub fn route() {}'].join('\n'));

    const { scan } = await import('../scanner.js');
    const result = await scan(tmp, { mode: 'full' });

    const conformsTo = result.connections.filter(c => c.connection_type === 'conforms-to');
    expect(conformsTo.length).toBeGreaterThanOrEqual(3);

    expect(danglingEndpoints(result.components, result.connections)).toEqual([]);
  });

  it('synthesizes exactly one file-node per file, shared by every edge that names it', async () => {
    write('Cargo.toml', '[package]\nname = "demo"\nversion = "0.1.0"\n');
    // Three external-crate `use` lines in one file → three edges, one file-node.
    write(
      'src/lib.rs',
      ['use serde::Serialize;', 'use reqwest::Client;', 'use tokio::spawn;', '', 'pub struct A {}'].join('\n')
    );

    const { scan } = await import('../scanner.js');
    const result = await scan(tmp, { mode: 'full' });

    const fileNodes = result.components.filter(c => c.tags?.includes('file-node'));
    const libNodes = fileNodes.filter(c => c.source?.config_files?.includes('src/lib.rs'));
    expect(libNodes).toHaveLength(1);

    const usesPackage = result.connections.filter(c => c.connection_type === 'uses-package');
    expect(usesPackage.length).toBeGreaterThanOrEqual(3);
    for (const conn of usesPackage) {
      expect(conn.from?.component_id).toBe(libNodes[0].component_id);
    }
    expect(danglingEndpoints(result.components, result.connections)).toEqual([]);
  });

  it('leaves a FILE: ref alone when the path is not on disk, rather than inventing an orphan component', async () => {
    // A synthesized file-node whose config_files does not resolve would fail
    // runIntegrityCheck rule (2) and promote every later incremental scan to
    // a full one — worse than the dangling edge it replaced.
    const { scan } = await import('../scanner.js');
    write('package.json', JSON.stringify({ name: 'demo', version: '1.0.0' }));
    const result = await scan(tmp, { mode: 'full' });
    for (const comp of result.components) {
      for (const f of comp.source?.config_files ?? []) {
        expect(fs.existsSync(path.join(tmp, f))).toBe(true);
      }
    }
  });
});
