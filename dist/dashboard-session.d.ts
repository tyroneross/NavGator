/**
 * Per-session capability token for the NavGator dashboard (SEC-001).
 *
 * `web/proxy.ts` already rejects any request whose `Host` header does not
 * resolve to a loopback hostname — that stays in place as the DNS-rebinding
 * defense (a browser can't forge `Host`, but it CAN be tricked into
 * resolving an attacker-controlled page to 127.0.0.1). What loopback alone
 * does NOT defend against is another LOCAL process — any other program
 * running as the same or a different user on the machine can send a
 * well-formed `Host: 127.0.0.1:<port>` request and read or mutate the
 * dashboard with no further check.
 *
 * This module mints a random, per-launch bearer token, persists it to a
 * 0600 file only the invoking user can read, and hands it to the spawned
 * dashboard server via env var. `web/proxy.ts` then requires that token
 * (via cookie after a one-time bootstrap redirect, or via header for
 * scripted/CLI local clients) on top of the loopback check.
 *
 * Home-directory resolution deliberately matches `homeConfigPath()` in
 * `src/home-config.ts`: `os.homedir()` resolved PER CALL, not cached in a
 * module-level const, so the suite-wide `$HOME` redirect
 * (`src/__tests__/setup/home-redirect.ts`) reaches this module the same way
 * it reaches every other `~/.navgator/*` writer in this tree.
 */
export interface DashboardSessionRecord {
    token: string;
    port: number;
    pid: number;
    created_at: number;
}
/** Resolved per call — see the file header for why this can't be a const. */
export declare function dashboardSessionPath(): string;
/** 32 bytes of `crypto.randomBytes`, hex-encoded (64 hex chars). */
export declare function mintDashboardToken(): string;
/**
 * Persist the session record at 0600. `fs.writeFileSync`'s `mode` option
 * only applies when the file is CREATED — if `dashboard-session.json`
 * already exists from a prior launch, an overwriting write keeps that
 * file's existing mode. The explicit `chmodSync` afterward is what makes
 * 0600 hold on every launch, not just the first.
 */
export declare function writeDashboardSession(token: string, port: number): void;
/**
 * Read back the session record, or `null` if the file is absent or
 * malformed. Fail-open on read, mirroring every other `~/.navgator/*`
 * loader in this tree (`loadHomeConfig()`, `readJournal()`) — a broken or
 * missing session file must never throw for a caller just checking whether
 * one exists.
 */
export declare function readDashboardSession(): DashboardSessionRecord | null;
//# sourceMappingURL=dashboard-session.d.ts.map