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
 * 2. CODEX=1 — Codex environment
 * 3. CI=true — CI environment (partial sandbox)
 * 4. No TTY — restricted environment
 *
 * An API key in the environment is never a sandbox signal: having one set
 * says nothing about whether a shell or child process is available, and many
 * developers export it for unrelated tools — it was too broad a heuristic to
 * trigger sandbox detection.
 */
export declare function detectSandbox(): SandboxConfig;
/**
 * Check if sandbox mode is active
 */
export declare function isSandboxMode(): boolean;
/**
 * Get sandbox restrictions
 */
export declare function getSandboxRestrictions(): SandboxConfig['restrictions'];
//# sourceMappingURL=sandbox.d.ts.map