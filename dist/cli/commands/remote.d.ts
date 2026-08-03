import { Command } from 'commander';
/**
 * `navgator scan-remote <url>` — shallow-clone a GitHub repo into a local
 * cache and run the architecture scan against it. CLI-only by design: an
 * MCP-invokable version would put a network fetch (`git clone`) on a
 * prompt-injection-reachable path, so this stays human-initiated.
 */
export declare function registerScanRemoteCommand(program: Command): void;
//# sourceMappingURL=remote.d.ts.map