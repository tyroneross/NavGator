/**
 * Tests for NavGator Sandbox Mode
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { detectSandbox, isSandboxMode, getSandboxRestrictions } from '../sandbox.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

describe('sandbox', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    // Save original environment
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
  });

  it('detects explicit sandbox mode via NAVGATOR_SANDBOX=1', () => {
    process.env.NAVGATOR_SANDBOX = '1';

    const config = detectSandbox();

    expect(config.enabled).toBe(true);
    expect(config.detected).toBe(false); // explicit, not auto-detected
    expect(config.restrictions.noNetwork).toBe(true);
    expect(config.restrictions.noInteractive).toBe(true);
    expect(config.restrictions.noChildProcess).toBe(true);
    expect(config.restrictions.readOnlyFs).toBe(false);
  });

  it('detects Codex environment via CODEX=1', () => {
    process.env.CODEX = '1';

    const config = detectSandbox();

    expect(config.enabled).toBe(true);
    expect(config.detected).toBe(true);
    expect(config.restrictions.noNetwork).toBe(true);
    expect(config.restrictions.noInteractive).toBe(true);
    expect(config.restrictions.noChildProcess).toBe(true);
    expect(config.restrictions.readOnlyFs).toBe(true);
  });

  it('OPENAI_API_KEY is never a sandbox signal', () => {
    // An API key in the environment says nothing about whether a shell or
    // child process is available, and many developers export it for unrelated
    // tools. Only CODEX=1 triggers Codex detection.
    process.env.OPENAI_API_KEY = 'sk-test';
    delete process.env.CODEX;
    delete process.env.CI;

    const originalIsTTY = process.stdout.isTTY;
    Object.defineProperty(process.stdout, 'isTTY', {
      value: false,
      writable: true,
      configurable: true,
    });

    const config = detectSandbox();

    expect(config.enabled).toBe(false);
    expect(config.detected).toBe(false);

    // Restore
    Object.defineProperty(process.stdout, 'isTTY', {
      value: originalIsTTY,
      writable: true,
      configurable: true,
    });
  });

  it('detects CI environment via CI=true', () => {
    process.env.CI = 'true';

    const config = detectSandbox();

    expect(config.enabled).toBe(true);
    expect(config.detected).toBe(true);
    expect(config.restrictions.noInteractive).toBe(true);
    expect(config.restrictions.noNetwork).toBe(false); // CI usually has network
    expect(config.restrictions.noChildProcess).toBe(false);
    expect(config.restrictions.readOnlyFs).toBe(false);
  });

  it('returns normal environment with no special env vars', () => {
    // Clear any sandbox-related env vars
    delete process.env.NAVGATOR_SANDBOX;
    delete process.env.CODEX;
    delete process.env.OPENAI_API_KEY;
    delete process.env.CI;

    // Mock TTY as available
    const originalStdoutTTY = process.stdout.isTTY;
    const originalStdinTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdout, 'isTTY', {
      value: true,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(process.stdin, 'isTTY', {
      value: true,
      writable: true,
      configurable: true,
    });

    const config = detectSandbox();

    expect(config.enabled).toBe(false);
    expect(config.detected).toBe(false);
    expect(config.restrictions.noNetwork).toBe(false);
    expect(config.restrictions.noInteractive).toBe(false);
    expect(config.restrictions.noChildProcess).toBe(false);
    expect(config.restrictions.readOnlyFs).toBe(false);

    // Restore
    Object.defineProperty(process.stdout, 'isTTY', {
      value: originalStdoutTTY,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(process.stdin, 'isTTY', {
      value: originalStdinTTY,
      writable: true,
      configurable: true,
    });
  });

  it('isSandboxMode returns boolean based on detectSandbox().enabled', () => {
    process.env.NAVGATOR_SANDBOX = '1';
    expect(isSandboxMode()).toBe(true);

    delete process.env.NAVGATOR_SANDBOX;

    // With TTY (also clear CI to avoid CI-detection branch)
    const originalCI = process.env.CI;
    delete process.env.CI;
    const originalStdoutTTY = process.stdout.isTTY;
    const originalStdinTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdout, 'isTTY', {
      value: true,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(process.stdin, 'isTTY', {
      value: true,
      writable: true,
      configurable: true,
    });

    expect(isSandboxMode()).toBe(false);

    // Restore
    Object.defineProperty(process.stdout, 'isTTY', {
      value: originalStdoutTTY,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(process.stdin, 'isTTY', {
      value: originalStdinTTY,
      writable: true,
      configurable: true,
    });
    if (originalCI !== undefined) process.env.CI = originalCI;
  });

  it('getSandboxRestrictions returns current restrictions', () => {
    process.env.CI = 'true';

    const restrictions = getSandboxRestrictions();

    expect(restrictions.noInteractive).toBe(true);
    expect(restrictions.noNetwork).toBe(false);
  });

  it('handles no TTY without sandbox mode', () => {
    // Clear sandbox env vars
    delete process.env.NAVGATOR_SANDBOX;
    delete process.env.CODEX;
    delete process.env.OPENAI_API_KEY;
    delete process.env.CI;

    // Mock no TTY
    const originalStdoutTTY = process.stdout.isTTY;
    const originalStdinTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdout, 'isTTY', {
      value: false,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(process.stdin, 'isTTY', {
      value: false,
      writable: true,
      configurable: true,
    });

    const config = detectSandbox();

    expect(config.enabled).toBe(false); // Not enabled by default for no-TTY
    expect(config.detected).toBe(false);
    expect(config.restrictions.noInteractive).toBe(true); // But interactive is still restricted

    // Restore
    Object.defineProperty(process.stdout, 'isTTY', {
      value: originalStdoutTTY,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(process.stdin, 'isTTY', {
      value: originalStdinTTY,
      writable: true,
      configurable: true,
    });
  });

  it('prioritizes explicit NAVGATOR_SANDBOX over other detection', () => {
    process.env.NAVGATOR_SANDBOX = '1';
    process.env.CI = 'true';

    const config = detectSandbox();

    // Should use NAVGATOR_SANDBOX config, not CI config
    expect(config.enabled).toBe(true);
    expect(config.detected).toBe(false); // explicit
    expect(config.restrictions.noNetwork).toBe(true); // NAVGATOR_SANDBOX has noNetwork
  });

  it('doc-comment detection-order list stays in sync with the env vars detectSandbox() actually reads', () => {
    // Regression guard for the 2026-04-18 drift (commit 970dc83): the
    // detection-order doc comment above detectSandbox() kept advertising
    // "CODEX=1 or OPENAI_API_KEY + no TTY" for 3.5 months after the
    // OPENAI_API_KEY branch was deleted from the function body. This test
    // reads src/sandbox.ts as text and asserts the env vars named in the
    // NUMBERED detection-order list equal the env vars the function body
    // actually reads. Pure string/regex work — no scan, no subprocess.
    const testDir = path.dirname(fileURLToPath(import.meta.url));
    const sourcePath = path.resolve(testDir, '../sandbox.ts');
    const source = fs.readFileSync(sourcePath, 'utf-8');

    // Collects env var names referenced via any of the read-styles this
    // codebase uses: process.env.X, process.env['X'], and the dynamic
    // getEnvBoolean('X', ...) helper (src/config.ts). Applied to both the
    // function body and (defensively) the doc comment, so the test doesn't
    // go blind if either side switches read/documentation style.
    const extractEnvVarNames = (text: string): Set<string> => {
      const names = new Set<string>();
      const patterns = [
        /process\.env\.([A-Z_][A-Z0-9_]*)/g,
        /process\.env\[\s*['"]([A-Z_][A-Z0-9_]*)['"]\s*\]/g,
        /getEnvBoolean\(\s*['"]([A-Z_][A-Z0-9_]*)['"]/g,
      ];
      for (const pattern of patterns) {
        for (const match of text.matchAll(pattern)) {
          names.add(match[1]);
        }
      }
      return names;
    };

    // --- Scope 1: the detectSandbox() FUNCTION BODY only ---
    // isSandboxMode()/getSandboxRestrictions() delegate to detectSandbox()
    // and must not skew the set, so bound the slice from the
    // "export function detectSandbox" declaration to the next top-level
    // `export ` at column 0.
    const fnStart = source.indexOf('export function detectSandbox');
    expect(fnStart, 'Could not locate "export function detectSandbox" in src/sandbox.ts').toBeGreaterThanOrEqual(0);
    const nextExportIdx = source.indexOf('\nexport ', fnStart + 'export function detectSandbox'.length);
    const fnBody = source.slice(fnStart, nextExportIdx === -1 ? source.length : nextExportIdx);
    const readVars = extractEnvVarNames(fnBody);

    // --- Scope 2: the doc comment's NUMBERED detection-order list only ---
    // Take the nearest preceding /** ... */ block (the JSDoc immediately
    // above detectSandbox), then within it keep only lines that open with
    // "N." — this excludes the surrounding prose sentence explaining why
    // OPENAI_API_KEY is deliberately NOT a signal, which legitimately
    // mentions that var name without documenting it as a detection input.
    const beforeFn = source.slice(0, fnStart);
    const commentStart = beforeFn.lastIndexOf('/**');
    expect(commentStart, 'Could not locate a doc comment preceding detectSandbox() in src/sandbox.ts').toBeGreaterThanOrEqual(0);
    const commentBlock = beforeFn.slice(commentStart);
    const commentEnd = commentBlock.indexOf('*/');
    expect(commentEnd, 'Doc comment preceding detectSandbox() is not closed with */').toBeGreaterThanOrEqual(0);
    const docComment = commentBlock.slice(0, commentEnd);

    const numberedLines = docComment
      .split('\n')
      .map((line) => line.match(/^\s*\*\s*\d+\.\s*(.*)$/))
      .filter((m): m is RegExpMatchArray => m !== null)
      .map((m) => m[1]);
    expect(numberedLines.length, 'Found no numbered detection-order lines in the doc comment above detectSandbox()').toBeGreaterThan(0);

    const numberedListText = numberedLines.join('\n');
    // Numbered-list convention is "NAME=value" shorthand (e.g.
    // "NAVGATOR_SANDBOX=1 env var"); also run the code-style extractor
    // defensively in case the comment is ever rewritten to quote
    // process.env.X / getEnvBoolean('X', ...) directly.
    const documentedVars = new Set<string>();
    for (const match of numberedListText.matchAll(/\b([A-Z][A-Z0-9_]*)=/g)) {
      documentedVars.add(match[1]);
    }
    for (const name of extractEnvVarNames(numberedListText)) {
      documentedVars.add(name);
    }

    const documentedOnly = [...documentedVars].filter((name) => !readVars.has(name));
    const readOnly = [...readVars].filter((name) => !documentedVars.has(name));

    expect(
      documentedOnly,
      `Doc comment's numbered detection-order list names env var(s) detectSandbox() no longer reads ` +
        `(documented-but-not-read): ${documentedOnly.join(', ')}. Update the comment in src/sandbox.ts to match the code.`
    ).toEqual([]);
    expect(
      readOnly,
      `detectSandbox() reads env var(s) missing from its doc-comment detection-order list ` +
        `(read-but-not-documented): ${readOnly.join(', ')}. Update the comment in src/sandbox.ts to match the code.`
    ).toEqual([]);
  });
});
