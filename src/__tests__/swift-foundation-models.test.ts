/**
 * Tests for the dedicated Apple FoundationModels detection pass in the Swift
 * code scanner (KNOWN-ISSUES.md, closed 2026-08-03).
 *
 * Gated on `import FoundationModels` appearing in the same file — a bare
 * `.respond(` or `@Generable` collides heavily with unrelated Swift APIs, so
 * nothing below fires without the import (the false-positive guard).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { scanSwiftCode } from '../scanners/swift/code-scanner.js';

let tmp: string;

function writeFixture(relPath: string, content: string): void {
  const full = path.join(tmp, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf-8');
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-swift-fm-'));
  // The scanner is gated on a Swift stack elsewhere in scanner.ts
  // (Package.swift/Podfile/Cartfile/xcodeproj); provide one so the fixture
  // matches the real detection surface.
  writeFixture('Package.swift', [
    '// swift-tools-version:5.9',
    'import PackageDescription',
    'let package = Package(name: "Demo", products: [], targets: [])',
    '',
  ].join('\n'));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('scanSwiftCode — FoundationModels detection', () => {
  it('detects @Generable struct + LanguageModelSession(instructions:) + respond(to:) as one tagged component', async () => {
    writeFixture(
      'Shared/Services/PlanCoachService.swift',
      [
        'import Foundation',
        'import FoundationModels',
        '',
        '@Generable',
        'struct PlanCoachRequest {',
        '    @Guide(description: "goal for the day")',
        '    var goal: String',
        '}',
        '',
        'final class PlanCoachService {',
        '    func coach() async throws {',
        '        let session = LanguageModelSession(instructions: "You are a plan coach.")',
        '        let response = try await session.respond(to: "Help me plan today")',
        '        print(response)',
        '    }',
        '}',
      ].join('\n')
    );

    const result = await scanSwiftCode(tmp);

    const fmComponent = result.components.find(c => c.name === 'Apple Foundation Models' && c.type === 'llm');
    expect(fmComponent).toBeDefined();
    expect(fmComponent!.role.layer).toBe('external');
    expect(fmComponent!.metadata?.provider).toBe('apple-on-device');
    expect(fmComponent!.metadata?.kind).toBe('foundation-models');
    expect(fmComponent!.metadata?.generable_schemas).toContain('PlanCoachRequest');

    // Every connection endpoint resolves — `to` to the pushed component,
    // `from` to a FILE: id (never a dangling `generateComponentId('other', ...)`).
    const fmConns = result.connections.filter(c => c.to.component_id === fmComponent!.component_id);
    expect(fmConns.length).toBeGreaterThan(0);
    for (const conn of fmConns) {
      expect(conn.from.component_id.startsWith('FILE:')).toBe(true);
    }
  });

  it('detects the trailing-closure LanguageModelSession { ... } construction', async () => {
    writeFixture(
      'Shared/Services/TrailingClosureCoach.swift',
      [
        'import FoundationModels',
        '',
        'func makeSession() -> LanguageModelSession {',
        '    LanguageModelSession {',
        '        "You are a helpful assistant."',
        '    }',
        '}',
      ].join('\n')
    );

    const result = await scanSwiftCode(tmp);
    const fmComponent = result.components.find(c => c.name === 'Apple Foundation Models' && c.type === 'llm');
    expect(fmComponent).toBeDefined();
    const fmConns = result.connections.filter(c => c.to.component_id === fmComponent!.component_id);
    expect(fmConns.length).toBeGreaterThan(0);
  });

  it('does NOT register a FoundationModels use case for .respond(to:) without the import (false-positive guard)', async () => {
    writeFixture(
      'Shared/Networking/URLSessionDelegateHandler.swift',
      [
        'import Foundation',
        '',
        'final class URLSessionDelegateHandler: NSObject, URLSessionDataDelegate {',
        '    func handler(_ transcript: TranscriptProtocol) {',
        '        transcript.respond(to: "some-unrelated-protocol-method")',
        '    }',
        '}',
      ].join('\n')
    );

    const result = await scanSwiftCode(tmp);
    const fmComponent = result.components.find(c => c.name === 'Apple Foundation Models');
    expect(fmComponent).toBeUndefined();
  });

  it('does not dangle any connection endpoint across two FoundationModels files sharing the provider', async () => {
    writeFixture(
      'Shared/Services/A.swift',
      [
        'import FoundationModels',
        '',
        '@Generable(description: "First request shape")',
        'struct RequestA {',
        '    var value: String',
        '}',
        '',
        'func runA() async throws {',
        '    let session = LanguageModelSession(instructions: "A")',
        '    _ = try await session.respond(to: "hi")',
        '}',
      ].join('\n')
    );
    writeFixture(
      'Shared/Services/B.swift',
      [
        'import FoundationModels',
        '',
        '@Generable(name: "RequestBSchema", description: "Second request shape")',
        'struct RequestB {',
        '    var value: String',
        '}',
        '',
        'func runB() async throws {',
        '    let session = LanguageModelSession(instructions: "B")',
        '    _ = try await session.respond(to: "hi")',
        '}',
      ].join('\n')
    );

    const result = await scanSwiftCode(tmp);
    const fmComponents = result.components.filter(c => c.name === 'Apple Foundation Models' && c.type === 'llm');
    expect(fmComponents).toHaveLength(1);
    const fmComponent = fmComponents[0];
    expect(fmComponent.metadata?.generable_schemas).toEqual(
      expect.arrayContaining(['RequestA', 'RequestB'])
    );

    const compIds = new Set(result.components.map(c => c.component_id));
    const fmConns = result.connections.filter(c => c.to.component_id === fmComponent.component_id);
    expect(fmConns.length).toBe(2);
    for (const conn of fmConns) {
      // `to` resolves to the single pushed component.
      expect(conn.to.component_id).toBe(fmComponent.component_id);
      // `from` is either a pushed component id or a FILE: id — never a
      // random `generateComponentId('other', ...)` id that was never pushed.
      const fromId = conn.from.component_id;
      expect(fromId.startsWith('FILE:') || compIds.has(fromId)).toBe(true);
    }
  });
});
