/**
 * Environment Variable Scanner
 * Discovers env vars from .env files and process.env references in source code.
 *
 * Run 3 precision fix (Option A): env vars referenced in source but not defined
 * in any .env* file are NOT emitted as components. They were previously emitted
 * with `config_files: ['runtime-injected']` (a placeholder string), which the
 * audit's HALLUCINATED_COMPONENT verifier flagged because the placeholder isn't
 * a real file on disk.
 *
 * The information is still surfaced via a ScanWarning (see Phase 4 below), so
 * users still see "VAR is referenced in source but not defined in any .env file
 * (may be runtime-injected)" — the data path that conveys this signal is the
 * warning channel, not a phantom component.
 *
 * Trade-off considered (Option B): emit components with `confidence: 0.5` and
 * a `runtime_injected: true` flag, then teach the audit verifier to skip
 * low-confidence components. Rejected because (a) source-only env vars carry no
 * graph signal once their `env-dependency` connections are dropped (which they
 * must be — without a real component they would become HALLUCINATED_EDGE), and
 * (b) the warning already provides visibility without inflating the graph.
 */
import { ScanResult } from '../../types.js';
/**
 * Parsed connection endpoint — credentials are never included.
 */
export interface ParsedEndpoint {
    protocol: string;
    host: string;
    port?: number;
    database?: string;
    path?: string;
}
/**
 * Parse a connection URL string into its structural components.
 * Credentials (username, password) are stripped and never returned.
 *
 * Supported protocols: postgres, postgresql, mysql, mongodb, redis, rediss,
 * amqp, amqps, http, https.
 *
 * Returns null for non-URL values (plain strings, numbers, empty input).
 */
export declare function parseConnectionUrl(value: string): ParsedEndpoint | null;
type EnvCategory = 'database' | 'auth' | 'api-key' | 'service' | 'app-config' | 'infra' | 'other';
export declare function categorizeEnvVar(name: string): EnvCategory;
/**
 * Scan for environment variables across .env files and source code
 */
export declare function scanEnvVars(projectRoot: string, walkSet?: Set<string>): Promise<ScanResult>;
/**
 * Detect if project has env files
 */
export declare function detectEnvFiles(projectRoot: string): boolean;
export {};
//# sourceMappingURL=env-scanner.d.ts.map