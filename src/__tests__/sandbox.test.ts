/**
 * Tests for NavGator Sandbox Mode
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { detectSandbox, isSandboxMode, getSandboxRestrictions } from '../sandbox.js';

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

  it('detects Codex environment via OPENAI_API_KEY + no TTY', () => {
    process.env.OPENAI_API_KEY = 'sk-test';

    // Mock process.stdout.isTTY
    const originalIsTTY = process.stdout.isTTY;
    Object.defineProperty(process.stdout, 'isTTY', {
      value: false,
      writable: true,
      configurable: true,
    });

    const config = detectSandbox();

    expect(config.enabled).toBe(true);
    expect(config.detected).toBe(true);
    expect(config.restrictions.readOnlyFs).toBe(true);

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

    // With TTY
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
});
