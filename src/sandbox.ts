/**
 * NavGator Sandbox Mode
 * Detects restricted environments (Codex, CI) and adjusts behavior
 */

export interface SandboxConfig {
  enabled: boolean;
  detected: boolean;
  restrictions: {
    noNetwork: boolean;
    noInteractive: boolean;
    noChildProcess: boolean;
    readOnlyFs: boolean;
  };
}

/**
 * Detect if running in a sandboxed environment.
 *
 * Detection order:
 * 1. NAVGATOR_SANDBOX=1 env var — explicit opt-in
 * 2. CODEX=1 or OPENAI_API_KEY + no TTY — Codex environment
 * 3. CI=true — CI environment (partial sandbox)
 * 4. No TTY — restricted environment
 */
export function detectSandbox(): SandboxConfig {
  // 1. Explicit opt-in
  if (process.env.NAVGATOR_SANDBOX === '1') {
    return {
      enabled: true,
      detected: false, // explicit, not auto-detected
      restrictions: {
        noNetwork: true,
        noInteractive: true,
        noChildProcess: true,
        readOnlyFs: false,
      },
    };
  }

  // 2. Codex environment
  if (process.env.CODEX === '1' || (process.env.OPENAI_API_KEY && !process.stdout.isTTY)) {
    return {
      enabled: true,
      detected: true,
      restrictions: {
        noNetwork: true,
        noInteractive: true,
        noChildProcess: true,
        readOnlyFs: true,
      },
    };
  }

  // 3. CI environment
  if (process.env.CI === 'true') {
    return {
      enabled: true,
      detected: true,
      restrictions: {
        noNetwork: false, // CI usually has network
        noInteractive: true,
        noChildProcess: false,
        readOnlyFs: false,
      },
    };
  }

  // 4. No TTY
  if (!process.stdout.isTTY && !process.stdin.isTTY) {
    return {
      enabled: false, // Not enabled by default for no-TTY
      detected: false,
      restrictions: {
        noNetwork: false,
        noInteractive: true,
        noChildProcess: false,
        readOnlyFs: false,
      },
    };
  }

  // Normal environment
  return {
    enabled: false,
    detected: false,
    restrictions: {
      noNetwork: false,
      noInteractive: false,
      noChildProcess: false,
      readOnlyFs: false,
    },
  };
}

/**
 * Check if sandbox mode is active
 */
export function isSandboxMode(): boolean {
  return detectSandbox().enabled;
}

/**
 * Get sandbox restrictions
 */
export function getSandboxRestrictions(): SandboxConfig['restrictions'] {
  return detectSandbox().restrictions;
}
