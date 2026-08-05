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
 * TWO secrets, not one. The original design used a single value for both the
 * browser-open URL and the steady-state credential, and a live reproduction
 * showed that `ps -axww -o pid,user,command` printed the whole thing:
 * `/bin/sh -c open http://localhost:3000/?nvt=<token>`. macOS `ps` shows
 * other users' full argv, so the 0600 file blocked a cross-user FILE read
 * while the process table handed the same secret to anyone running `ps` —
 * and because the URL value WAS the session credential, a capture stayed
 * valid for the whole session.
 *
 *   - `mintDashboardToken()` — the SESSION token. Reaches the server only
 *     through `NAVGATOR_DASHBOARD_TOKEN` and the 0600 file. Never appears in
 *     any argv, ever.
 *   - `mintBootstrapNonce()` — a SINGLE-USE, short-TTL handoff nonce. This is
 *     the only value that goes in the browser-open URL (`?nvt=`), so it is
 *     the only value `ps` can capture. `web/proxy.ts` burns it on first
 *     redemption and expires it ~5 minutes after server start, so a
 *     `ps`-captured nonce is worthless by the time an attacker replays it.
 *     Worst case is a race with the user's own browser, not a session-long
 *     credential.
 *
 * Splitting them is the control. Switching the browser-open call from
 * `exec(string)` to `spawn(cmd, [url])` is hygiene on top (it removes the
 * extra `/bin/sh -c` copy and the unquoted-`?` glob fragility), but it does
 * NOT by itself keep the value out of the process table.
 *
 * The 0600 file is what a legitimate non-browser local client reads to get
 * the session token for the `x-navgator-token` header — now the ONLY way to
 * obtain it, since it no longer travels through a URL. `navgator ui` unlinks
 * it on shutdown.
 *
 * Home-directory resolution deliberately matches `homeConfigPath()` in
 * `src/home-config.ts`: `os.homedir()` resolved PER CALL, not cached in a
 * module-level const, so the suite-wide `$HOME` redirect
 * (`src/__tests__/setup/home-redirect.ts`) reaches this module the same way
 * it reaches every other `~/.navgator/*` writer in this tree.
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// =============================================================================
// TYPES
// =============================================================================

export interface DashboardSessionRecord {
  token: string;
  port: number;
  pid: number;
  created_at: number;
}

// =============================================================================
// PATH
// =============================================================================

/** Resolved per call — see the file header for why this can't be a const. */
export function dashboardSessionPath(): string {
  return path.join(os.homedir(), '.navgator', 'dashboard-session.json');
}

// =============================================================================
// MINT / WRITE / READ
// =============================================================================

/** 32 bytes of `crypto.randomBytes`, hex-encoded (64 hex chars). */
export function mintDashboardToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * The single-use browser handoff nonce. Same shape and same entropy as the
 * session token — it is deliberately indistinguishable on the wire so a
 * `ps`-derived capture tells an attacker nothing about which value it holds
 * — but a completely independent value with a completely different lifetime.
 * This is the ONLY secret that is allowed into an argv.
 */
export function mintBootstrapNonce(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Persist the session record at 0600. `fs.writeFileSync`'s `mode` option
 * only applies when the file is CREATED — if `dashboard-session.json`
 * already exists from a prior launch, an overwriting write keeps that
 * file's existing mode. The explicit `chmodSync` afterward is what makes
 * 0600 hold on every launch, not just the first.
 */
export function writeDashboardSession(token: string, port: number): void {
  const filePath = dashboardSessionPath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });

  const record: DashboardSessionRecord = {
    token,
    port,
    pid: process.pid,
    created_at: Date.now(),
  };

  fs.writeFileSync(filePath, JSON.stringify(record, null, 2), { mode: 0o600 });
  fs.chmodSync(filePath, 0o600);
}

function isDashboardSessionRecord(value: unknown): value is DashboardSessionRecord {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Record<string, unknown>).token === 'string' &&
    typeof (value as Record<string, unknown>).port === 'number' &&
    typeof (value as Record<string, unknown>).pid === 'number' &&
    typeof (value as Record<string, unknown>).created_at === 'number'
  );
}

/**
 * Read back the session record, or `null` if the file is absent or
 * malformed. Fail-open on read, mirroring every other `~/.navgator/*`
 * loader in this tree (`loadHomeConfig()`, `readJournal()`) — a broken or
 * missing session file must never throw for a caller just checking whether
 * one exists.
 */
export function readDashboardSession(): DashboardSessionRecord | null {
  try {
    const raw = fs.readFileSync(dashboardSessionPath(), 'utf-8');
    const parsed = JSON.parse(raw);
    return isDashboardSessionRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Remove the session file. Called from `navgator ui`'s SIGINT/SIGTERM
 * handler: a token that outlives the server it authenticates is a stale
 * secret sitting at rest for no reason, and the previous cleanup killed the
 * child without unlinking. Fail-open like every other `~/.navgator/*`
 * writer — a shutdown path must never throw.
 */
export function deleteDashboardSession(): void {
  try {
    fs.rmSync(dashboardSessionPath(), { force: true });
  } catch {
    // Nothing actionable during shutdown.
  }
}
