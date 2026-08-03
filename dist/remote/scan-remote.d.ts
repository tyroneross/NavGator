/**
 * scanRemote(url, opts) — parse a GitHub URL, ensure a shallow clone in the
 * cache, run the existing scan pipeline against the clone, and record the
 * remote origin against the project registry entry.
 *
 * `scan()` already owns its own lease and already calls `registerProject()`
 * internally (src/scanner.ts) — this module does neither.
 */
import { type ParsedGitHubUrl } from './github-url.js';
import { type EnsureCloneOptions } from './clone.js';
import { scan } from '../scanner.js';
type ScanOutcome = Awaited<ReturnType<typeof scan>>;
export interface ScanRemoteOptions {
    /** Explicit ref override — otherwise the ref parsed from the URL (e.g. `/tree/<ref>`) is used. */
    ref?: string;
    refresh?: boolean;
    cacheRoot?: string;
    timeoutMs?: number;
    execFileImpl?: EnsureCloneOptions['execFileImpl'];
}
export type ScanRemoteResult = {
    status: 'invalid_url';
    url: string;
} | {
    status: 'busy';
    retryable: true;
    message: string;
    clonePath: string;
} | {
    status: 'completed' | 'noop';
    clonePath: string;
    cloned: boolean;
    parsed: ParsedGitHubUrl;
    scan: ScanOutcome;
};
/**
 * Parse a GitHub URL, ensure the clone exists (or is refreshed), run the
 * scan, and record the remote origin. Never throws on a malformed URL —
 * returns a typed `invalid_url` result instead.
 */
export declare function scanRemote(url: string, opts?: ScanRemoteOptions): Promise<ScanRemoteResult>;
export {};
//# sourceMappingURL=scan-remote.d.ts.map